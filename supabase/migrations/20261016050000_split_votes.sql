-- A party can split its vote without being counted twice.
-- Run this whole file in the Supabase SQL editor, after history.sql.
-- It is safe to re-run. It does not update or delete any RSVP.
-- Existing rows stay a single vote: vote_b and vote_b_count stay null.
--
-- Attendance stays a fact about the whole party (would_attend).
-- coming and the "if this movie wins" totals are unchanged.
-- Only the vote tally is divided: party_size - vote_b_count on vote,
-- and vote_b_count on vote_b. A party of 4 split 2/2 is still 4 coming.

alter table public.movie_rsvps
  add column if not exists vote_b text,
  add column if not exists vote_b_count integer;

comment on column public.movie_rsvps.vote_b is
  'The other movie, when the party splits its vote. Null means one vote for the whole party.';
comment on column public.movie_rsvps.vote_b_count is
  'How many people in the party vote for vote_b. The rest vote for vote. Null when the party is not split.';

alter table public.movie_rsvps drop constraint if exists movie_rsvps_split_chk;
alter table public.movie_rsvps
  add constraint movie_rsvps_split_chk
  check (
    (vote_b is null and vote_b_count is null)
    or (
      vote_b is not null
      and vote is not null
      and vote_b <> vote
      and vote_b in ('princess_bride', 'top_gun', 'inside_out_2026', 'wild_robot')
      and vote_b_count between 1 and party_size - 1
      and would_attend <> 'none'
    )
  );

-- One movie's share of a party. Unsplit rows (vote_b_count null) contribute
-- the whole party_size to vote, which is the old rule.
create or replace function movie_private.votes_for(
  p_movie text,
  p_party integer,
  p_vote text,
  p_vote_b text,
  p_vote_b_count integer
)
returns integer
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_vote = p_movie then p_party - coalesce(p_vote_b_count, 0)
    when p_vote_b = p_movie then coalesce(p_vote_b_count, 0)
    else 0
  end;
$$;

revoke all on function movie_private.votes_for(text, integer, text, text, integer)
  from public, anon, authenticated;

create or replace function movie_private.standings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_a text;
  v_b text;
  v_coming bigint;
  v_if_a bigint;
  v_if_b bigint;
  v_none bigint;
  v_vote_a bigint;
  v_vote_b bigint;
  v_rsvps boolean;
  v_voting boolean;
begin
  select id, movie_a, movie_b
    into v_id, v_a, v_b
  from public.movie_events
  where is_current
  order by event_date desc
  limit 1;

  select rsvps_open, voting_open
    into v_rsvps, v_voting
  from public.movie_settings
  where id = 1;

  if v_id is null or v_a is null or v_b is null then
    return jsonb_build_object(
      'coming', 0,
      'none_parties', 0,
      'votes', '{}'::jsonb,
      'rsvps_open', coalesce(v_rsvps, true),
      'voting_open', coalesce(v_voting, true)
    );
  end if;

  select
    coalesce(sum(party_size) filter (where would_attend <> 'none'), 0),
    coalesce(sum(party_size) filter (where would_attend in (v_a, 'both')), 0),
    coalesce(sum(party_size) filter (where would_attend in (v_b, 'both')), 0),
    coalesce(count(*) filter (where would_attend = 'none'), 0),
    coalesce(sum(movie_private.votes_for(v_a, party_size, vote, vote_b, vote_b_count))
      filter (where would_attend <> 'none'), 0),
    coalesce(sum(movie_private.votes_for(v_b, party_size, vote, vote_b, vote_b_count))
      filter (where would_attend <> 'none'), 0)
  into v_coming, v_if_a, v_if_b, v_none, v_vote_a, v_vote_b
  from public.movie_rsvps
  where event_id = v_id;

  return jsonb_build_object(
    'coming', v_coming,
    'if_' || v_a, v_if_a,
    'if_' || v_b, v_if_b,
    'none_parties', v_none,
    'votes', jsonb_build_object(v_a, v_vote_a, v_b, v_vote_b),
    'rsvps_open', coalesce(v_rsvps, true),
    'voting_open', coalesce(v_voting, true)
  );
end;
$$;

create or replace function public.movie_get_rsvp(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.movie_rsvps%rowtype;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', true, 'rsvp', null);
  end if;

  select * into v_row
  from public.movie_rsvps
  where token_hash = movie_private.token_hash(btrim(p_token))
    and event_id = movie_private.current_event_id();

  if not found then
    return jsonb_build_object('ok', true, 'rsvp', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rsvp', jsonb_build_object(
      'name', v_row.name,
      'party_size', v_row.party_size,
      'would_attend', v_row.would_attend,
      'vote', v_row.vote,
      'vote_b', v_row.vote_b,
      'vote_b_count', v_row.vote_b_count,
      'note', v_row.note
    )
  );
end;
$$;

-- A normal save is still one vote. Updating clears any split, so Change RSVP
-- returns the party to a single movie. New rows leave the new columns null.
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
  v_event_id uuid;
  v_movie_a text;
  v_movie_b text;
  v_rsvps_open boolean;
  v_voting_open boolean;
  v_rsvp jsonb;
  v_standings jsonb;
begin
  if not movie_private.allow_rate('submit', 40, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;

  select id, movie_a, movie_b
    into v_event_id, v_movie_a, v_movie_b
  from public.movie_events
  where is_current
  order by event_date desc
  limit 1;

  if length(btrim(coalesce(p_honeypot, ''))) > 0 then
    return jsonb_build_object(
      'ok', true,
      'token', movie_private.random_token(),
      'rsvp', jsonb_build_object(
        'name', 'Guest',
        'party_size', 1,
        'would_attend', coalesce(v_movie_a, 'inside_out_2026'),
        'vote', coalesce(v_movie_a, 'inside_out_2026'),
        'vote_b', null,
        'vote_b_count', null,
        'note', null
      ),
      'standings', movie_private.guest_standings()
    );
  end if;

  if v_event_id is null then
    return jsonb_build_object('ok', false, 'error', 'closed');
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
  if v_attend not in (v_movie_a, v_movie_b, 'both', 'none') then
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
  if v_vote is not null and v_vote not in (v_movie_a, v_movie_b) then
    return jsonb_build_object('ok', false, 'error', 'vote');
  end if;

  -- A token from a past night is not this night's RSVP. The phone clears it
  -- and sends a new one, so October 10 rows are never edited.
  v_token := nullif(btrim(coalesce(p_token, '')), '');
  if v_token is not null then
    select id, vote into v_id, v_existing_vote
    from public.movie_rsvps
    where token_hash = movie_private.token_hash(v_token)
      and event_id = v_event_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  if v_attend = 'none' then
    v_vote := null;
  elsif v_attend in (v_movie_a, v_movie_b) then
    v_vote := v_attend;
  elsif coalesce(v_voting_open, true) is not true then
    v_vote := case when v_id is not null then v_existing_vote else null end;
  elsif v_vote is null or v_vote not in (v_movie_a, v_movie_b) then
    return jsonb_build_object('ok', false, 'error', 'vote');
  end if;

  if v_id is null then
    v_token := movie_private.random_token();
    insert into public.movie_rsvps (event_id, name, party_size, would_attend, vote, note, token_hash)
    values (v_event_id, v_name, p_party_size, v_attend, v_vote, v_note, movie_private.token_hash(v_token));
  else
    update public.movie_rsvps
      set name = v_name,
          party_size = p_party_size,
          would_attend = v_attend,
          vote = v_vote,
          vote_b = null,
          vote_b_count = null,
          note = v_note,
          updated_at = now()
    where id = v_id
      and event_id = v_event_id;
  end if;

  v_rsvp := jsonb_build_object(
    'name', v_name,
    'party_size', p_party_size,
    'would_attend', v_attend,
    'vote', v_vote,
    'vote_b', null,
    'vote_b_count', null,
    'note', v_note
  );
  v_standings := movie_private.guest_standings();

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'rsvp', v_rsvp,
    'standings', v_standings
  );
end;
$$;

-- p_count null (or 0) puts the party back on one movie.
-- Otherwise p_count is how many of us want the other movie, from 1 to party size - 1.
create or replace function public.movie_split_vote(p_token text, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_token text;
  v_row public.movie_rsvps%rowtype;
  v_a text;
  v_b text;
  v_rsvps boolean;
  v_voting boolean;
  v_vote_b text;
  v_count integer;
begin
  if not movie_private.allow_rate('split', 40, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;

  v_token := nullif(btrim(coalesce(p_token, '')), '');
  if v_token is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_row
  from public.movie_rsvps
  where token_hash = movie_private.token_hash(v_token)
    and event_id = movie_private.current_event_id();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select rsvps_open, voting_open into v_rsvps, v_voting
  from public.movie_settings
  where id = 1
  for share;

  if coalesce(v_rsvps, true) is not true or coalesce(v_voting, true) is not true then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if v_row.would_attend = 'none'
    or v_row.party_size < 2
    or v_row.vote is null
  then
    return jsonb_build_object('ok', false, 'error', 'vote');
  end if;

  select movie_a, movie_b into v_a, v_b
  from public.movie_events
  where id = v_row.event_id;

  if v_row.vote not in (v_a, v_b) then
    return jsonb_build_object('ok', false, 'error', 'vote');
  end if;

  if p_count is null or p_count = 0 then
    v_vote_b := null;
    v_count := null;
  elsif p_count < 1 or p_count > v_row.party_size - 1 then
    return jsonb_build_object('ok', false, 'error', 'vote');
  else
    v_vote_b := case when v_row.vote = v_a then v_b else v_a end;
    v_count := p_count;
  end if;

  update public.movie_rsvps
    set vote_b = v_vote_b,
        vote_b_count = v_count,
        updated_at = now()
  where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'rsvp', jsonb_build_object(
      'name', v_row.name,
      'party_size', v_row.party_size,
      'would_attend', v_row.would_attend,
      'vote', v_row.vote,
      'vote_b', v_vote_b,
      'vote_b_count', v_count,
      'note', v_row.note
    ),
    'standings', movie_private.guest_standings()
  );
end;
$$;

create or replace function public.movie_admin_overview(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_err jsonb;
  v_rows jsonb;
  v_history jsonb;
  v_event uuid;
begin
  v_err := movie_private.check_pin(p_pin);
  if v_err ->> 'ok' <> 'true' then
    return v_err;
  end if;

  v_event := movie_private.current_event_id();

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select id, name, party_size, would_attend, vote, vote_b, vote_b_count, note, created_at, updated_at
    from public.movie_rsvps
    where event_id = v_event
  ) s;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.event_date desc), '[]'::jsonb)
    into v_history
  from (
    select
      e.event_date,
      e.showtime,
      e.movie_a,
      e.movie_a_title,
      e.movie_b,
      e.movie_b_title,
      e.winner,
      case
        when e.winner = e.movie_a then e.movie_a_title
        when e.winner = e.movie_b then e.movie_b_title
        else null
      end as winner_title,
      -- Same people as the live "coming" number. Can't-make-it parties stay out.
      coalesce(sum(r.party_size) filter (where r.would_attend <> 'none'), 0)::integer as headcount,
      jsonb_build_object(
        e.movie_a, coalesce(sum(movie_private.votes_for(e.movie_a, r.party_size, r.vote, r.vote_b, r.vote_b_count))
          filter (where r.would_attend <> 'none'), 0),
        e.movie_b, coalesce(sum(movie_private.votes_for(e.movie_b, r.party_size, r.vote, r.vote_b, r.vote_b_count))
          filter (where r.would_attend <> 'none'), 0)
      ) as votes
    from public.movie_events e
    left join public.movie_rsvps r on r.event_id = e.id
    where e.is_current = false
    group by e.id
  ) h;

  return movie_private.standings()
    || jsonb_build_object('ok', true, 'rsvps', v_rows, 'history', v_history);
end;
$$;

revoke all on function public.movie_split_vote(text, integer) from public;
grant execute on function public.movie_split_vote(text, integer) to anon, authenticated;

comment on function public.movie_split_vote(text, integer) is
  'Divide an existing party''s vote. Does not change how many people are coming. Null count restores one vote.';

notify pgrst, 'reload schema';
