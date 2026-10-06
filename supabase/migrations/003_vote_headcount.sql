-- Count each movie by people, not by form submissions.
-- A party of 4 that picked The Princess Bride adds 4.
-- Can't-make-it RSVPs have a null vote, so they add 0.
-- A conditional RSVP ("probably not") still adds its party_size to the
-- movie it picked. "Coming either way" adds its party_size to its pick too.
--
-- Run this whole file in the Supabase SQL editor. It is safe to re-run.
-- movie_get_standings, movie_submit_rsvp, and movie_admin_overview all
-- read movie_private.standings(), so this is the only function to replace.
-- Do not run it from the app deploy. Apply it by hand.

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
      'princess_bride', coalesce(sum(party_size) filter (where vote = 'princess_bride'), 0),
      'top_gun', coalesce(sum(party_size) filter (where vote = 'top_gun'), 0)
    ),
    'rsvps_open', coalesce((select rsvps_open from public.movie_settings where id = 1), true),
    'voting_open', coalesce((select voting_open from public.movie_settings where id = 1), true)
  )
  from public.movie_rsvps;
$$;
