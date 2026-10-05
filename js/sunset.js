// Sunset for a local calendar date.
// Equations follow the SunCalc / NOAA solar calculator
// (Vladimir Agafonkin, MIT; based on Astronomy Answers / NOAA).
// Accurate to about a minute at mid-latitudes. No network calls.

const PI = Math.PI;
const RAD = PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const J0 = 0.0009;
const OBLIQUITY = RAD * 23.4397;

function toJulian(date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}

function fromJulian(julian) {
  return new Date((julian + 0.5 - J1970) * DAY_MS);
}

function toDays(date) {
  return toJulian(date) - J2000;
}

function rightAscension(eclipticLon, eclipticLat) {
  return Math.atan2(
    Math.sin(eclipticLon) * Math.cos(OBLIQUITY) - Math.tan(eclipticLat) * Math.sin(OBLIQUITY),
    Math.cos(eclipticLon),
  );
}

function declination(eclipticLon, eclipticLat) {
  return Math.asin(
    Math.sin(eclipticLat) * Math.cos(OBLIQUITY) +
      Math.cos(eclipticLat) * Math.sin(OBLIQUITY) * Math.sin(eclipticLon),
  );
}

function solarMeanAnomaly(days) {
  return RAD * (357.5291 + 0.98560028 * days);
}

function eclipticLongitude(anomaly) {
  const center =
    RAD * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));
  const perihelion = RAD * 102.9372;
  return anomaly + center + perihelion + PI;
}

function julianCycle(days, lw) {
  return Math.round(days - J0 - lw / (2 * PI));
}

function approxTransit(hourAngle, lw, cycle) {
  return J0 + (hourAngle + lw) / (2 * PI) + cycle;
}

function solarTransit(daysSince, anomaly, longitude) {
  return J2000 + daysSince + 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * longitude);
}

function hourAngle(altitude, latitude, dec) {
  return Math.acos(
    (Math.sin(altitude) - Math.sin(latitude) * Math.sin(dec)) / (Math.cos(latitude) * Math.cos(dec)),
  );
}

function getSetJulian(altitude, lw, latitude, dec, cycle, anomaly, longitude) {
  const angle = hourAngle(altitude, latitude, dec);
  const approx = approxTransit(angle, lw, cycle);
  return solarTransit(approx, anomaly, longitude);
}

/** UTC instant of official sunset (zenith 90.833°) for the UTC day containing `date`. */
export function sunsetAt(date, latitude, longitude) {
  const lw = RAD * -longitude;
  const phi = RAD * latitude;
  const days = toDays(date);
  const cycle = julianCycle(days, lw);
  const transitDays = approxTransit(0, lw, cycle);
  const anomaly = solarMeanAnomaly(transitDays);
  const longitudeEcl = eclipticLongitude(anomaly);
  const dec = declination(longitudeEcl, 0);
  // -0.833° accounts for refraction and the sun's radius.
  const altitude = -0.833 * RAD;
  return fromJulian(getSetJulian(altitude, lw, phi, dec, cycle, anomaly, longitudeEcl));
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
