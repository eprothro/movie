// Dusk-to-night tint. Full dusk until 36 hours out, full night at showtime.

const DUSK = {
  top: "#1b2c4e",
  mid: "#c46b62",
  horizon: "#e7a06a",
  ground: "#2c1814",
};

const NIGHT = {
  top: "#070910",
  mid: "#151b30",
  horizon: "#1a1422",
  ground: "#100c10",
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
  set("--sky-top", mix(DUSK.top, NIGHT.top, eased));
  set("--sky-mid", mix(DUSK.mid, NIGHT.mid, eased));
  set("--sky-horizon", mix(DUSK.horizon, NIGHT.horizon, eased));
  set("--sky-ground", mix(DUSK.ground, NIGHT.ground, eased));
  set("--sky-glow", (0.55 - eased * 0.38).toFixed(3));
  root.dataset.sky = eased > 0.78 ? "night" : eased > 0.38 ? "blue" : "dusk";
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute("content", eased > 0.78 ? "#070910" : "#1b2c4e");
  return phase;
}
