// Event configuration. Sunset, showtime, and copy all read from here.

export const EVENT = {
  title: "Prothro Movie Night",
  dateLabel: "Saturday, October 10",
  year: 2026,
  month: 10,
  day: 10,
  minutesAfterSunset: 15,
  address: "11921 County Road 152 W, Bullard, TX 75757",
  latitude: 32.15498,
  longitude: -95.36768,
  timezone: "America/Chicago",

  movies: [
    { id: "princess_bride", title: "The Princess Bride", short: "Princess Bride", year: "1987" },
    { id: "top_gun", title: "Top Gun: Maverick", short: "Top Gun", year: "2022" },
  ],

  supabaseUrl: "https://yhiynwocgqskcmldrmyd.supabase.co",
  supabaseKey: "sb_publishable_G0mhMTmxwgNGc6ADf4RQ_Q_574NUmOQ",
};

export const TOKEN_KEY = "prothro-movie-night-token";
export const PIN_KEY = "prothro-movie-admin-pin";

export function movieTitle(id) {
  return EVENT.movies.find((movie) => movie.id === id)?.title ?? "";
}

export function shortTitle(id) {
  return EVENT.movies.find((movie) => movie.id === id)?.short ?? "";
}

export function peopleLabel(count) {
  const n = Number(count);
  return n === 1 ? "1 person" : `${n} people`;
}
