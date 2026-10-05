import { EVENT, TOKEN_KEY, movieTitle, shortTitle } from "./config.js";
import { eventShowtime, formatClock } from "./sunset.js";
import { createScene } from "./scene.js";

const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const els = {
  steps: [...document.querySelectorAll(".step")],
  cue: $("cue"),
  showtime: $("showtime"),
  countdowns: [...document.querySelectorAll("[data-countdown]")],
  countdownSr: $("countdown-sr"),
  closed: $("closed-note"),
  closedRoute: $("closed-route"),
  cant: $("cant"),
  keep: $("keep"),
  posters: $("posters"),
  also: $("also"),
  nameForm: $("name-form"),
  name: $("name"),
  nameError: $("name-error"),
  nameSubmit: $("name-submit"),
  partyValue: $("party-value"),
  partyDec: $("party-dec"),
  partyInc: $("party-inc"),
  chairs: $("chairs"),
  cantForm: $("cant-form"),
  cantName: $("cant-name"),
  cantError: $("cant-error"),
  cantSubmit: $("cant-submit"),
  hpName: $("hp-name"),
  hpCant: $("hp-cant"),
  confirmTitle: $("confirm-title"),
  confirmSub: $("confirm-sub"),
  votes: $("votes"),
  change: $("change"),
  card: $("screen-card"),
  kicker: $("screen-kicker"),
  line: $("screen-line"),
  sub: $("screen-sub"),
  pop: $("pop"),
};

const state = {
  step: "pick",
  pick: null,
  also: null,
  partySize: 1,
  token: readToken(),
  rsvp: null,
  flags: { rsvpsOpen: true, votingOpen: true },
  editing: false,
  saving: false,
  standings: null,
  showtime: null,
  showing: false,
};

const ERRORS = {
  name: "Add your name.",
  party: "Pick 1 to 10.",
  attend: "Pick a movie.",
  vote: "Pick a movie.",
  closed: "RSVPs are closed.",
  rate: "Too many tries. Give it a few minutes.",
  not_found: "That RSVP isn't on the list anymore. Send it again.",
  network: "Couldn't save. Try again.",
};

const MAP_APPLE = `https://maps.apple.com/?daddr=${encodeURIComponent(EVENT.address)}&dirflg=d`;
const MAP_GOOGLE = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(EVENT.address)}`;
const CHAIR_COLORS = ["#ffcf7d", "#ff9f8a", "#8fc4ff", "#9ee0a0", "#d4a6ff", "#ffe08a"];
let advanceTimer = 0;
let swapTimer = 0;
let lastCard = "";

const scene = createScene({
  world: $("world"),
  stage: $("rsvp"),
  hero: $("hero"),
  reduced,
  onScreen(screen) {
    const open = screen === "card";
    els.posters.classList.toggle("is-in", open);
    els.posters.inert = !open;
  },
});
// A saved token means they may already have an RSVP. Hold the leader until
// boot confirms it; a dead token puts the countdown back.
if (state.token) scene.skipLeader();

initShowtime();
bind();
setParty(1);
wireDirections();
setStep("pick", { focus: false, scroll: false });
boot();
registerWorker();

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function writeToken(token) {
  state.token = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode keeps the token in memory */
  }
}

/* Showtime + countdown */

function initShowtime() {
  const times = eventShowtime(EVENT);
  if (!times) {
    els.showtime.textContent = "after sunset";
    return;
  }
  state.showtime = times.showtime;
  els.showtime.textContent = formatClock(times.showtime, EVENT.timezone);
  document.querySelectorAll("[data-showtime]").forEach((el) => {
    el.textContent = els.showtime.textContent;
  });
  els.showtime.dateTime = times.showtime.toISOString();
  tickCountdown();
  window.setInterval(tickCountdown, 1000);
}

function tickCountdown() {
  const diff = state.showtime.getTime() - Date.now();
  let html;
  let spoken;
  if (diff <= 0) {
    const live = -diff < 3 * 3600e3;
    html = live ? "Now showing" : "That was a good one";
    spoken = html;
    if (live !== state.showing) {
      state.showing = live;
      paintScreen();
    }
  } else {
    const total = Math.floor(diff / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts = [];
    if (d) parts.push([d, "d"]);
    if (d || h) parts.push([h, "h"]);
    parts.push([m, "m"], [s, "s"]);
    html = parts.map(([n, u]) => `<span><b>${String(n).padStart(u === "d" ? 1 : 2, "0")}</b>${u}</span>`).join("");
    spoken = `${d ? `${d} days, ` : ""}${h} hours, ${m} minutes until showtime`;
  }
  els.countdowns.forEach((el) => {
    if (el.innerHTML !== html) el.innerHTML = html;
  });
  if (els.countdownSr.textContent !== spoken && (diff <= 0 || diff % 60000 < 1000 || !els.countdownSr.textContent)) {
    els.countdownSr.textContent = spoken;
  }
}

/* Directions */

function prefersAppleMaps() {
  const ua = navigator.userAgent || "";
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOs;
}

function wireDirections() {
  const apple = prefersAppleMaps();
  document.querySelectorAll("[data-dir]").forEach((a) => {
    a.href = apple ? MAP_APPLE : MAP_GOOGLE;
  });
  document.querySelectorAll("[data-dir-alt]").forEach((a) => {
    a.href = apple ? MAP_GOOGLE : MAP_APPLE;
    a.textContent = apple ? "Google Maps" : "Apple Maps";
  });
}

/* Flow */

function bind() {
  const toStage = (event) => {
    event.preventDefault();
    const heading = () => els.steps.find((s) => s.dataset.step === state.step)?.querySelector("h2");
    if (reduced) heading()?.focus();
    else scene.goToStage({ done: () => heading()?.focus({ preventScroll: true }) });
  };
  els.cue.addEventListener("click", toStage);
  document.querySelector(".skip").addEventListener("click", toStage);

  els.cant.addEventListener("click", () => {
    if (!state.flags.rsvpsOpen) return;
    setStep("cant");
  });

  els.keep.addEventListener("click", () => {
    if (state.rsvp) showConfirm(state.rsvp);
  });

  els.posters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-movie]");
    if (!button || state.step !== "pick" || !state.flags.rsvpsOpen) return;
    state.pick = button.dataset.movie;
    markPosters();
    button.classList.remove("is-chosen");
    void button.offsetWidth;
    button.classList.add("is-chosen");
    advanceSoon("other");
  });

  els.also.addEventListener("click", (event) => {
    const button = event.target.closest("[data-also]");
    if (!button || state.step !== "other") return;
    state.also = button.dataset.also;
    markAlso();
    advanceSoon("name");
  });

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", goBack);
  });

  els.partyDec.addEventListener("click", () => setParty(state.partySize - 1));
  els.partyInc.addEventListener("click", () => setParty(state.partySize + 1));

  els.name.addEventListener("input", () => clearError(els.name, els.nameError));
  els.cantName.addEventListener("input", () => clearError(els.cantName, els.cantError));
  for (const input of [els.name, els.cantName]) {
    input.addEventListener("focus", () => {
      document.documentElement.classList.add("is-typing");
      placeField();
      window.clearTimeout(placeTimer);
      placeTimer = window.setTimeout(placeField, 350);
    });
    input.addEventListener("blur", releaseField);
  }
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", onViewport);
    vv.addEventListener("scroll", onViewport);
  }

  els.nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitComing();
  });
  els.cantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCant();
  });

  els.change.addEventListener("click", beginEdit);
}

function advanceSoon(step) {
  window.clearTimeout(advanceTimer);
  advanceTimer = window.setTimeout(() => setStep(step), reduced ? 0 : 260);
}

function goBack() {
  const back = { other: "pick", name: "other", cant: "pick" }[state.step];
  if (back) setStep(back, { back: true });
}

function setStep(step, { focus = true, scroll = true, back = false } = {}) {
  const prev = state.step;
  state.step = step;
  document.body.dataset.step = step;
  els.steps.forEach((el) => {
    const on = el.dataset.step === step;
    el.classList.toggle("is-active", on);
    el.classList.toggle("is-leaving-back", !on && back && el.dataset.step === prev);
    el.inert = !on;
    el.setAttribute("aria-hidden", on ? "false" : "true");
  });

  if (step === "pick") {
    syncPick();
    markPosters();
  }
  if (step === "other") markAlso();
  if (step === "name") {
    const conditional = state.also === "no" && state.pick;
    els.nameSubmit.textContent = state.rsvp ? "Update" : conditional ? "Save our spot" : "Count me in";
    document.getElementById("name-title").textContent = conditional
      ? `Who's coming? (assuming ${movieTitle(state.pick)} wins)`
      : "Who's coming?";
  }
  if (step === "cant") els.cantSubmit.textContent = state.rsvp ? "Update" : "Send";

  paintScreen();

  if (scroll && !scene.atStage()) scene.goToStage();
  if (!focus) return;
  const active = els.steps.find((el) => el.dataset.step === step);
  if (step === "name" && !els.name.value) holdField(els.name);
  else if (step === "cant" && !els.cantName.value) holdField(els.cantName);
  else active.querySelector("h2")?.focus({ preventScroll: true });
}

// The steps are only a viewport tall and the scene is position:fixed, so a
// keyboard that overlays the layout has nothing to scroll the field into.
// While one is open, drop scroll-snap, pad by the overlap, and move the
// field and its button into the visual viewport.
let placeTimer = 0;
let placing = false;

function typingField() {
  const el = document.activeElement;
  return el === els.name || el === els.cantName ? el : null;
}

function keyboardOverlap() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

function placeField() {
  const input = typingField();
  if (!input) return;
  document.documentElement.classList.add("is-typing");
  document.documentElement.style.setProperty("--kb", `${keyboardOverlap()}px`);
  const vv = window.visualViewport;
  const viewTop = vv ? vv.offsetTop : 0;
  const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const submit = input.form.querySelector('[type="submit"]');
  const pad = 12;
  const field = input.getBoundingClientRect();
  const button = submit.getBoundingClientRect();
  let delta = 0;
  if (button.bottom > viewBottom - pad) delta = button.bottom - (viewBottom - pad);
  if (field.top - delta < viewTop + pad) delta = field.top - (viewTop + pad);
  if (Math.abs(delta) < 2) return;
  placing = true;
  window.scrollBy(0, delta);
  requestAnimationFrame(() => {
    placing = false;
  });
}

function holdField(input) {
  document.documentElement.classList.add("is-typing");
  input.focus({ preventScroll: true });
  placeField();
  window.clearTimeout(placeTimer);
  // iOS animates the keyboard for about 300ms and fires visualViewport along the way.
  placeTimer = window.setTimeout(placeField, 350);
}

function releaseField() {
  window.setTimeout(() => {
    if (typingField()) return;
    window.clearTimeout(placeTimer);
    document.documentElement.classList.remove("is-typing");
    document.documentElement.style.removeProperty("--kb");
  }, 80);
}

function onViewport() {
  if (placing || !typingField()) return;
  window.clearTimeout(placeTimer);
  placeTimer = window.setTimeout(placeField, 60);
}

function syncPick() {
  const open = state.flags.rsvpsOpen;
  els.closed.hidden = open;
  els.posters.hidden = !open;
  els.cant.hidden = !open;
  els.closedRoute.hidden = open;
  els.keep.hidden = !(state.editing && state.rsvp);
  document.getElementById("pick-title").textContent = !open
    ? "RSVPs are closed."
    : state.flags.votingOpen
      ? "Pick the movie. Most votes wins."
      : "Which movie are you coming for?";
}

function markPosters() {
  els.posters.querySelectorAll("[data-movie]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.movie === state.pick));
  });
}

function markAlso() {
  els.also.querySelectorAll("[data-also]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.also === state.also));
  });
  const other = otherMovie(state.pick);
  document.getElementById("other-title").textContent = state.flags.votingOpen
    ? `And if ${movieTitle(other)} wins?`
    : `And if it's ${movieTitle(other)}?`;
}

function otherMovie(id) {
  return EVENT.movies.find((movie) => movie.id !== id)?.id || EVENT.movies[0].id;
}

function beginEdit() {
  const rsvp = state.rsvp;
  if (!rsvp || !state.flags.rsvpsOpen) return;
  state.editing = true;
  const attend = rsvp.would_attend;
  state.pick = rsvp.vote || (EVENT.movies.some((movie) => movie.id === attend) ? attend : null);
  state.also = attend === "both" ? "yes" : attend === "none" ? null : "no";
  els.name.value = rsvp.name || "";
  els.cantName.value = rsvp.name || "";
  setParty(rsvp.party_size || 1, { quiet: true });
  clearError(els.name, els.nameError);
  clearError(els.cantName, els.cantError);
  setStep("pick");
}

/* Party size */

function chairEl(index) {
  const el = document.createElement("span");
  el.className = "chair";
  el.style.setProperty("--chair", CHAIR_COLORS[index % CHAIR_COLORS.length]);
  el.innerHTML =
    '<svg viewBox="0 0 30 36" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 3h14l-1.5 15h-11z" fill="currentColor" fill-opacity="0.35"/>' +
    '<path d="M5 19.5h20" stroke-width="3"/><path d="M8 20l-3 13M22 20l3 13M9 20l13 13M21 20L8 33"/></svg>';
  return el;
}

function setParty(next, { quiet = false } = {}) {
  const prev = state.partySize;
  state.partySize = Math.min(10, Math.max(1, next));
  els.partyValue.textContent = String(state.partySize);
  els.partyValue.setAttribute("aria-label", state.partySize === 1 ? "1 person" : `${state.partySize} people`);
  els.partyDec.disabled = state.partySize <= 1;
  els.partyInc.disabled = state.partySize >= 10;
  const root = els.chairs;
  const n = state.partySize;
  if (quiet || reduced || root.children.length === 0) {
    root.replaceChildren(...Array.from({ length: n }, (_, i) => chairEl(i)));
    return;
  }
  if (n > prev) {
    while (root.children.length < n) {
      const el = chairEl(root.children.length);
      el.classList.add("is-new");
      root.append(el);
    }
  } else {
    [...root.querySelectorAll(".chair.leave")].forEach((el) => el.remove());
    while (root.children.length > n) {
      const last = root.lastElementChild;
      if (root.children.length === n + 1) {
        last.classList.add("leave");
        last.addEventListener("animationend", () => last.remove(), { once: true });
        break;
      }
      last.remove();
    }
  }
}

/* Screen */

function cardFor() {
  const time = els.showtime.textContent;
  const r = state.rsvp;
  switch (state.step) {
    case "pick":
      if (state.showing) return ["Now showing", winnerTitle(), ""];
      if (!state.flags.rsvpsOpen) return [`Sat, Oct 10 · ${time}`, "RSVPs closed", ""];
      if (!state.flags.votingOpen) return ["Movie night", "Coming for?", ""];
      return ["Movie night", "Pick the movie", "Most votes wins"];
    case "other": {
      const other = shortTitle(otherMovie(state.pick));
      return state.flags.votingOpen ? ["And if", `${other} wins?`, ""] : ["And if it's", `${other}?`, ""];
    }
    case "name":
      return state.also === "no" && state.pick
        ? ["", "Who's coming?", `(assuming ${movieTitle(state.pick)} wins)`]
        : ["", "Who's coming?", ""];
    case "cant":
      return ["", "We'll see you next time!", ""];
    case "confirm": {
      if (!r) return ["", "", ""];
      if (r.would_attend === "none") return ["", "We'll see you next time!", ""];
      const title = movieTitle(r.vote || r.would_attend);
      if (r.would_attend !== "both") return ["", "See you Saturday", `if ${title} wins`];
      return ["", "See you Saturday", ""];
    }
    default:
      return ["", "", ""];
  }
}

function paintScreen() {
  const [kicker, line, sub] = cardFor();
  const key = `${kicker}|${line}|${sub}`;
  if (key === lastCard) return;
  const first = !lastCard;
  const prevLine = lastCard.split("|")[1] || "";
  lastCard = key;
  const apply = () => {
    els.kicker.textContent = kicker;
    els.line.textContent = line;
    els.line.classList.toggle("is-long", line.length > 14);
    els.card.classList.toggle("is-saturday", line === "See you Saturday");
    els.sub.textContent = sub;
    els.card.classList.remove("is-swapping");
  };
  window.clearTimeout(swapTimer);
  // Saturday copy swaps in place. A fade would hold the previous line
  // ("Your vote", the title, or "if … wins") over the new one.
  const saturday = prevLine === "See you Saturday" || line === "See you Saturday";
  if (first || reduced || saturday || document.body.dataset.screen !== "card") {
    apply();
    return;
  }
  els.card.classList.add("is-swapping");
  swapTimer = window.setTimeout(apply, 180);
}

function winnerTitle() {
  const v = state.standings?.votes || {};
  const ranked = EVENT.movies.map((movie) => ({ movie, votes: Number(v[movie.id]) || 0 }));
  if (ranked[0].votes === ranked[1].votes) return "Movie Night";
  return (ranked[0].votes > ranked[1].votes ? ranked[0] : ranked[1]).movie.title;
}

function popcorn() {
  if (reduced) return;
  const root = els.pop;
  root.replaceChildren();
  for (let i = 0; i < 18; i += 1) {
    const k = document.createElement("i");
    const angle = (-90 + (i - 8.5) * 9) * (Math.PI / 180);
    const dist = 16 + (i % 5) * 4;
    k.style.setProperty("--x", `calc(${(Math.cos(angle) * dist * 1.6).toFixed(1)} * var(--s))`);
    k.style.setProperty("--y", `calc(${(Math.sin(angle) * dist).toFixed(1)} * var(--s))`);
    k.style.setProperty("--rot", `${(i % 2 ? 1 : -1) * (120 + i * 20)}deg`);
    k.style.setProperty("--delay", `${(i % 6) * 0.04}s`);
    root.append(k);
  }
  window.setTimeout(() => root.replaceChildren(), 1700);
}

/* Confirm */

function showConfirm(rsvp, { celebrate = false, focus = true, scroll = true } = {}) {
  state.rsvp = rsvp;
  state.editing = false;
  scene.skipLeader();
  const coming = rsvp.would_attend !== "none";
  const definite = rsvp.would_attend === "both";
  const title = movieTitle(rsvp.vote || rsvp.would_attend);
  els.confirmTitle.textContent = !coming
    ? "We'll see you next time!"
    : definite
      ? "See you Saturday."
      : `See you Saturday if ${title} wins.`;
  // Saturday is on the screen for anyone coming. The heading stays for
  // assistive tech, because the screen itself is hidden from it.
  els.confirmTitle.classList.add("sr-only");
  els.confirmTitle.closest(".step").classList.toggle("is-coming", coming);
  els.confirmSub.textContent = "";
  els.change.hidden = !state.flags.rsvpsOpen;
  setStep("confirm", { focus, scroll });
  renderVotes();
  if (celebrate && definite) window.setTimeout(popcorn, 200);
}

function renderVotes() {
  const v = state.standings?.votes || {};
  const counts = Object.fromEntries(EVENT.movies.map((movie) => [movie.id, Number(v[movie.id]) || 0]));
  const max = Math.max(...Object.values(counts), 1);
  const mine = state.rsvp?.vote || null;
  els.votes.querySelectorAll(".bucket").forEach((bucket) => {
    const id = bucket.dataset.movie;
    const n = counts[id];
    bucket.querySelector("b").textContent = String(n);
    bucket.classList.toggle("is-mine", id === mine);
    const fill = n ? 0.35 + 0.65 * (n / max) : 0;
    const corn = bucket.querySelector(".corn");
    requestAnimationFrame(() => {
      corn.style.transform = `translateY(${((1 - fill) * 100).toFixed(1)}%)`;
    });
  });
  els.votes.setAttribute(
    "aria-label",
    `Votes so far: ${EVENT.movies.map((movie) => `${movie.title} ${counts[movie.id]}`).join(", ")}.`,
  );
}

/* Saving */

function nameValue(input) {
  return input.value.trim().replace(/\s+/g, " ");
}

function setError(input, el, code) {
  el.hidden = false;
  el.textContent = ERRORS[code] || ERRORS.network;
  if (code === "name") input.setAttribute("aria-invalid", "true");
}

function clearError(input, el) {
  if (el.hidden) return;
  el.hidden = true;
  el.textContent = "";
  input.removeAttribute("aria-invalid");
}

function submitComing() {
  const name = nameValue(els.name);
  if (!name || name.length > 60) {
    setError(els.name, els.nameError, "name");
    holdField(els.name);
    return;
  }
  if (!state.pick) return setStep("pick");
  if (!state.also) return setStep("other");
  const attend = state.also === "yes" ? "both" : state.pick;
  save(
    {
      p_name: name,
      p_party_size: state.partySize,
      p_would_attend: attend,
      p_vote: state.pick,
      p_note: "",
      p_honeypot: els.hpName.value,
      p_token: state.token || null,
    },
    els.name,
    els.nameError,
    els.nameSubmit,
  );
}

function submitCant() {
  const name = nameValue(els.cantName);
  if (!name || name.length > 60) {
    setError(els.cantName, els.cantError, "name");
    holdField(els.cantName);
    return;
  }
  save(
    {
      p_name: name,
      p_party_size: 1,
      p_would_attend: "none",
      p_vote: null,
      p_note: "",
      p_honeypot: els.hpCant.value,
      p_token: state.token || null,
    },
    els.cantName,
    els.cantError,
    els.cantSubmit,
  );
}

async function save(payload, input, errorEl, button) {
  if (state.saving) return;
  state.saving = true;
  const label = button.textContent;
  button.setAttribute("aria-busy", "true");
  input.blur();
  try {
    const { rpc } = await import("./api.js");
    let data = await rpc("movie_submit_rsvp", payload);
    if (data?.ok === false && data.error === "not_found" && payload.p_token) {
      writeToken("");
      data = await rpc("movie_submit_rsvp", { ...payload, p_token: null });
    }
    if (!data || data.ok === false) {
      const code = data?.error || "network";
      if (code === "closed") state.flags.rsvpsOpen = false;
      setError(input, errorEl, code);
      return;
    }
    writeToken(data.token || state.token);
    if (data.standings) {
      state.standings = data.standings;
      state.flags.rsvpsOpen = data.standings.rsvps_open !== false;
      state.flags.votingOpen = data.standings.voting_open !== false;
    }
    showConfirm(data.rsvp, { celebrate: true });
  } catch (error) {
    console.error(error);
    setError(input, errorEl, "network");
  } finally {
    state.saving = false;
    button.removeAttribute("aria-busy");
    button.textContent = label;
  }
}

/* Boot */

async function boot() {
  let rpc;
  try {
    ({ rpc } = await import("./api.js"));
  } catch (error) {
    console.error(error);
    return;
  }
  const settle = (promise) => promise.then((data) => ({ ok: true, data }), () => ({ ok: false, data: null }));
  const [standings, mine] = await Promise.all([
    settle(rpc("movie_get_standings")),
    state.token ? settle(rpc("movie_get_rsvp", { p_token: state.token })) : Promise.resolve(null),
  ]);

  if (standings.ok && standings.data && standings.data.ok !== false) {
    state.standings = standings.data;
    state.flags.rsvpsOpen = standings.data.rsvps_open !== false;
    state.flags.votingOpen = standings.data.voting_open !== false;
  }

  if (mine?.ok && mine.data?.ok !== false && !mine.data?.rsvp) {
    writeToken("");
    scene.allowLeader();
  }

  document.documentElement.classList.remove("has-token");
  const rsvp = mine?.data?.rsvp || null;
  if (rsvp && state.step === "pick") {
    showConfirm(rsvp, { focus: false, scroll: false });
    return;
  }
  if (rsvp) state.rsvp = rsvp;
  if (state.step === "pick") syncPick();
  paintScreen();
}

function registerWorker() {
  const host = location.hostname;
  if (!("serviceWorker" in navigator)) return;
  if (host !== "movie.prothro.site" && !host.endsWith("github.io")) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
