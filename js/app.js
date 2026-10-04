import { EVENT, TOKEN_KEY, movieTitle, peopleLabel } from "./config.js";
import { eventShowtime, formatClock } from "./sunset.js";
import { applySky } from "./sky.js";

const $ = (id) => document.getElementById(id);

const els = {
  showtime: $("showtime-value"),
  showtimeNote: $("showtime-note"),
  ticks: $("ticks"),
  showState: $("show-state"),
  cd: {
    d: $("cd-d"),
    h: $("cd-h"),
    m: $("cd-m"),
    s: $("cd-s"),
  },
  cdLabel: $("cd-label"),
  resume: $("resume"),
  confirm: $("confirm"),
  confirmTitle: $("confirm-title"),
  confirmDetail: $("confirm-detail"),
  confirmVote: $("confirm-vote"),
  confirmNote: $("confirm-note"),
  standings: $("standings"),
  editBtn: $("edit-btn"),
  filmsBlock: $("films-block"),
  films: $("films"),
  voteOff: $("vote-off"),
  rsvpBlock: $("rsvp-block"),
  closedNote: $("closed-note"),
  form: $("form"),
  name: $("name"),
  note: $("note"),
  partyValue: $("party-value"),
  partyDec: $("party-dec"),
  partyInc: $("party-inc"),
  chairs: $("chairs"),
  screenKicker: $("screen-kicker"),
  screenLine: $("screen-line"),
  burst: $("burst"),
  statusSegment: $("status-segment"),
  honeypot: $("mx_field"),
  error: $("form-error"),
  submit: $("submit-btn"),
  cancel: $("cancel-edit"),
};

const state = {
  partySize: 1,
  status: null,
  vote: null,
  token: readToken(),
  rsvp: null,
  flags: { rsvpsOpen: true, votingOpen: true },
  editing: false,
  saving: false,
  standings: null,
  showtime: null,
};

let attempted = false;
let errorCode = "";

const CHAIR_COLORS = ["#f0d7a4", "#f2b8a0", "#f0d7a4", "#b7d0ea", "#f0d7a4", "#e7c1d8"];
const MAP_ADDRESS = EVENT.address;
const MAP_APPLE = `https://maps.apple.com/?daddr=${encodeURIComponent(MAP_ADDRESS)}&dirflg=d`;
const MAP_GOOGLE = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(MAP_ADDRESS)}`;

const ERRORS = {
  name: "Please add a name, up to 60 characters.",
  party: "How many people? Pick a number from 1 to 10.",
  status: "Let us know if you're coming.",
  vote: "Pick a movie.",
  note: "Keep the note under 240 characters.",
  closed: "RSVPs are closed.",
  rate: "That's a lot of saves. Wait a few minutes and try again.",
  not_found: "That RSVP isn't on the list anymore. You can send a new one.",
  network: "Couldn't save just now. Try again in a moment.",
};

initShowtime();
bindForm();
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

function initShowtime() {
  els.showtimeNote.textContent = `(${EVENT.minutesAfterSunset} min after sunset)`;
  const times = eventShowtime(EVENT);
  if (!times) {
    els.showtime.textContent = "after sunset";
    els.ticks.hidden = true;
    return;
  }
  const label = formatClock(times.showtime, EVENT.timezone);
  els.showtime.textContent = label;
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

function bindForm() {
  els.partyDec.addEventListener("click", () => setParty(state.partySize - 1));
  els.partyInc.addEventListener("click", () => setParty(state.partySize + 1));
  els.name.addEventListener("input", onFieldEdit);
  els.note.addEventListener("input", onFieldEdit);
  els.form.addEventListener("change", onFormChange);
  els.films.addEventListener("change", onFormChange);
  els.form.addEventListener("submit", onSubmit);
  els.editBtn.addEventListener("click", () => {
    state.editing = true;
    fillForm(state.rsvp);
    showForm();
    els.name.focus();
  });
  els.cancel.addEventListener("click", () => {
    state.editing = false;
    if (state.rsvp) showConfirm(state.rsvp, { focus: false });
  });
  setParty(state.partySize);
  wireDirections();
  bindParallax();
}

function onFormChange(event) {
  const target = event.target;
  if (target.name === "status") {
    state.status = target.value;
    if (state.status === "no") {
      state.vote = null;
      els.films.querySelectorAll('input[name="vote"]').forEach((input) => {
        input.checked = false;
      });
    }
    syncChrome();
  }
  if (target.name === "vote") {
    state.vote = target.value;
    syncChrome();
  }
  onFieldEdit();
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
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!root) return;
  if (reduce || from === next) {
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
    if (root.children.length === next + 1 && !reduce) {
      last.classList.add("leave");
      last.addEventListener("animationend", () => last.remove(), { once: true });
      break;
    }
    last.remove();
  }
}

function updateStamps() {
  document.querySelectorAll(".admit").forEach((el) => {
    el.textContent = String(state.partySize);
  });
}

function setParty(next) {
  const prev = state.partySize;
  state.partySize = Math.min(10, Math.max(1, next));
  els.partyValue.textContent = peopleLabel(state.partySize);
  els.partyDec.disabled = state.partySize <= 1;
  els.partyInc.disabled = state.partySize >= 10;
  renderChairs(prev);
  updateStamps();
}

function syncChrome() {
  document.body.dataset.status = state.status || "";
  document.body.dataset.vote = state.vote || "";
  const votingClosed = !state.flags.votingOpen;
  const declined = state.status === "no";
  els.films.classList.toggle("is-off", votingClosed || declined);
  els.films.querySelectorAll("input").forEach((input) => {
    input.disabled = votingClosed || declined;
  });
  if (votingClosed) {
    els.voteOff.hidden = false;
    els.voteOff.textContent = "Voting is closed.";
  } else if (declined) {
    els.voteOff.hidden = false;
    els.voteOff.textContent = "No vote needed if you can't make it.";
  } else {
    els.voteOff.hidden = true;
  }
  els.submit.textContent = state.saving ? "Saving…" : state.rsvp ? "Update RSVP" : "Count me in";
  els.cancel.hidden = !state.editing;
}

function fillForm(rsvp) {
  els.name.value = rsvp?.name ?? "";
  els.note.value = rsvp?.note ?? "";
  setParty(rsvp?.party_size ?? 1);
  state.status = rsvp?.status ?? null;
  state.vote = rsvp?.vote ?? null;
  els.form.querySelectorAll('input[name="status"]').forEach((input) => {
    input.checked = input.value === state.status;
  });
  els.form.querySelectorAll('input[name="vote"]').forEach((input) => {
    input.checked = input.value === state.vote;
  });
  attempted = false;
  clearError();
  syncChrome();
}

function showForm() {
  document.documentElement.classList.remove("has-token");
  document.body.classList.add("form-open");
  document.body.classList.remove("is-set");
  els.resume.hidden = true;
  els.confirm.hidden = true;
  els.filmsBlock.hidden = false;
  els.rsvpBlock.hidden = false;
  els.closedNote.hidden = state.flags.rsvpsOpen;
  els.form.hidden = !state.flags.rsvpsOpen;
  syncChrome();
  paintWorld();
}

function showConfirm(rsvp, { focus = true, celebrate = false } = {}) {
  state.rsvp = rsvp;
  state.editing = false;
  document.documentElement.classList.remove("has-token");
  document.body.classList.remove("form-open");
  els.resume.hidden = true;
  els.filmsBlock.hidden = true;
  els.rsvpBlock.hidden = true;
  els.confirm.hidden = false;
  document.body.classList.add("is-set");
  document.body.dataset.vote = rsvp.vote || "";
  paintWorld();
  if (celebrate && rsvp.status !== "no") burst();
  const headlines = {
    yes: "See you Saturday.",
    maybe: "You're a maybe.",
    no: "We'll miss you.",
  };
  els.confirmTitle.textContent = headlines[rsvp.status] || "Saved.";
  const statusLabel = { yes: "Yes", maybe: "Maybe", no: "Can't make it" }[rsvp.status] || "";
  els.confirmDetail.textContent =
    rsvp.status === "no"
      ? `${rsvp.name} · ${statusLabel}`
      : `${rsvp.name} · ${peopleLabel(rsvp.party_size)} · ${statusLabel}`;
  els.confirmVote.textContent = rsvp.vote ? movieTitle(rsvp.vote) : "";
  els.confirmVote.hidden = !rsvp.vote;
  if (rsvp.note) {
    els.confirmNote.hidden = false;
    els.confirmNote.textContent = rsvp.note;
  } else {
    els.confirmNote.hidden = true;
    els.confirmNote.textContent = "";
  }
  els.editBtn.hidden = !state.flags.rsvpsOpen;
  if (focus) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    els.confirmTitle.focus({ preventScroll: true });
  }
}

function renderStandings(standings, myVote) {
  if (!standings) return;
  state.standings = standings;
  paintWorld();
  const root = els.standings;
  root.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "The room";
  root.append(heading);
  const votes = standings.votes || {};
  const inside = Number(votes.inside_out) || 0;
  const mav = Number(votes.top_gun) || 0;
  const total = inside + mav;
  const caption = document.createElement("p");
  caption.className = "lede";
  caption.textContent = total === 0 ? "No votes yet. Be the first tear." : "One vote per group.";
  root.append(caption);
  const board = document.createElement("div");
  board.className = "buckets";
  const rows = [
    ["inside_out", "Inside Out", inside],
    ["top_gun", "Top Gun: Maverick", mav],
  ];
  const fills = [];
  rows.forEach(([id, title, count]) => {
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
  const foot = document.createElement("p");
  foot.className = "headcount";
  const yes = Number(standings.yes_headcount) || 0;
  const maybe = Number(standings.maybe_headcount) || 0;
  foot.textContent =
    yes + maybe === 0 ? "No one on the list yet." : `${yes} coming · ${maybe} maybe`;
  root.append(foot);
  root.setAttribute(
    "aria-label",
    `Inside Out ${inside} votes, Top Gun: Maverick ${mav} votes. ${yes} people coming, ${maybe} maybe.`,
  );
}

function clearError() {
  errorCode = "";
  els.error.hidden = true;
  els.error.textContent = "";
  els.name.removeAttribute("aria-invalid");
  els.note.removeAttribute("aria-invalid");
  els.statusSegment.classList.remove("is-invalid");
  els.films.classList.remove("is-invalid");
}

function setError(code, { focus = false } = {}) {
  errorCode = code;
  els.error.hidden = false;
  els.error.textContent = ERRORS[code] || ERRORS.network;
  const nameBad = code === "name";
  const noteBad = code === "note";
  if (nameBad) els.name.setAttribute("aria-invalid", "true");
  else els.name.removeAttribute("aria-invalid");
  if (noteBad) els.note.setAttribute("aria-invalid", "true");
  else els.note.removeAttribute("aria-invalid");
  els.statusSegment.classList.toggle("is-invalid", code === "status");
  els.films.classList.toggle("is-invalid", code === "vote");
  if (!focus) return;
  if (nameBad) els.name.focus();
  else if (noteBad) els.note.focus();
}

function onFieldEdit() {
  if (!attempted) return;
  if (errorCode === "network" || errorCode === "rate" || errorCode === "closed" || errorCode === "not_found") {
    return;
  }
  const problem = validate();
  if (problem) setError(problem);
  else clearError();
}

function validate() {
  const name = els.name.value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) return "name";
  if (state.partySize < 1 || state.partySize > 10) return "party";
  if (!state.status) return "status";
  if (state.status !== "no" && state.flags.votingOpen && !state.vote) return "vote";
  if (els.note.value.trim().length > 240) return "note";
  return "";
}

async function onSubmit(event) {
  event.preventDefault();
  if (state.saving) return;
  const nameBox = els.name.getBoundingClientRect();
  const dockTop = els.submit.getBoundingClientRect().top;
  if (nameBox.top > dockTop - 12) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    els.name.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    window.setTimeout(() => els.name.focus({ preventScroll: true }), reduce ? 0 : 280);
    return;
  }
  attempted = true;
  const problem = validate();
  if (problem) {
    setError(problem, { focus: true });
    return;
  }
  clearError();
  state.saving = true;
  els.submit.disabled = true;
  els.submit.textContent = "Saving…";
  els.submit.setAttribute("aria-busy", "true");
  try {
    const { rpc } = await import("./api.js");
    const data = await rpc("movie_submit_rsvp", {
      p_name: els.name.value.trim().replace(/\s+/g, " "),
      p_party_size: state.partySize,
      p_status: state.status,
      p_vote: state.status === "no" || !state.flags.votingOpen ? null : state.vote,
      p_note: els.note.value.trim(),
      p_honeypot: els.honeypot.value,
      p_token: state.token || null,
    });
    if (!data || data.ok === false) {
      const code = data?.error || "network";
      if (code === "not_found") writeToken("");
      if (code === "closed") {
        state.flags.rsvpsOpen = false;
        showForm();
      }
      setError(code);
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
    setError("network");
  } finally {
    state.saving = false;
    els.submit.disabled = false;
    els.submit.removeAttribute("aria-busy");
    syncChrome();
  }
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

  showForm();
  if (mineResult && !mineResult.ok) setError("network");
}

function winnerTitle(standings) {
  const votes = standings?.votes || {};
  const inside = Number(votes.inside_out) || 0;
  const mav = Number(votes.top_gun) || 0;
  if (!inside && !mav) return "Movie night";
  if (inside === mav) return "It's a tie";
  return inside > mav ? "Inside Out" : "Top Gun: Maverick";
}

function paintWorld() {
  const phase = applySky(state.showtime);
  const showing = phase === "showing";
  document.body.dataset.phase = showing ? "showing" : "waiting";
  const rsvp = state.rsvp;
  const starring = document.body.classList.contains("is-set") && rsvp && rsvp.status !== "no";
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
  if (!root) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
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
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, 180);
        document.documentElement.style.setProperty("--parallax", y.toFixed(1));
        ticking = false;
      });
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
