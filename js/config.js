// Event configuration. Sunset, showtime, and copy all read from here.

export const EVENT = {
  title: "Prothro Movie Night",
  dateLabel: "Friday, October 30",
  dateShort: "Friday, Oct 30",
  dateCompact: "Fri, Oct 30",
  weekday: "Friday",
  year: 2026,
  month: 10,
  day: 30,
  minutesAfterSunset: 20,
  address: "11921 County Road 152 W, Bullard, TX 75757",
  latitude: 32.15498,
  longitude: -95.36768,
  timezone: "America/Chicago",

  movies: [
    { id: "inside_out_2026", title: "Inside Out", short: "Inside Out", year: "2015" },
    { id: "wild_robot", title: "The Wild Robot", short: "Wild Robot", year: "2024" },
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
