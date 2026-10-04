-- Prothro movie night — RSVP + vote
-- Run this entire file in the Supabase SQL editor (safe to re-run).
-- Then set a PIN. The line at the bottom is commented out on purpose.
-- Do not put the real PIN in this repo.
--
--   select movie_set_admin_pin('CHANGE_ME');
--
-- Anon has no table access. Guests and hosts go through the functions below.

create schema if not exists extensions;
create schema if not exists movie_private;

revoke all on schema movie_private from public;
revoke all on schema movie_private from anon, authenticated;

-- pgcrypto may already live in `extensions` (Supabase default) or in public.
-- Wrappers below follow whichever schema it was installed into.
do $migrate$
declare
  sch text;
begin
  select n.nspname into sch
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if sch is null then
    execute 'create extension pgcrypto with schema extensions';
    sch := 'extensions';
  end if;

  execute format($f$
    create or replace function movie_private.hash_pin(p text)
    returns text
    language sql
    volatile
    set search_path = pg_catalog
    as $body$ select %1$I.crypt(p, %1$I.gen_salt('bf', 8)); $body$
  $f$, sch);

  execute format($f$
    create or replace function movie_private.pin_matches(p text, h text)
    returns boolean
    language sql
    stable
    set search_path = pg_catalog
    as $body$ select h is not null and p is not null and %1$I.crypt(p, h) = h; $body$
  $f$, sch);

  execute format($f$
    create or replace function movie_private.token_hash(t text)
    returns text
    language sql
    immutable
    set search_path = pg_catalog
    as $body$ select encode(%1$I.digest(t, 'sha256'), 'hex'); $body$
  $f$, sch);

  execute format($f$
    create or replace function movie_private.random_token()
    returns text
    language sql
    volatile
    set search_path = pg_catalog
    as $body$ select encode(%1$I.gen_random_bytes(24), 'hex'); $body$
  $f$, sch);
end
$migrate$;

revoke all on function movie_private.hash_pin(text) from public;
revoke all on function movie_private.pin_matches(text, text) from public;
revoke all on function movie_private.token_hash(text) from public;
revoke all on function movie_private.random_token() from public;

create table if not exists public.movie_rsvps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  party_size integer not null,
  would_attend text not null,
  vote text,
  note text,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint movie_rsvps_name_len check (char_length(name) between 1 and 60),
  constraint movie_rsvps_party_chk check (party_size between 1 and 10),
  constraint movie_rsvps_attend_chk check (would_attend in ('inside_out', 'top_gun', 'both', 'none')),
  constraint movie_rsvps_vote_chk check (vote is null or vote in ('inside_out', 'top_gun')),
  constraint movie_rsvps_attend_vote_chk check (
    (would_attend = 'none' and vote is null)
    or (would_attend = 'both' and (vote is null or vote in ('inside_out', 'top_gun')))
    or (would_attend in ('inside_out', 'top_gun') and vote = would_attend)
  ),
  constraint movie_rsvps_note_len check (note is null or char_length(note) <= 240)
);

create table if not exists public.movie_settings (
  id smallint primary key,
  admin_pin_hash text,
  rsvps_open boolean not null default true,
  voting_open boolean not null default true,
  failed_pin_attempts integer not null default 0,
  pin_locked_until timestamptz,
  constraint movie_settings_singleton check (id = 1)
);

create table if not exists public.movie_rate_limits (
  bucket text primary key,
  hits integer not null,
  window_start timestamptz not null default now()
);

insert into public.movie_settings (id)
values (1)
on conflict (id) do nothing;

-- Upgrade path: this file has already been applied once. Add would_attend,
-- backfill from the old yes/maybe/no status, then drop that column.
alter table public.movie_rsvps add column if not exists would_attend text;

do $upgrade$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'movie_rsvps'
      and column_name = 'status'
  ) then
    update public.movie_rsvps
      set would_attend = case
        when status = 'no' then 'none'
        when vote in ('inside_out', 'top_gun') then vote
        else 'both'
      end
    where would_attend is null;
  end if;
end
$upgrade$;

update public.movie_rsvps
  set would_attend = 'both'
where would_attend is null;

alter table public.movie_rsvps drop constraint if exists movie_rsvps_status_chk;
alter table public.movie_rsvps drop constraint if exists movie_rsvps_no_vote_chk;
alter table public.movie_rsvps drop constraint if exists movie_rsvps_vote_chk;
alter table public.movie_rsvps drop constraint if exists movie_rsvps_attend_chk;
alter table public.movie_rsvps drop constraint if exists movie_rsvps_attend_vote_chk;

alter table public.movie_rsvps drop column if exists status;

alter table public.movie_rsvps alter column would_attend set not null;

alter table public.movie_rsvps
  add constraint movie_rsvps_attend_chk
  check (would_attend in ('inside_out', 'top_gun', 'both', 'none'));

alter table public.movie_rsvps
  add constraint movie_rsvps_vote_chk
  check (vote is null or vote in ('inside_out', 'top_gun'));

alter table public.movie_rsvps
  add constraint movie_rsvps_attend_vote_chk
  check (
    (would_attend = 'none' and vote is null)
    or (would_attend = 'both' and (vote is null or vote in ('inside_out', 'top_gun')))
    or (would_attend in ('inside_out', 'top_gun') and vote = would_attend)
  );

alter table public.movie_rsvps enable row level security;
alter table public.movie_settings enable row level security;
alter table public.movie_rate_limits enable row level security;

alter table public.movie_rsvps force row level security;
alter table public.movie_settings force row level security;
alter table public.movie_rate_limits force row level security;

revoke all on table public.movie_rsvps from public, anon, authenticated;
revoke all on table public.movie_settings from public, anon, authenticated;
revoke all on table public.movie_rate_limits from public, anon, authenticated;

comment on table public.movie_rsvps is 'Backyard movie night RSVPs. No direct API access; use the movie_* functions.';
comment on table public.movie_settings is 'Singleton settings and bcrypt admin PIN. Anon cannot read this.';

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create or replace function movie_private.client_ip()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  raw text;
  headers jsonb;
begin
  raw := current_setting('request.headers', true);
  if raw is null or btrim(raw) = '' then
    return 'unknown';
  end if;
  headers := raw::jsonb;
  raw := coalesce(headers ->> 'x-forwarded-for', headers ->> 'x-real-ip');
  if raw is null or btrim(raw) = '' then
    return 'unknown';
  end if;
  return left(btrim(split_part(raw, ',', 1)), 80);
exception when others then
  return 'unknown';
end;
$$;

create or replace function movie_private.allow_rate(p_action text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ip text;
  v_bucket text;
  v_limit integer;
  v_hits integer;
begin
  v_ip := movie_private.client_ip();
  -- Phones on one household network share an IP. Unknown means the platform
  -- didn't pass a client address, so don't let that one bucket lock the family out.
  v_limit := case when v_ip = 'unknown' then greatest(p_limit, 80) else p_limit end;
  v_bucket := p_action || ':' || v_ip;

  delete from public.movie_rate_limits
  where window_start < now() - interval '1 day';

  insert into public.movie_rate_limits as rl (bucket, hits, window_start)
  values (v_bucket, 1, now())
  on conflict (bucket) do update
  set
    hits = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else rl.hits + 1
    end,
    window_start = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else rl.window_start
    end
  returning hits into v_hits;

  return v_hits <= v_limit;
end;
$$;

create or replace function movie_private.standings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'coming', coalesce(sum(party_size) filter (where would_attend <> 'none'), 0),
    'if_inside_out', coalesce(sum(party_size) filter (where would_attend in ('inside_out', 'both')), 0),
    'if_top_gun', coalesce(sum(party_size) filter (where would_attend in ('top_gun', 'both')), 0),
    'none_parties', coalesce(count(*) filter (where would_attend = 'none'), 0),
    'votes', jsonb_build_object(
      'inside_out', coalesce(count(*) filter (where vote = 'inside_out'), 0),
      'top_gun', coalesce(count(*) filter (where vote = 'top_gun'), 0)
    ),
    'rsvps_open', coalesce((select rsvps_open from public.movie_settings where id = 1), true),
    'voting_open', coalesce((select voting_open from public.movie_settings where id = 1), true)
  )
  from public.movie_rsvps;
$$;

-- Five wrong PINs lock every admin call for 10 minutes.
create or replace function movie_private.check_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_hash text;
  v_attempts integer;
  v_locked timestamptz;
begin
  select admin_pin_hash, failed_pin_attempts, pin_locked_until
    into v_hash, v_attempts, v_locked
  from public.movie_settings
  where id = 1
  for update;

  if v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'pin_not_set');
  end if;

  if v_locked is not null and v_locked > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'retry_at', v_locked);
  end if;

  if movie_private.pin_matches(p_pin, v_hash) then
    update public.movie_settings
      set failed_pin_attempts = 0,
          pin_locked_until = null
    where id = 1;
    return jsonb_build_object('ok', true);
  end if;

  if coalesce(v_attempts, 0) + 1 >= 5 then
    update public.movie_settings
      set failed_pin_attempts = 0,
          pin_locked_until = now() + interval '10 minutes'
    where id = 1
    returning pin_locked_until into v_locked;
    return jsonb_build_object('ok', false, 'error', 'locked', 'retry_at', v_locked);
  end if;

  update public.movie_settings
    set failed_pin_attempts = coalesce(v_attempts, 0) + 1
  where id = 1;

  return jsonb_build_object('ok', false, 'error', 'pin');
end;
$$;

revoke all on function movie_private.client_ip() from public;
revoke all on function movie_private.allow_rate(text, integer, integer) from public;
revoke all on function movie_private.standings() from public;
revoke all on function movie_private.check_pin(text) from public;

-- ---------------------------------------------------------------------------
-- Guest API
-- ---------------------------------------------------------------------------

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
    - 'if_inside_out'
    - 'if_top_gun'
    - 'none_parties'
  ) || jsonb_build_object('ok', true);
$$;

drop function if exists public.movie_get_rsvp(text);

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
  where token_hash = movie_private.token_hash(btrim(p_token));

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
        'would_attend', 'inside_out',
        'vote', 'inside_out',
        'note', null
      ),
      'standings', (
        movie_private.standings() - 'if_inside_out' - 'if_top_gun' - 'none_parties'
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
  if v_attend not in ('inside_out', 'top_gun', 'both', 'none') then
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
  if v_vote is not null and v_vote not in ('inside_out', 'top_gun') then
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
  elsif v_attend in ('inside_out', 'top_gun') then
    v_vote := v_attend;
  elsif coalesce(v_voting_open, true) is not true then
    v_vote := case when v_id is not null then v_existing_vote else null end;
  elsif v_vote is null or v_vote not in ('inside_out', 'top_gun') then
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
    movie_private.standings() - 'if_inside_out' - 'if_top_gun' - 'none_parties'
  ) || jsonb_build_object('ok', true);

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

drop function if exists public.movie_admin_overview(text);

create or replace function public.movie_admin_overview(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_err jsonb;
  v_rows jsonb;
begin
  v_err := movie_private.check_pin(p_pin);
  if v_err ->> 'ok' <> 'true' then
    return v_err;
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select id, name, party_size, would_attend, vote, note, created_at, updated_at
    from public.movie_rsvps
  ) s;

  return movie_private.standings() || jsonb_build_object('ok', true, 'rsvps', v_rows);
end;
$$;

drop function if exists public.movie_admin_delete(text, text);

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

  delete from public.movie_rsvps where id = v_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

drop function if exists public.movie_admin_set_open(text, boolean, boolean);

create or replace function public.movie_admin_set_open(
  p_pin text,
  p_rsvps_open boolean,
  p_voting_open boolean
)
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

  if p_rsvps_open is null or p_voting_open is null then
    return jsonb_build_object('ok', false, 'error', 'flags');
  end if;

  update public.movie_settings
    set rsvps_open = p_rsvps_open,
        voting_open = p_voting_open
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'rsvps_open', p_rsvps_open,
    'voting_open', p_voting_open
  );
end;
$$;

-- Not granted to anon. Run it yourself from the SQL editor as postgres.
drop function if exists public.movie_set_admin_pin(text);

create or replace function public.movie_set_admin_pin(p_pin text)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits';
  end if;

  insert into public.movie_settings (id)
  values (1)
  on conflict (id) do nothing;

  update public.movie_settings
    set admin_pin_hash = movie_private.hash_pin(p_pin),
        failed_pin_attempts = 0,
        pin_locked_until = null
  where id = 1;

  return true;
end;
$$;

revoke all on function public.movie_get_standings() from public;
revoke all on function public.movie_get_rsvp(text) from public;
revoke all on function public.movie_submit_rsvp(text, integer, text, text, text, text, text) from public;
revoke all on function public.movie_admin_overview(text) from public;
revoke all on function public.movie_admin_delete(text, text) from public;
revoke all on function public.movie_admin_set_open(text, boolean, boolean) from public;
revoke all on function public.movie_set_admin_pin(text) from public;

grant execute on function public.movie_get_standings() to anon, authenticated;
grant execute on function public.movie_get_rsvp(text) to anon, authenticated;
grant execute on function public.movie_submit_rsvp(text, integer, text, text, text, text, text) to anon, authenticated;
grant execute on function public.movie_admin_overview(text) to anon, authenticated;
grant execute on function public.movie_admin_delete(text, text) to anon, authenticated;
grant execute on function public.movie_admin_set_open(text, boolean, boolean) to anon, authenticated;

comment on function public.movie_submit_rsvp(text, integer, text, text, text, text, text) is
  'Create or update an RSVP. Returns an edit token. Update requires that token.';
comment on function public.movie_get_standings() is
  'Public vote totals and headcount. No names.';
comment on function public.movie_get_rsvp(text) is
  'The caller''s own RSVP, looked up by edit token.';
comment on function public.movie_set_admin_pin(text) is
  'Set the bcrypt admin PIN. Not callable by anon. Run from the SQL editor.';

notify pgrst, 'reload schema';

-- ===========================================================================
-- SET THE ADMIN PIN (required). Run this yourself in the SQL editor.
-- Replace the placeholder with a 4–8 digit PIN. Do not commit the real PIN.
-- select movie_set_admin_pin('CHANGE_ME');
-- ===========================================================================
