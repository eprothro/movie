import { EVENT, TOKEN_KEY, movieTitle, shortTitle } from "./config.js";
import { eventShowtime, formatClock, isEventDayAfternoon } from "./sunset.js";
import { createScene } from "./scene.js";

const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const els = {
  steps: [...document.querySelectorAll(".step")],
  cue: $("cue"),
  stage: $("rsvp"),
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
  pass: $("pass"),
  passPosters: $("pass-posters"),
  passError: $("pass-error"),
  undo: $("undo"),
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

const SEE_YOU = `See you ${EVENT.weekday}`;
const MAP_POINT = `${EVENT.latitude},${EVENT.longitude}`;
const MAP_APPLE = `https://maps.apple.com/?daddr=${MAP_POINT}&dirflg=d`;
const MAP_GOOGLE = `https://www.google.com/maps/dir/?api=1&destination=${MAP_POINT}`;
const MAP_GEO = `geo:0,0?q=${MAP_POINT}(Prothro%20Movie%20Night)`;
const CHAIR_COLORS = ["#ffcf7d", "#ff9f8a", "#8fc4ff", "#9ee0a0", "#d4a6ff", "#ffe08a"];
const FIT_STEPS = new Set(["other", "name", "cant", "pass"]);
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

function clockNow() {
  const raw = new URLSearchParams(location.search).get("now");
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function applyIntro() {
  const date = document.getElementById("date-label");
  const rm = document.getElementById("rm-date");
  const tonight = isEventDayAfternoon(clockNow(), EVENT);
  if (date) date.textContent = tonight ? "Tonight" : EVENT.dateShort;
  if (rm) rm.textContent = tonight ? "Tonight" : EVENT.dateShort;
  if (!tonight) return;
  const where = document.querySelector(".hero .where");
  if (!where) return;
  where.classList.add("is-tonight");
  const label = where.querySelector("span");
  if (label) label.textContent = "Directions";
}

function initShowtime() {
  applyIntro();
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
  const diff = state.showtime.getTime() - clockNow().getTime();
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

function mapsHref() {
  const ua = navigator.userAgent || "";
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || iPadOs) return MAP_APPLE;
  if (/Android/i.test(ua)) return MAP_GEO;
  return MAP_GOOGLE;
}

function wireDirections() {
  const href = mapsHref();
  document.querySelectorAll("[data-dir]").forEach((a) => {
    a.setAttribute("href", href);
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
  els.passPosters.addEventListener("click", onPassPoster);

  els.name.addEventListener("input", () => clearError(els.name, els.nameError));
  els.cantName.addEventListener("input", () => clearError(els.cantName, els.cantError));
  for (const input of [els.name, els.cantName]) {
    input.addEventListener("animationend", () => input.classList.remove("is-shaking"));
    input.addEventListener("pointerdown", markTyping);
    input.addEventListener("focus", markTyping);
    input.addEventListener("blur", releaseField);
  }

  els.nameSubmit.addEventListener("pointerdown", markTyping);
  els.cantSubmit.addEventListener("pointerdown", markTyping);
  window.visualViewport?.addEventListener("resize", onViewport);
  const sizes = new ResizeObserver(fitStage);
  els.steps
    .filter((el) => FIT_STEPS.has(el.dataset.step) || el.dataset.step === "confirm")
    .forEach((el) => sizes.observe(el));

  els.nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitComing();
  });
  els.cantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCant();
  });

  els.pass.addEventListener("click", beginPass);
  els.undo.addEventListener("click", undoPass);
  els.change.addEventListener("click", beginEdit);
  bindProjector();
}

// A second tap on the backyard projector opens the booth. One tap does nothing.
const PROJECTOR_TAP_MS = 400;

function bindProjector() {
  const el = document.getElementById("projector");
  if (!el) return;
  let last = 0;
  el.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const now = event.timeStamp;
    if (last && now - last < PROJECTOR_TAP_MS) {
      last = 0;
      window.location.assign("/admin/");
      return;
    }
    last = now;
  });
}

function advanceSoon(step) {
  window.clearTimeout(advanceTimer);
  advanceTimer = window.setTimeout(() => setStep(step), reduced ? 0 : 260);
}

function goBack() {
  const back = { other: "pick", name: "other", cant: "pick", pass: "confirm" }[state.step];
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
    els.nameSubmit.textContent = nameButtonLabel();
    document.getElementById("name-title").textContent = conditional
      ? `Who's coming? (assuming ${movieTitle(state.pick)} wins)`
      : "Who's coming?";
  }
  if (step === "cant") els.cantSubmit.textContent = state.rsvp ? "Update" : "Send";
  if (step === "pass") {
    els.passPosters.querySelectorAll(".poster").forEach((poster) => poster.classList.remove("is-chosen"));
    els.passError.hidden = true;
    els.passError.textContent = "";
  }

  fitStage();
  paintScreen();

  if ((prev === "name" || prev === "cant") && step !== prev) settleTyping();

  if (scroll && !scene.atStage()) scene.goToStage();
  if (!focus) return;
  const active = els.steps.find((el) => el.dataset.step === step);
  if (step === "name" && !els.name.value) holdField(els.name);
  else if (step === "cant" && !els.cantName.value) holdField(els.cantName);
  else active.querySelector("h2")?.focus({ preventScroll: true });
}

// The form's resting place is layout only (.stage.is-fit in site.css): the
// gap above it shrinks until the button ends above Safari's toolbar.
function fitStage() {
  const active = els.steps.find((el) => el.dataset.step === state.step);
  // Passing the phone adds a control, and sometimes an undo. Lift that
  // confirmation the same way as the name form so both actions clear a short
  // phone. A solo confirmation keeps the original gap.
  const passShown = state.step === "confirm" && (!els.pass.hidden || !els.undo.hidden);
  const fit = Boolean(active) && (FIT_STEPS.has(state.step) || passShown);
  els.stage.classList.toggle("is-fit", fit);
  // The pass action sits on the last row, under the tally. Keep it above
  // the home indicator on a 667pt phone.
  const slack = passShown ? 16 : 0;
  if (fit) els.stage.style.setProperty("--step-h", `${active.offsetHeight + slack}px`);
  else els.stage.style.removeProperty("--step-h");
}

// The keyboard. iOS keeps the layout viewport and shrinks only the visual
// one, then scrolls the focused field above the keyboard but leaves the
// button under it. Once the keyboard has settled, lift the form once so the
// button clears it too; once the keyboard has gone, put the stage back.
// Following every viewport event instead fed scroll, snap and the viewport
// into each other and the page bounced. So snap is off while a field is
// focused, visualViewport scroll is never read, and a settled keyboard height
// is handled once, so our own scroll cannot start another pass.
const KEYBOARD_MIN = 150; // bigger than a toolbar showing or hiding
const SETTLE_MS = 160;
const EDGE = 12;
let typingTimer = 0;
let settleTimer = 0;
let openHeight = window.visualViewport?.height || 0;
let liftedFor = 0;

function typingField() {
  const el = document.activeElement;
  return el === els.name || el === els.cantName ? el : null;
}

function keyboardHeight() {
  const vv = window.visualViewport;
  return vv ? Math.max(0, openHeight - vv.height) : 0;
}

function markTyping() {
  window.clearTimeout(typingTimer);
  document.documentElement.classList.add("is-typing");
}

function settleTyping() {
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(afterKeyboard, 700);
}

function onViewport() {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(settleViewport, SETTLE_MS);
}

function settleViewport() {
  const field = typingField();
  const keyboard = keyboardHeight();
  if (!field) {
    if (keyboard > KEYBOARD_MIN) return;
    openHeight = window.visualViewport.height;
    afterKeyboard();
    return;
  }
  if (keyboard <= KEYBOARD_MIN || Math.abs(keyboard - liftedFor) < 40) return;
  liftedFor = keyboard;
  liftForm(field);
}

function liftForm(field) {
  const vv = window.visualViewport;
  const button = field.form?.querySelector('[type="submit"]');
  if (!vv || !button) return;
  const top = vv.offsetTop + EDGE;
  const bottom = vv.offsetTop + vv.height - EDGE;
  const label = field.closest(".field") || field;
  const dy = Math.min(button.getBoundingClientRect().bottom - bottom, label.getBoundingClientRect().top - top);
  if (dy < 1) return;
  document.documentElement.classList.add("is-lifted");
  const target = Math.round(window.scrollY + dy);
  window.scrollTo(0, target);
  const short = target - window.scrollY;
  if (short > 1) {
    els.stage.style.setProperty("--room", `${Math.ceil(short)}px`);
    window.scrollTo(0, target);
  }
}

function afterKeyboard() {
  if (typingField() || keyboardHeight() > KEYBOARD_MIN) return;
  window.clearTimeout(typingTimer);
  liftedFor = 0;
  if (els.stage.style.getPropertyValue("--room")) els.stage.style.removeProperty("--room");
  // Every step that takes a name rests at the stage top.
  const top = scene.stageTop;
  if (window.scrollY > top + 1) window.scrollTo(0, top);
  document.documentElement.classList.remove("is-typing", "is-lifted");
}

function holdField(input) {
  markTyping();
  input.focus({ preventScroll: true });
}

function releaseField() {
  settleTyping();
}

function rejectEmpty(input, errorEl) {
  errorEl.hidden = true;
  errorEl.textContent = "";
  markTyping();
  input.setAttribute("aria-invalid", "true");
  input.classList.add("is-invalid");
  input.classList.remove("is-shaking");
  void input.offsetWidth;
  input.classList.add("is-shaking");
  input.focus({ preventScroll: true });
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

function nameButtonLabel() {
  if (state.rsvp) return "Update";
  if (state.also === "no" && state.pick) return "Save our spot";
  return state.partySize > 1 ? "Count us in" : "Count me in";
}

function setParty(next, { quiet = false } = {}) {
  const prev = state.partySize;
  state.partySize = Math.min(10, Math.max(1, next));
  els.partyValue.textContent = String(state.partySize);
  els.partyValue.setAttribute("aria-label", state.partySize === 1 ? "1 person" : `${state.partySize} people`);
  els.partyDec.disabled = state.partySize <= 1;
  els.partyInc.disabled = state.partySize >= 10;
  if (state.step === "name") els.nameSubmit.textContent = nameButtonLabel();
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
      if (!state.flags.rsvpsOpen) return [`${EVENT.dateCompact} · ${time}`, "RSVPs closed", ""];
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
    case "pass":
      return ["", "Your turn!", "Tap your movie"];
    case "confirm": {
      if (!r) return ["", "", ""];
      if (r.would_attend === "none") return ["", "We'll see you next time!", ""];
      const title = movieTitle(r.vote || r.would_attend);
      if (r.would_attend !== "both") return ["", SEE_YOU, `if ${title} wins`];
      return ["", SEE_YOU, ""];
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
    els.card.classList.toggle("is-friday", line === SEE_YOU);
    els.sub.textContent = sub;
    els.card.classList.remove("is-swapping");
  };
  window.clearTimeout(swapTimer);
  // The see-you line swaps in place. A fade would hold the previous line
  // ("Your vote", the title, or "if … wins") over the new one.
  const seeYou = prevLine === SEE_YOU || line === SEE_YOU;
  if (first || reduced || seeYou || document.body.dataset.screen !== "card") {
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

// The RSVP vote is the first person's. Each later tap is one more person.
// Anyone who has not tapped yet still counts toward that first movie, so the
// shares always add up to the party.
function extraVotes(rsvp) {
  return Array.isArray(rsvp?.extra_votes) ? rsvp.extra_votes.filter(Boolean) : [];
}

function shares(rsvp) {
  const party = Number(rsvp?.party_size) || 0;
  const extras = extraVotes(rsvp);
  const unvoted = Math.max(0, party - 1 - extras.length);
  const counts = Object.fromEntries(EVENT.movies.map((movie) => [movie.id, 0]));
  if (rsvp?.vote) counts[rsvp.vote] = (counts[rsvp.vote] || 0) + 1 + unvoted;
  for (const id of extras) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

function tallyLine(rsvp) {
  const extras = extraVotes(rsvp);
  if (!rsvp || !extras.length || rsvp.would_attend === "none") return "";
  const party = Number(rsvp.party_size) || 0;
  const voted = Math.min(party, 1 + extras.length);
  if (voted >= party) return `All ${party} of us voted`;
  return `${voted} of ${party} of us voted`;
}

function canPass(rsvp) {
  const party = Number(rsvp?.party_size) || 0;
  return Boolean(
    rsvp
    && state.flags.rsvpsOpen
    && state.flags.votingOpen
    && rsvp.would_attend !== "none"
    && party >= 2
    && EVENT.movies.some((movie) => movie.id === rsvp.vote)
    && extraVotes(rsvp).length < party - 1,
  );
}

function canUndo(rsvp) {
  return Boolean(
    rsvp
    && state.flags.rsvpsOpen
    && state.flags.votingOpen
    && rsvp.would_attend !== "none"
    && extraVotes(rsvp).length > 0,
  );
}

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
      ? `${SEE_YOU}.`
      : `${SEE_YOU} if ${title} wins.`;
  // The weekday is on the screen for anyone coming. The heading stays for
  // assistive tech, because the screen itself is hidden from it.
  els.confirmTitle.classList.add("sr-only");
  els.confirmTitle.closest(".step").classList.toggle("is-coming", coming);
  els.confirmSub.textContent = tallyLine(rsvp);
  els.pass.hidden = !canPass(rsvp);
  els.undo.hidden = !canUndo(rsvp);
  els.change.hidden = !state.flags.rsvpsOpen;
  setStep("confirm", { focus, scroll });
  renderVotes();
  if (celebrate && definite && !extraVotes(rsvp).length) window.setTimeout(popcorn, 200);
}

function beginPass() {
  if (state.saving || !canPass(state.rsvp)) return;
  setStep("pass");
}

function onPassPoster(event) {
  const button = event.target.closest("[data-pass]");
  // Set the lock before any await, so a second tap in the same beat cannot
  // cast a second vote.
  if (!button || state.step !== "pass" || state.saving) return;
  state.saving = true;
  button.classList.add("is-chosen");
  savePass(button.dataset.pass);
}

function undoPass() {
  if (state.saving || !canUndo(state.rsvp)) return;
  state.saving = true;
  savePass(null);
}

function renderVotes() {
  const v = state.standings?.votes || {};
  const counts = Object.fromEntries(EVENT.movies.map((movie) => [movie.id, Number(v[movie.id]) || 0]));
  const max = Math.max(...Object.values(counts), 1);
  const passed = extraVotes(state.rsvp);
  const mineShares = passed.length ? shares(state.rsvp) : null;
  const mine = state.rsvp?.would_attend === "none" ? null : state.rsvp?.vote || null;
  els.votes.querySelectorAll(".bucket").forEach((bucket) => {
    const id = bucket.dataset.movie;
    const n = counts[id];
    bucket.querySelector("b").textContent = String(n);
    const ours = mineShares ? (mineShares[id] || 0) > 0 : id === mine;
    bucket.classList.toggle("is-mine", Boolean(ours));
    const you = bucket.querySelector(".you");
    if (mineShares && (mineShares[id] || 0) > 0) you.textContent = `${mineShares[id]} of us`;
    else you.textContent = "Your vote";
    const fill = n ? 0.35 + 0.65 * (n / max) : 0;
    const corn = bucket.querySelector(".corn");
    requestAnimationFrame(() => {
      corn.style.transform = `translateY(${((1 - fill) * 100).toFixed(1)}%)`;
    });
  });
  els.votes.setAttribute(
    "aria-label",
    `People so far: ${EVENT.movies.map((movie) => `${movie.title} ${counts[movie.id]}`).join(", ")}.`,
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
  input.classList.remove("is-invalid", "is-shaking");
  if (el.hidden && !input.hasAttribute("aria-invalid")) return;
  el.hidden = true;
  el.textContent = "";
  input.removeAttribute("aria-invalid");
}

function submitComing() {
  const name = nameValue(els.name);
  if (!name || name.length > 60) {
    rejectEmpty(els.name, els.nameError);
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
    rejectEmpty(els.cantName, els.cantError);
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

async function savePass(vote) {
  if (!state.token) {
    state.saving = false;
    return;
  }
  els.passError.hidden = true;
  try {
    const { rpc } = await import("./api.js");
    const data = await rpc("movie_pass_vote", { p_token: state.token, p_vote: vote });
    if (!data || data.ok === false) {
      const code = data?.error || "network";
      if (code === "closed") {
        state.flags.rsvpsOpen = false;
        state.flags.votingOpen = false;
        if (state.rsvp) showConfirm(state.rsvp, { celebrate: false });
        return;
      }
      if (state.step === "pass") {
        els.passError.hidden = false;
        els.passError.textContent = ERRORS[code] || ERRORS.network;
      }
      return;
    }
    if (data.standings) {
      state.standings = data.standings;
      state.flags.rsvpsOpen = data.standings.rsvps_open !== false;
      state.flags.votingOpen = data.standings.voting_open !== false;
    }
    showConfirm(data.rsvp, { celebrate: false });
  } catch (error) {
    console.error(error);
    if (state.step === "pass") {
      els.passError.hidden = false;
      els.passError.textContent = ERRORS.network;
    }
  } finally {
    state.saving = false;
  }
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
