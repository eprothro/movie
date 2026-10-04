-- The Princess Bride replaces Inside Out.
-- Run this whole file in the Supabase SQL editor. It is safe to re-run.
-- Existing Inside Out RSVPs are kept and counted as Princess Bride votes.

update public.movie_rsvps
  set would_attend = 'princess_bride'
where would_attend = 'inside_out';

update public.movie_rsvps
  set vote = 'princess_bride'
where vote = 'inside_out';

alter table public.movie_rsvps drop constraint if exists movie_rsvps_vote_chk;
alter table public.movie_rsvps drop constraint if exists movie_rsvps_attend_chk;
alter table public.movie_rsvps drop constraint if exists movie_rsvps_attend_vote_chk;

alter table public.movie_rsvps
  add constraint movie_rsvps_attend_chk
  check (would_attend in ('princess_bride', 'top_gun', 'both', 'none'));

alter table public.movie_rsvps
  add constraint movie_rsvps_vote_chk
  check (vote is null or vote in ('princess_bride', 'top_gun'));

alter table public.movie_rsvps
  add constraint movie_rsvps_attend_vote_chk
  check (
    (would_attend = 'none' and vote is null)
    or (would_attend = 'both' and (vote is null or vote in ('princess_bride', 'top_gun')))
    or (would_attend in ('princess_bride', 'top_gun') and vote = would_attend)
  );

create or replace function movie_private.standings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'coming', coalesce(sum(party_size) filter (where would_attend <> 'none'), 0),
    'if_princess_bride', coalesce(sum(party_size) filter (where would_attend in ('princess_bride', 'both')), 0),
    'if_top_gun', coalesce(sum(party_size) filter (where would_attend in ('top_gun', 'both')), 0),
    'none_parties', coalesce(count(*) filter (where would_attend = 'none'), 0),
    'votes', jsonb_build_object(
      'princess_bride', coalesce(count(*) filter (where vote = 'princess_bride'), 0),
      'top_gun', coalesce(count(*) filter (where vote = 'top_gun'), 0)
    ),
    'rsvps_open', coalesce((select rsvps_open from public.movie_settings where id = 1), true),
    'voting_open', coalesce((select voting_open from public.movie_settings where id = 1), true)
  )
  from public.movie_rsvps;
$$;

drop function if exists public.movie_get_standings();

create or replace function public.movie_get_standings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (
    movie_private.standings()
    - 'if_princess_bride'
    - 'if_top_gun'
    - 'none_parties'
  ) || jsonb_build_object('ok', true);
$$;

drop function if exists public.movie_submit_rsvp(text, integer, text, text, text, text, text);

create or replace function public.movie_submit_rsvp(
  p_name text,
  p_party_size integer,
  p_would_attend text,
  p_vote text,
  p_note text,
  p_honeypot text,
  p_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name text;
  v_attend text;
  v_vote text;
  v_note text;
  v_token text;
  v_id uuid;
  v_existing_vote text;
  v_rsvps_open boolean;
  v_voting_open boolean;
  v_rsvp jsonb;
  v_standings jsonb;
begin
  if not movie_private.allow_rate('submit', 40, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;

  -- Honeypot: pretend it worked and store nothing.
  if length(btrim(coalesce(p_honeypot, ''))) > 0 then
    return jsonb_build_object(
      'ok', true,
      'token', movie_private.random_token(),
      'rsvp', jsonb_build_object(
        'name', 'Guest',
        'party_size', 1,
        'would_attend', 'princess_bride',
        'vote', 'princess_bride',
        'note', null
      ),
      'standings', (
        movie_private.standings() - 'if_princess_bride' - 'if_top_gun' - 'none_parties'
      ) || jsonb_build_object('ok', true)
    );
  end if;

  select rsvps_open, voting_open into v_rsvps_open, v_voting_open
  from public.movie_settings
  where id = 1
  for share;

  if coalesce(v_rsvps_open, true) is not true then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  v_name := regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  if v_name = '' or char_length(v_name) > 60 or v_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'error', 'name');
  end if;

  if p_party_size is null or p_party_size < 1 or p_party_size > 10 then
    return jsonb_build_object('ok', false, 'error', 'party');
  end if;

  v_attend := lower(btrim(coalesce(p_would_attend, '')));
  if v_attend not in ('princess_bride', 'top_gun', 'both', 'none') then
    return jsonb_build_object('ok', false, 'error', 'attend');
  end if;

  v_note := nullif(regexp_replace(btrim(coalesce(p_note, '')), E'[\r\n]+', E'\n', 'g'), '');
  if v_note is not null and char_length(v_note) > 240 then
    return jsonb_build_object('ok', false, 'error', 'note');
  end if;
  if v_note is not null and regexp_replace(v_note, E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'error', 'note');
  end if;

  v_vote := nullif(lower(btrim(coalesce(p_vote, ''))), '');
  if v_vote is not null and v_vote not in ('princess_bride', 'top_gun') then
    return jsonb_build_object('ok', false, 'error', 'vote');
  end if;

  v_token := nullif(btrim(coalesce(p_token, '')), '');
  if v_token is not null then
    select id, vote into v_id, v_existing_vote
    from public.movie_rsvps
    where token_hash = movie_private.token_hash(v_token);
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  if v_attend = 'none' then
    v_vote := null;
  elsif v_attend in ('princess_bride', 'top_gun') then
    v_vote := v_attend;
  elsif coalesce(v_voting_open, true) is not true then
    v_vote := case when v_id is not null then v_existing_vote else null end;
  elsif v_vote is null or v_vote not in ('princess_bride', 'top_gun') then
    return jsonb_build_object('ok', false, 'error', 'vote');
  end if;

  if v_id is null then
    v_token := movie_private.random_token();
    insert into public.movie_rsvps (name, party_size, would_attend, vote, note, token_hash)
    values (v_name, p_party_size, v_attend, v_vote, v_note, movie_private.token_hash(v_token));
  else
    update public.movie_rsvps
      set name = v_name,
          party_size = p_party_size,
          would_attend = v_attend,
          vote = v_vote,
          note = v_note,
          updated_at = now()
    where id = v_id;
  end if;

  v_rsvp := jsonb_build_object(
    'name', v_name,
    'party_size', p_party_size,
    'would_attend', v_attend,
    'vote', v_vote,
    'note', v_note
  );
  v_standings := (
    movie_private.standings() - 'if_princess_bride' - 'if_top_gun' - 'none_parties'
  ) || jsonb_build_object('ok', true);

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'rsvp', v_rsvp,
    'standings', v_standings
  );
end;
$$;

drop function if exists public.movie_admin_reset(text);

create or replace function public.movie_admin_reset(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_err jsonb;
begin
  v_err := movie_private.check_pin(p_pin);
  if v_err ->> 'ok' <> 'true' then
    return v_err;
  end if;

  delete from public.movie_rsvps;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.movie_admin_reset(text) from public;
grant execute on function public.movie_admin_reset(text) to anon, authenticated;

comment on function public.movie_admin_reset(text) is
  'Delete every RSVP and vote. Requires the admin PIN.';

notify pgrst, 'reload schema';
