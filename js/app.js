import { EVENT, TOKEN_KEY, movieTitle, peopleLabel } from "./config.js";
import { eventShowtime, formatClock } from "./sunset.js";
import { applySky } from "./sky.js";

const $ = (id) => document.getElementById(id);

const els = {
  date: $("date-label"),
  showtime: $("showtime-value"),
  ticks: $("ticks"),
  showState: $("show-state"),
  cd: { d: $("cd-d"), h: $("cd-h"), m: $("cd-m"), s: $("cd-s") },
  cdLabel: $("cd-label"),
  resume: $("resume"),
  closed: $("closed-note"),
  imIn: $("im-in"),
  cantBtn: $("cant"),
  pick: $("step-pick"),
  pickTitle: $("pick-title"),
  posters: $("posters"),
  pickNext: $("pick-next"),
  prefer: $("step-prefer"),
  preferTitle: $("prefer-title"),
  nameStep: $("step-name"),
  name: $("name"),
  partyValue: $("party-value"),
  partyDec: $("party-dec"),
  partyInc: $("party-inc"),
  chairs: $("chairs"),
  form: $("form"),
  error: $("form-error"),
  submit: $("submit-btn"),
  cant: $("step-cant"),
  cantForm: $("cant-form"),
  cantName: $("cant-name"),
  cantError: $("cant-error"),
  cantSubmit: $("cant-submit"),
  honeypot: $("mx_field"),
  cantHoneypot: $("mx_field_cant"),
  confirm: $("confirm"),
  confirmTitle: $("confirm-title"),
  confirmVote: $("confirm-vote"),
  standings: $("standings"),
  editBtn: $("edit-btn"),
  screenKicker: $("screen-kicker"),
  screenLine: $("screen-line"),
  burst: $("burst"),
};

const state = {
  step: "invite",
  partySize: 1,
  attend: null,
  vote: null,
  token: readToken(),
  rsvp: null,
  flags: { rsvpsOpen: true, votingOpen: true },
  editing: false,
  saving: false,
  standings: null,
  showtime: null,
};

const CHAIR_COLORS = ["#f0d7a4", "#f2b8a0", "#f0d7a4", "#b7d0ea", "#f0d7a4", "#e7c1d8"];
const MAP_ADDRESS = EVENT.address;
const MAP_APPLE = `https://maps.apple.com/?daddr=${encodeURIComponent(MAP_ADDRESS)}&dirflg=d`;
const MAP_GOOGLE = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(MAP_ADDRESS)}`;

const ERRORS = {
  name: "Add a name.",
  party: "Pick a number from 1 to 10.",
  attend: "Pick at least one movie.",
  vote: "Pick one.",
  note: "Keep the note under 240 characters.",
  closed: "RSVPs are closed.",
  rate: "Wait a few minutes and try again.",
  not_found: "That RSVP isn't on the list anymore.",
  network: "Couldn't save just now.",
};

initShowtime();
bind();
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

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function initShowtime() {
  els.date.textContent = EVENT.dateLabel;
  const times = eventShowtime(EVENT);
  if (!times) {
    els.showtime.textContent = "after sunset";
    els.ticks.hidden = true;
    paintWorld();
    return;
  }
  els.showtime.textContent = formatClock(times.showtime, EVENT.timezone);
  els.showtime.dateTime = times.showtime.toISOString();
  state.showtime = times.showtime;
  paintWorld();
  startCountdown(times.showtime);
}

function startCountdown(showtime) {
  let lastMinuteLabel = "";
  let timer = 0;
  const tick = () => {
    const diff = showtime.getTime() - Date.now();
    if (diff <= 0) {
      const elapsed = -diff;
      const message = elapsed < 3 * 60 * 60 * 1000 ? "It's showtime." : "That was the night.";
      els.ticks.classList.add("is-message");
      els.showState.hidden = false;
      els.showState.textContent = message;
      if (lastMinuteLabel !== message) {
        lastMinuteLabel = message;
        els.cdLabel.textContent = message;
      }
      window.clearInterval(timer);
      paintWorld();
      return;
    }
    const total = Math.floor(diff / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    els.cd.d.textContent = String(days).padStart(2, "0");
    els.cd.h.textContent = String(hours).padStart(2, "0");
    els.cd.m.textContent = String(mins).padStart(2, "0");
    els.cd.s.textContent = String(secs).padStart(2, "0");
    const spoken = `${days} days, ${hours} hours, ${mins} minutes until showtime`;
    if (spoken !== lastMinuteLabel) {
      lastMinuteLabel = spoken;
      els.cdLabel.textContent = spoken;
      paintWorld();
    }
  };
  tick();
  timer = window.setInterval(tick, 1000);
}

function bind() {
  els.imIn.addEventListener("click", () => {
    if (!state.flags.rsvpsOpen) return;
    state.editing = false;
    showStep("pick");
  });
  els.cantBtn.addEventListener("click", () => {
    if (!state.flags.rsvpsOpen) return;
    state.editing = false;
    state.attend = "none";
    state.vote = null;
    showStep("cant");
  });
  els.posters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-movie]");
    if (!button) return;
    const on = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", on ? "false" : "true");
    syncPickNext();
  });
  els.pickNext.addEventListener("click", onPickNext);
  $("pick-back").addEventListener("click", () => leaveToStart());
  $("prefer-back").addEventListener("click", () => showStep("pick"));
  $("name-back").addEventListener("click", () => {
    if (state.attend === "both" && state.flags.votingOpen) showStep("prefer");
    else showStep("pick");
  });
  $("cant-back").addEventListener("click", () => leaveToStart());
  els.prefer.addEventListener("click", (event) => {
    const button = event.target.closest("[data-vote]");
    if (!button) return;
    state.attend = "both";
    state.vote = button.dataset.vote;
    markChoices();
    showStep("name");
  });
  els.partyDec.addEventListener("click", () => setParty(state.partySize - 1));
  els.partyInc.addEventListener("click", () => setParty(state.partySize + 1));
  els.name.addEventListener("input", () => {
    if (els.error.hidden) return;
    if (nameProblem(els.name.value)) setFieldError(els.name, els.error, "name");
    else clearFieldError(els.name, els.error);
  });
  els.cantName.addEventListener("input", () => {
    if (els.cantError.hidden) return;
    if (nameProblem(els.cantName.value)) setFieldError(els.cantName, els.cantError, "name");
    else clearFieldError(els.cantName, els.cantError);
  });
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitComing();
  });
  els.cantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCant();
  });
  els.editBtn.addEventListener("click", beginEdit);
  setParty(1);
  wireDirections();
  bindParallax();
}

function leaveToStart() {
  if (state.rsvp) showConfirm(state.rsvp, { focus: false });
  else showStep("invite");
}

function selectedMovies() {
  return [...els.posters.querySelectorAll("[data-movie]")]
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.dataset.movie);
}

function syncPickNext() {
  els.pickNext.disabled = selectedMovies().length === 0;
}

function pressPosters(attend) {
  els.posters.querySelectorAll("[data-movie]").forEach((button) => {
    const id = button.dataset.movie;
    const on = attend === "both" || attend === id;
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  syncPickNext();
}

function onPickNext() {
  const picked = selectedMovies();
  if (picked.length === 0) return;
  if (picked.length === 1) {
    state.attend = picked[0];
    state.vote = picked[0];
    showStep("name");
    return;
  }
  state.attend = "both";
  if (!state.flags.votingOpen) {
    if (state.vote !== "inside_out" && state.vote !== "top_gun") state.vote = null;
    showStep("name");
    return;
  }
  showStep("prefer");
}

function markChoices() {
  els.prefer.querySelectorAll("[data-vote]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.vote === state.vote ? "true" : "false");
  });
}

function showStep(step, { scroll = true } = {}) {
  state.step = step;
  document.body.dataset.step = step;
  document.body.classList.toggle("is-set", step === "confirm");
  document.body.classList.toggle("form-open", step === "name" || step === "cant");
  els.pick.hidden = step !== "pick";
  els.prefer.hidden = step !== "prefer";
  els.nameStep.hidden = step !== "name";
  els.cant.hidden = step !== "cant";
  els.confirm.hidden = step !== "confirm";
  els.resume.hidden = true;
  els.resume.classList.remove("is-on");
  document.documentElement.classList.remove("has-token");
  syncClosed();
  paintWorld();
  if (step === "prefer") markChoices();
  if (step === "name") {
    els.submit.textContent = state.saving ? "Saving…" : state.rsvp ? "Update" : "Count me in";
  }
  if (step === "cant") {
    els.cantSubmit.textContent = state.saving ? "Saving…" : state.rsvp ? "Update" : "Save";
  }
  if (!scroll) return;
  const reduce = prefersReducedMotion();
  if (step === "invite" || step === "confirm") {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  } else {
    const node = document.getElementById(`step-${step}`);
    node?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  window.setTimeout(() => focusStep(step), reduce ? 0 : 280);
}

function focusStep(step) {
  if (step === "pick") els.pickTitle.focus({ preventScroll: true });
  else if (step === "prefer") els.preferTitle.focus({ preventScroll: true });
  else if (step === "name") els.name.focus({ preventScroll: true });
  else if (step === "cant") els.cantName.focus({ preventScroll: true });
  else if (step === "confirm") els.confirmTitle.focus({ preventScroll: true });
}

function syncClosed() {
  const open = state.flags.rsvpsOpen;
  els.closed.hidden = open;
  els.imIn.disabled = !open;
  els.cantBtn.disabled = !open;
  els.editBtn.hidden = !open;
}

function beginEdit() {
  const rsvp = state.rsvp;
  if (!rsvp || !state.flags.rsvpsOpen) return;
  state.editing = true;
  state.attend = rsvp.would_attend;
  state.vote = rsvp.vote;
  els.name.value = rsvp.name || "";
  els.cantName.value = rsvp.name || "";
  setParty(rsvp.party_size || 1);
  clearFieldError(els.name, els.error);
  clearFieldError(els.cantName, els.cantError);
  if (rsvp.would_attend === "none") {
    showStep("cant");
    return;
  }
  pressPosters(rsvp.would_attend);
  showStep("pick");
}

function prefersAppleMaps() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const iPadOs = platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOs;
}

function wireDirections() {
  const apple = prefersAppleMaps();
  const primary = apple ? MAP_APPLE : MAP_GOOGLE;
  const alt = apple ? MAP_GOOGLE : MAP_APPLE;
  const altLabel = apple ? "or Google Maps" : "or Apple Maps";
  document.querySelectorAll("[data-route]").forEach((root) => {
    const go = root.querySelector(".route-go");
    const altLink = root.querySelector(".route-alt");
    const address = root.querySelector(".address");
    go.href = primary;
    altLink.href = alt;
    altLink.textContent = altLabel;
    address.textContent = MAP_ADDRESS;
    if (address.dataset.bound) return;
    address.dataset.bound = "1";
    address.addEventListener("click", () => {
      const selected = window.getSelection();
      if (selected && String(selected).trim()) return;
      window.location.assign(primary);
    });
  });
}

function chairEl(index) {
  const el = document.createElement("span");
  el.className = "chair";
  el.style.setProperty("--chair", CHAIR_COLORS[index % CHAIR_COLORS.length]);
  el.innerHTML =
    '<svg viewBox="0 0 40 34" aria-hidden="true">' +
    '<path d="M10 32 L14 16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '<path d="M28 32 L18 17" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '<path d="M12 17 H27" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M14 16 L16 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M23 16 L21 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M16 6.5 H21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M15 10 H22.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>' +
    '<path d="M14.2 13.2 H23.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>' +
    "</svg>";
  return el;
}

function renderChairs(from) {
  const root = els.chairs;
  const next = state.partySize;
  if (!root) return;
  if (prefersReducedMotion() || from === next) {
    root.replaceChildren(...Array.from({ length: next }, (_, i) => chairEl(i)));
    return;
  }
  if (next > from) {
    while (root.children.length < next) {
      const el = chairEl(root.children.length);
      el.classList.add("pop");
      root.append(el);
    }
    return;
  }
  while (root.children.length > next) {
    const last = root.lastElementChild;
    if (root.children.length === next + 1) {
      last.classList.add("leave");
      last.addEventListener("animationend", () => last.remove(), { once: true });
      break;
    }
    last.remove();
  }
}

function setParty(next) {
  const prev = state.partySize;
  state.partySize = Math.min(10, Math.max(1, next));
  els.partyValue.textContent = peopleLabel(state.partySize);
  els.partyDec.disabled = state.partySize <= 1;
  els.partyInc.disabled = state.partySize >= 10;
  renderChairs(prev);
}

function nameProblem(value) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) return "name";
  return "";
}

function clearFieldError(input, error) {
  error.hidden = true;
  error.textContent = "";
  input.removeAttribute("aria-invalid");
}

function setFieldError(input, error, code) {
  error.hidden = false;
  error.textContent = ERRORS[code] || ERRORS.network;
  if (code === "name") input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function showConfirm(rsvp, { focus = true, celebrate = false } = {}) {
  state.rsvp = rsvp;
  state.editing = false;
  state.attend = rsvp.would_attend;
  state.vote = rsvp.vote;
  const coming = rsvp.would_attend && rsvp.would_attend !== "none";
  els.confirmTitle.textContent = coming ? "See you Saturday." : "We'll miss you.";
  if (!coming) {
    els.confirmVote.hidden = true;
    els.confirmVote.textContent = "";
  } else if (rsvp.would_attend === "both") {
    els.confirmVote.hidden = false;
    els.confirmVote.textContent = rsvp.vote ? `Both · ${movieTitle(rsvp.vote)}` : "Both";
  } else {
    els.confirmVote.hidden = false;
    els.confirmVote.textContent = movieTitle(rsvp.would_attend);
  }
  document.body.dataset.vote = rsvp.vote || "";
  showStep("confirm", { scroll: focus });
  if (celebrate && coming) burst();
  if (!focus) paintWorld();
}

function renderStandings(standings, myVote) {
  if (!standings) return;
  state.standings = standings;
  paintWorld();
  const root = els.standings;
  root.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Votes";
  root.append(heading);
  const votes = standings.votes || {};
  const inside = Number(votes.inside_out) || 0;
  const mav = Number(votes.top_gun) || 0;
  const total = inside + mav;
  const board = document.createElement("div");
  board.className = "buckets";
  const fills = [];
  [
    ["inside_out", "Inside Out", inside],
    ["top_gun", "Top Gun: Maverick", mav],
  ].forEach(([id, title, count]) => {
    const card = document.createElement("div");
    card.className = "bucket-card";
    const cup = document.createElement("div");
    cup.className = "cup";
    cup.setAttribute("role", "presentation");
    const kernels = document.createElement("div");
    kernels.className = "kernels";
    cup.append(kernels);
    const label = document.createElement("p");
    label.className = "bucket-label";
    const name = document.createElement("span");
    name.textContent = title;
    if (id === myVote) {
      const you = document.createElement("span");
      you.className = "you";
      you.textContent = "You";
      name.append(you);
    }
    const num = document.createElement("b");
    num.textContent = String(count);
    label.append(name, num);
    card.append(cup, label);
    board.append(card);
    fills.push([kernels, total ? (count / total) * 100 : 0]);
  });
  root.append(board);
  requestAnimationFrame(() => {
    fills.forEach(([kernels, pct]) => {
      kernels.style.height = `${Math.max(0, Math.min(78, pct * 0.78))}%`;
      kernels.classList.toggle("is-pop", pct > 0);
    });
  });
  root.setAttribute("aria-label", `Inside Out ${inside} votes. Top Gun: Maverick ${mav} votes.`);
}

async function save(payload, errorEl, input, button) {
  if (state.saving) return;
  if (!state.flags.rsvpsOpen) {
    setFieldError(input, errorEl, "closed");
    return;
  }
  state.saving = true;
  button.disabled = true;
  button.textContent = "Saving…";
  button.setAttribute("aria-busy", "true");
  try {
    const { rpc } = await import("./api.js");
    const data = await rpc("movie_submit_rsvp", payload);
    if (!data || data.ok === false) {
      const code = data?.error || "network";
      if (code === "not_found") writeToken("");
      if (code === "closed") {
        state.flags.rsvpsOpen = false;
        showStep("invite");
      }
      setFieldError(input, errorEl, code);
      return;
    }
    writeToken(data.token || state.token);
    if (data.standings) {
      state.flags.rsvpsOpen = data.standings.rsvps_open !== false;
      state.flags.votingOpen = data.standings.voting_open !== false;
    }
    showConfirm(data.rsvp, { celebrate: true });
    renderStandings(data.standings, data.rsvp?.vote);
  } catch (error) {
    console.error(error);
    setFieldError(input, errorEl, "network");
  } finally {
    state.saving = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    els.submit.textContent = state.rsvp ? "Update" : "Count me in";
    els.cantSubmit.textContent = state.rsvp ? "Update" : "Save";
  }
}

function submitComing() {
  const problem = nameProblem(els.name.value);
  if (problem) {
    setFieldError(els.name, els.error, problem);
    els.name.focus();
    return;
  }
  if (!state.attend || state.attend === "none") {
    showStep("pick");
    return;
  }
  if (state.attend === "both" && state.flags.votingOpen && state.vote !== "inside_out" && state.vote !== "top_gun") {
    showStep("prefer");
    return;
  }
  clearFieldError(els.name, els.error);
  const vote =
    state.attend === "both" ? state.vote : state.attend;
  save(
    {
      p_name: els.name.value.trim().replace(/\s+/g, " "),
      p_party_size: state.partySize,
      p_would_attend: state.attend,
      p_vote: vote,
      p_note: "",
      p_honeypot: els.honeypot.value,
      p_token: state.token || null,
    },
    els.error,
    els.name,
    els.submit,
  );
}

function submitCant() {
  const problem = nameProblem(els.cantName.value);
  if (problem) {
    setFieldError(els.cantName, els.cantError, problem);
    els.cantName.focus();
    return;
  }
  clearFieldError(els.cantName, els.cantError);
  state.attend = "none";
  state.vote = null;
  save(
    {
      p_name: els.cantName.value.trim().replace(/\s+/g, " "),
      p_party_size: 1,
      p_would_attend: "none",
      p_vote: null,
      p_note: "",
      p_honeypot: els.cantHoneypot.value,
      p_token: state.token || null,
    },
    els.cantError,
    els.cantName,
    els.cantSubmit,
  );
}

async function boot() {
  let rpc;
  try {
    ({ rpc } = await import("./api.js"));
  } catch (error) {
    console.error(error);
    document.documentElement.classList.remove("has-token");
    els.resume.hidden = true;
    return;
  }

  const standingsPromise = rpc("movie_get_standings").then(
    (data) => ({ ok: true, data }),
    () => ({ ok: false, data: null }),
  );
  const minePromise = state.token
    ? rpc("movie_get_rsvp", { p_token: state.token }).then(
        (data) => ({ ok: true, data }),
        () => ({ ok: false, data: null }),
      )
    : Promise.resolve(null);
  const [standingsResult, mineResult] = await Promise.all([standingsPromise, minePromise]);

  const standings = standingsResult.data;
  if (standings && standings.ok !== false) {
    state.standings = standings;
    state.flags.rsvpsOpen = standings.rsvps_open !== false;
    state.flags.votingOpen = standings.voting_open !== false;
  }

  if (mineResult?.ok && mineResult.data?.ok !== false && !mineResult.data?.rsvp) {
    writeToken("");
  }

  const rsvp = mineResult?.data?.rsvp || null;
  if (rsvp) {
    showConfirm(rsvp, { focus: false });
    renderStandings(standings, rsvp.vote);
    return;
  }

  showStep("invite", { scroll: false });
  syncClosed();
  if (mineResult && !mineResult.ok) {
    els.resume.hidden = false;
    els.resume.classList.add("is-on");
    els.resume.textContent = ERRORS.network;
  }
}

function winnerTitle(standings) {
  const votes = standings?.votes || {};
  const inside = Number(votes.inside_out) || 0;
  const mav = Number(votes.top_gun) || 0;
  if (!inside && !mav) return "Movie night";
  if (inside === mav) return "It's a tie";
  return inside > mav ? "Inside Out" : "Top Gun";
}

function paintWorld() {
  const phase = applySky(state.showtime);
  const showing = phase === "showing";
  document.body.dataset.phase = showing ? "showing" : "waiting";
  const rsvp = state.rsvp;
  const starring = state.step === "confirm" && rsvp && rsvp.would_attend !== "none";
  if (starring) {
    const extra = Math.max(0, Number(rsvp.party_size) - 1);
    els.screenKicker.textContent = "Starring";
    els.screenLine.textContent = extra ? `${rsvp.name} + ${extra}` : rsvp.name;
    document.body.classList.add("credits-on");
  } else if (showing) {
    els.screenKicker.textContent = "Now showing";
    els.screenLine.textContent = winnerTitle(state.standings);
    document.body.classList.add("credits-on");
  } else if (els.screenKicker) {
    els.screenKicker.textContent = "";
    els.screenLine.textContent = "";
    document.body.classList.remove("credits-on");
  }
}

function burst() {
  const root = els.burst;
  if (!root || prefersReducedMotion()) return;
  const colors = ["#f2c14e", "#6aa6e0", "#e07a6a", "#7dba7a", "#c9a0e0", "#f6e7a8"];
  root.replaceChildren();
  root.hidden = false;
  for (let i = 0; i < 10; i += 1) {
    const bit = document.createElement("i");
    bit.style.setProperty("--a", `${i * 36 - 10}deg`);
    bit.style.setProperty("--d", `${22 + (i % 4) * 9}px`);
    bit.style.setProperty("--c", colors[i % colors.length]);
    root.append(bit);
  }
  window.setTimeout(() => {
    root.hidden = true;
    root.replaceChildren();
  }, 800);
}

function bindParallax() {
  if (prefersReducedMotion()) return;
  let ticking = false;
  const apply = () => {
    const y = Math.min(window.scrollY, 420);
    document.documentElement.style.setProperty("--py", y.toFixed(1));
    ticking = false;
  };
  apply();
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(apply);
    },
    { passive: true },
  );
}

function registerWorker() {
  const host = location.hostname;
  if (!("serviceWorker" in navigator)) return;
  if (host !== "movie.prothro.site" && !host.endsWith("github.io")) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
