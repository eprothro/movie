// Night sky. Always dark. A slightly deeper black as showtime arrives.

const EARLY = {
  top: "#070b16",
  mid: "#10182e",
  horizon: "#16141c",
  ground: "#07080c",
};

const NIGHT = {
  top: "#03040a",
  mid: "#070b14",
  horizon: "#0c0e16",
  ground: "#05060a",
};

function channel(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(from, to, t) {
  const a = channel(from);
  const b = channel(to);
  const c = a.map((value, i) => Math.round(value + (b[i] - value) * t));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function applySky(showtime) {
  const root = document.documentElement;
  let eased = 0;
  let phase = "waiting";
  if (showtime) {
    const hours = (showtime.getTime() - Date.now()) / 36e5;
    const t = clamp(1 - hours / 36, 0, 1);
    eased = t * t * (3 - 2 * t);
    if (hours <= 0) phase = "showing";
  }
  const set = (name, value) => root.style.setProperty(name, value);
  set("--sky-top", mix(EARLY.top, NIGHT.top, eased));
  set("--sky-mid", mix(EARLY.mid, NIGHT.mid, eased));
  set("--sky-horizon", mix(EARLY.horizon, NIGHT.horizon, eased));
  set("--sky-ground", mix(EARLY.ground, NIGHT.ground, eased));
  set("--sky-glow", (0.16 - eased * 0.08).toFixed(3));
  root.dataset.sky = eased > 0.72 ? "night" : "deep";
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute("content", "#07080c");
  return phase;
}
