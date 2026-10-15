-- History for past screenings, and the Friday, October 30 night.
-- Run this whole file in the Supabase SQL editor. It is safe to re-run.
-- Do not run it from the app, and do not re-apply 001–003 after it:
-- those files put standings back on the October 10 ballot.
--
-- Existing RSVPs are kept and attached to October 10. Nothing is deleted.
-- The October 10 winner is the movie with the greater vote headcount
-- (sum of party_size, the same rule as movie_private.standings). A tie
-- leaves winner null. October 30 starts with no RSVPs.
--
-- October 10 showtime is 7:14 PM CT. October 30 is 6:52 PM CT.
-- Both are official sunset (sunset.js) plus 20 minutes at the backyard.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

create table if not exists public.movie_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null unique,
  showtime timestamptz,
  movie_a text not null,
  movie_a_title text not null,
  movie_b text not null,
  movie_b_title text not null,
  winner text,
  is_current boolean not null default false,
  constraint movie_events_movies_chk check (movie_a <> movie_b and movie_a <> '' and movie_b <> ''),
  constraint movie_events_winner_chk check (winner is null or winner in (movie_a, movie_b))
);

create unique index if not exists movie_events_one_current
  on public.movie_events (is_current)
  where is_current;

comment on table public.movie_events is
  'One row per screening. Guests only see the current night. Past nights stay for the booth.';
comment on column public.movie_events.winner is
  'Movie id with the greater vote headcount. Null when the night is tied or has not happened.';

alter table public.movie_events enable row level security;
alter table public.movie_events force row level security;
revoke all on table public.movie_events from public, anon, authenticated;

-- Insert first so the backfill has a row to point at. Re-runs refresh the
-- catalog fields and leave is_current / winner for the blocks below.
insert into public.movie_events (
  event_date, showtime, movie_a, movie_a_title, movie_b, movie_b_title
)
values
  (
    date '2026-10-10',
    timestamptz '2026-10-11 00:14:44.319+00',
    'princess_bride',
    'The Princess Bride',
    'top_gun',
    'Top Gun: Maverick'
  ),
  (
    date '2026-10-30',
    timestamptz '2026-10-30 23:52:59.997+00',
    'inside_out_2026',
    'Inside Out',
    'wild_robot',
    'The Wild Robot'
  )
on conflict (event_date) do update
set
  showtime = excluded.showtime,
  movie_a = excluded.movie_a,
  movie_a_title = excluded.movie_a_title,
  movie_b = excluded.movie_b,
  movie_b_title = excluded.movie_b_title;

alter table public.movie_rsvps add column if not exists event_id uuid;

-- 002 rewrote the old id `inside_out` onto The Princess Bride. Do that once
-- more for any leftover row, and only that exact id. `inside_out_2026` is the
-- new ballot and must stay put.
update public.movie_rsvps
  set would_attend = 'princess_bride'
where would_attend = 'inside_out';

update public.movie_rsvps
  set vote = 'princess_bride'
where vote = 'inside_out';

-- Only rows that have never been filed. Re-running must not pull October 30
-- RSVPs back onto October 10.
update public.movie_rsvps
  set event_id = (
    select id from public.movie_events where event_date = date '2026-10-10'
  )
where event_id is null;

do $fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'movie_rsvps_event_id_fkey'
      and conrelid = 'public.movie_rsvps'::regclass
  ) then
    alter table public.movie_rsvps
      add constraint movie_rsvps_event_id_fkey
      foreign key (event_id) references public.movie_events (id);
  end if;
end
$fk$;

alter table public.movie_rsvps alter column event_id set not null;

create index if not exists movie_rsvps_event_id_idx
  on public.movie_rsvps (event_id);

comment on column public.movie_rsvps.event_id is
  'The screening this RSVP belongs to. Past nights are not rewritten when a new one starts.';

alter table public.movie_rsvps drop constraint if exists movie_rsvps_attend_chk;
alter table public.movie_rsvps drop constraint if exists movie_rsvps_vote_chk;
alter table public.movie_rsvps drop constraint if exists movie_rsvps_attend_vote_chk;

alter table public.movie_rsvps
  add constraint movie_rsvps_attend_chk
  check (would_attend in (
    'princess_bride', 'top_gun', 'inside_out_2026', 'wild_robot', 'both', 'none'
  ));

alter table public.movie_rsvps
  add constraint movie_rsvps_vote_chk
  check (vote is null or vote in (
    'princess_bride', 'top_gun', 'inside_out_2026', 'wild_robot'
  ));

alter table public.movie_rsvps
  add constraint movie_rsvps_attend_vote_chk
  check (
    (would_attend = 'none' and vote is null)
    or (
      would_attend = 'both'
      and (
        vote is null
        or vote in ('princess_bride', 'top_gun', 'inside_out_2026', 'wild_robot')
      )
    )
    or (
      would_attend = vote
      and would_attend in ('princess_bride', 'top_gun', 'inside_out_2026', 'wild_robot')
    )
  );

-- Vote headcount, not form count. Can't-make-it rows have a null vote, so
-- they add people to the night and zero to either movie.
update public.movie_events e
set winner = sub.winner
from (
  select
    e2.id,
    case
      when coalesce(sum(r.party_size) filter (where r.vote = e2.movie_a), 0)
         > coalesce(sum(r.party_size) filter (where r.vote = e2.movie_b), 0)
      then e2.movie_a
      when coalesce(sum(r.party_size) filter (where r.vote = e2.movie_b), 0)
         > coalesce(sum(r.party_size) filter (where r.vote = e2.movie_a), 0)
      then e2.movie_b
      else null
    end as winner
  from public.movie_events e2
  left join public.movie_rsvps r on r.event_id = e2.id
  where e2.event_date = date '2026-10-10'
  group by e2.id
) sub
where e.id = sub.id;

-- First time October 30 becomes the current night, reopen the booth.
-- A later re-run leaves whatever Evan and Julie set.
do $current$
declare
  v_current date;
begin
  select event_date into v_current
  from public.movie_events
  where is_current
  order by event_date desc
  limit 1;

  if v_current is distinct from date '2026-10-30' then
    update public.movie_events set is_current = false where is_current;
    update public.movie_events set is_current = true where event_date = date '2026-10-30';
    update public.movie_settings
      set rsvps_open = true,
          voting_open = true
    where id = 1;
  end if;
end
$current$;

-- ---------------------------------------------------------------------------
-- Current night. Standings and RSVPs read this, not the whole table.
-- ---------------------------------------------------------------------------

create or replace function movie_private.current_event_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select id
  from public.movie_events
  where is_current
  order by event_date desc
  limit 1;
$$;

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
    coalesce(sum(party_size) filter (where vote = v_a), 0),
    coalesce(sum(party_size) filter (where vote = v_b), 0)
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

-- Guest payload: vote headcount, no per-movie "if they win" totals.
create or replace function movie_private.guest_standings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (
      select jsonb_object_agg(e.key, e.value)
      from jsonb_each(movie_private.standings()) as e
      where e.key <> 'none_parties'
        and e.key not like 'if\_%' escape '\'
    ),
    '{}'::jsonb
  ) || jsonb_build_object('ok', true);
$$;

revoke all on function movie_private.current_event_id() from public, anon, authenticated;
revoke all on function movie_private.standings() from public, anon, authenticated;
revoke all on function movie_private.guest_standings() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guest API
-- ---------------------------------------------------------------------------

create or replace function public.movie_get_standings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select movie_private.guest_standings();
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
      'note', v_row.note
    )
  );
end;
$$;

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

  -- Honeypot: pretend it worked and store nothing.
  if length(btrim(coalesce(p_honeypot, ''))) > 0 then
    return jsonb_build_object(
      'ok', true,
      'token', movie_private.random_token(),
      'rsvp', jsonb_build_object(
        'name', 'Guest',
        'party_size', 1,
        'would_attend', coalesce(v_movie_a, 'inside_out_2026'),
        'vote', coalesce(v_movie_a, 'inside_out_2026'),
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

-- ---------------------------------------------------------------------------
-- Admin API. Every call checks the PIN server-side.
-- ---------------------------------------------------------------------------

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
    select id, name, party_size, would_attend, vote, note, created_at, updated_at
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
        e.movie_a, coalesce(sum(r.party_size) filter (where r.vote = e.movie_a), 0),
        e.movie_b, coalesce(sum(r.party_size) filter (where r.vote = e.movie_b), 0)
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

create or replace function public.movie_admin_delete(p_pin text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_err jsonb;
  v_id uuid;
begin
  v_err := movie_private.check_pin(p_pin);
  if v_err ->> 'ok' <> 'true' then
    return v_err;
  end if;

  begin
    v_id := p_id::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end;

  delete from public.movie_rsvps
  where id = v_id
    and event_id = movie_private.current_event_id();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

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

  delete from public.movie_rsvps
  where event_id = movie_private.current_event_id();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.movie_get_standings() from public;
revoke all on function public.movie_get_rsvp(text) from public;
revoke all on function public.movie_submit_rsvp(text, integer, text, text, text, text, text) from public;
revoke all on function public.movie_admin_overview(text) from public;
revoke all on function public.movie_admin_delete(text, text) from public;
revoke all on function public.movie_admin_reset(text) from public;

grant execute on function public.movie_get_standings() to anon, authenticated;
grant execute on function public.movie_get_rsvp(text) to anon, authenticated;
grant execute on function public.movie_submit_rsvp(text, integer, text, text, text, text, text) to anon, authenticated;
grant execute on function public.movie_admin_overview(text) to anon, authenticated;
grant execute on function public.movie_admin_delete(text, text) to anon, authenticated;
grant execute on function public.movie_admin_reset(text) to anon, authenticated;

comment on function public.movie_get_standings() is
  'Public vote totals for the current night. No names, no per-movie headcount.';
comment on function public.movie_get_rsvp(text) is
  'The caller''s RSVP for the current night, looked up by edit token.';
comment on function public.movie_submit_rsvp(text, integer, text, text, text, text, text) is
  'Create or update an RSVP on the current night. A token from a past night is not_found.';
comment on function public.movie_admin_overview(text) is
  'Current guest book plus past nights. Requires the admin PIN.';
comment on function public.movie_admin_reset(text) is
  'Delete the current night''s RSVPs and votes. Past nights stay. Requires the admin PIN.';

notify pgrst, 'reload schema';
