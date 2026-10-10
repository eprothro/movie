// Sunset for a local calendar date.
// Equations are the NOAA solar calculator (gml.noaa.gov/grad/solcalc),
// from Jean Meeus, Astronomical Algorithms: Julian century, geometric
// mean longitude and anomaly, equation of center, apparent longitude,
// obliquity correction, declination, and the equation of time.
// Official sunset is the instant the sun's center is at zenith 90.833°
// (refraction −0.833°). The UTC minute is evaluated twice, first at
// 0h UT and then at that estimate. No network calls.

const DAY_MS = 86400000;
const ZENITH = 90.833;

function degToRad(deg) {
  return (Math.PI * deg) / 180;
}

function radToDeg(rad) {
  return (180 * rad) / Math.PI;
}

function wrap360(deg) {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Julian day at 0h UT. Valid for 1901–2099, matching the NOAA sheet. */
function julianDay(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const century = Math.floor(y / 100);
  const gregorian = 2 - century + Math.floor(century / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + gregorian - 1524.5;
}

function julianCentury(jd) {
  return (jd - 2451545) / 36525;
}

function geomMeanLong(t) {
  return wrap360(280.46646 + t * (36000.76983 + t * 0.0003032));
}

function geomMeanAnomaly(t) {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t);
}

function eccentricity(t) {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
}

function equationOfCenter(t) {
  const anomaly = degToRad(geomMeanAnomaly(t));
  return (
    Math.sin(anomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * anomaly) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * anomaly) * 0.000289
  );
}

function obliquity(t) {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const mean = 23 + (26 + seconds / 60) / 60;
  const omega = 125.04 - 1934.136 * t;
  return mean + 0.00256 * Math.cos(degToRad(omega));
}

function apparentLongitude(t) {
  const omega = 125.04 - 1934.136 * t;
  return geomMeanLong(t) + equationOfCenter(t) - 0.00569 - 0.00478 * Math.sin(degToRad(omega));
}

/** Declination in radians. */
function declination(t) {
  return Math.asin(Math.sin(degToRad(obliquity(t))) * Math.sin(degToRad(apparentLongitude(t))));
}

/** Equation of time in minutes. */
function equationOfTime(t) {
  const y = Math.tan(degToRad(obliquity(t)) / 2) ** 2;
  const longitude = degToRad(geomMeanLong(t));
  const anomaly = degToRad(geomMeanAnomaly(t));
  const orbit = eccentricity(t);
  const eq =
    y * Math.sin(2 * longitude) -
    2 * orbit * Math.sin(anomaly) +
    4 * orbit * y * Math.sin(anomaly) * Math.cos(2 * longitude) -
    0.5 * y * y * Math.sin(4 * longitude) -
    1.25 * orbit * orbit * Math.sin(2 * anomaly);
  return radToDeg(eq) * 4;
}

/**
 * Minutes from 0h UT until sunset. Longitude is degrees, negative west.
 * NaN when the sun does not set (polar day or night).
 */
function sunsetUtcMinutes(jd, latitude, longitude) {
  const t = julianCentury(jd);
  const dec = declination(t);
  const lat = degToRad(latitude);
  const cosHour =
    Math.cos(degToRad(ZENITH)) / (Math.cos(lat) * Math.cos(dec)) - Math.tan(lat) * Math.tan(dec);
  if (cosHour < -1 || cosHour > 1) return NaN;
  const hourAngle = -Math.acos(cosHour);
  return 720 - 4 * (longitude + radToDeg(hourAngle)) - equationOfTime(t);
}

/** UTC instant of official sunset for the UTC day containing `date`. */
export function sunsetAt(date, latitude, longitude) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const jd = julianDay(year, month, day);
  const first = sunsetUtcMinutes(jd, latitude, longitude);
  if (Number.isNaN(first)) return new Date(NaN);
  const refined = sunsetUtcMinutes(jd + first / 1440, latitude, longitude);
  if (Number.isNaN(refined)) return new Date(NaN);
  return new Date(Date.UTC(year, month - 1, day) + refined * 60000);
}

/** UTC instant of a wall-clock time in an IANA timezone. */
export function zonedTime(year, month, day, hour, minute, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(format.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
    const observed = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const target = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = observed - target;
    if (delta === 0) break;
    utc -= delta;
  }

  return new Date(utc);
}

export function formatClock(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * True from noon on the event's local calendar date through the end of that day.
 * Both edges are wall-clock times in the event timezone, not the device timezone.
 */
export function isEventDayAfternoon(now, event) {
  const start = zonedTime(event.year, event.month, event.day, 12, 0, event.timezone);
  const end = zonedTime(event.year, event.month, event.day + 1, 0, 0, event.timezone);
  return now >= start && now < end;
}

/**
 * Sunset and showtime for the event's local calendar date.
 * Returns null if the sun doesn't set (polar day/night).
 * The instant does not depend on the viewer's clock; compare it with clockNow().
 */
export function eventShowtime(event) {
  const noon = zonedTime(event.year, event.month, event.day, 12, 0, event.timezone);
  const sunset = sunsetAt(noon, event.latitude, event.longitude);
  if (!sunset || Number.isNaN(sunset.getTime())) return null;
  const showtime = new Date(sunset.getTime() + event.minutesAfterSunset * 60000);
  return { sunset, showtime };
}
