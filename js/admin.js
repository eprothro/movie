import { EVENT, PIN_KEY, movieTitle, peopleLabel } from "./config.js";

const $ = (id) => document.getElementById(id);

const PIN_LENGTH = 4;

const pinScreen = $("pin-screen");
const opening = $("opening");
const book = $("book");
const dots = $("pin-dots");
const entry = $("pin-entry");
const live = $("pin-live");
const pinError = $("pin-error");
const keypad = $("keypad");
const projection = $("projection");
const tally = $("tally");
const guestCount = $("guest-count");
const list = $("guest-list");
const bookError = $("book-error");
const toggleRsvp = $("toggle-rsvp");
const toggleVote = $("toggle-vote");

let pin = "";
let savedPin = readPin();
let locked = false;
let busy = false;

keypad.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || locked || busy) return;
  if (button.id === "pin-del") pushPin(pin.slice(0, -1));
  else if (button.id === "pin-clear") pushPin("");
  else if (button.dataset.digit) pushPin(pin + button.dataset.digit);
});

entry.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = event.clipboardData?.getData("text") ?? "";
  const digits = text.replace(/\D/g, "");
  const start = entry.selectionStart ?? pin.length;
  const end = entry.selectionEnd ?? pin.length;
  pushPin(pin.slice(0, start) + digits + pin.slice(end));
});
entry.addEventListener("input", () => pushPin(entry.value));

$("refresh").addEventListener("click", () => load());
$("lock").addEventListener("click", () => {
  savedPin = "";
  writePin("");
  pin = "";
  renderDots();
  showPin();
});
toggleRsvp.addEventListener("click", () => flipFlag("rsvp"));
toggleVote.addEventListener("click", () => flipFlag("vote"));
$("reset").addEventListener("click", resetVotes);
$("reset-cancel").addEventListener("click", () => armReset(false));

document.addEventListener("keydown", (event) => {
  if (pinScreen.hidden || locked || busy || event.target === entry) return;
  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    pushPin(pin + event.key);
  } else if (event.key === "Backspace") {
    event.preventDefault();
    pushPin(pin.slice(0, -1));
  }
});

renderDots();
boot();

function readPin() {
  try {
    return sessionStorage.getItem(PIN_KEY) || "";
  } catch {
    return "";
  }
}

function writePin(value) {
  try {
    if (value) sessionStorage.setItem(PIN_KEY, value);
    else sessionStorage.removeItem(PIN_KEY);
  } catch {
    /* session-only memory */
  }
}

function syncEntry() {
  if (entry && entry.value !== pin) entry.value = pin;
}

function pushPin(next) {
  if (locked || busy) return;
  const cleaned = String(next).replace(/\D/g, "").slice(0, PIN_LENGTH);
  if (cleaned === pin) {
    syncEntry();
    return;
  }
  pin = cleaned;
  renderDots();
  if (pin.length === PIN_LENGTH) submitPin();
}

function renderDots() {
  dots.replaceChildren();
  for (let i = 0; i < PIN_LENGTH; i += 1) {
    const dot = document.createElement("i");
    if (i < pin.length) dot.className = "on";
    dots.append(dot);
  }
  syncEntry();
  live.textContent = pin.length ? `${pin.length} digits entered` : "";
}

function setPinError(message) {
  pinError.textContent = message || "";
}

function shake() {
  dots.classList.remove("is-wrong");
  void dots.offsetWidth;
  dots.classList.add("is-wrong");
}

function setKeysDisabled(disabled) {
  locked = disabled;
  if (entry) entry.disabled = disabled;
  keypad.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
  renderDots();
}

function focusEntry() {
  if (!entry || locked || pinScreen.hidden) return;
  entry.focus({ preventScroll: true });
}

function showPin(problem) {
  document.documentElement.classList.remove("has-pin");
  opening.hidden = true;
  book.hidden = true;
  pinScreen.hidden = false;
  if (!problem) {
    setPinError("");
    focusEntry();
    return;
  }
  pin = "";
  renderDots();
  if (problem.error === "locked") {
    const when = problem.retry_at ? new Date(problem.retry_at) : null;
    const clock =
      when && !Number.isNaN(when.getTime())
        ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(when)
        : "";
    setPinError(clock ? `Too many attempts. Try again at ${clock}.` : "Too many attempts. Try again in a few minutes.");
    setKeysDisabled(true);
    if (when) {
      const wait = Math.min(Math.max(when.getTime() - Date.now(), 0), 15 * 60 * 1000);
      window.setTimeout(() => {
        setKeysDisabled(false);
        setPinError("");
      }, wait);
    }
    return;
  }
  if (problem.error === "pin_not_set") {
    setPinError("The host PIN isn't set yet. Run movie_set_admin_pin in Supabase, then come back.");
    return;
  }
  if (problem.error === "pin") {
    setPinError("That PIN doesn't match.");
    shake();
    focusEntry();
    return;
  }
  setPinError("Couldn't open the guest book. Try again in a moment.");
  focusEntry();
}

function showBook() {
  document.documentElement.classList.remove("has-pin");
  opening.hidden = true;
  pinScreen.hidden = true;
  book.hidden = false;
}

async function rpc(fn, args) {
  const { rpc: call } = await import("./api.js");
  return call(fn, args);
}

async function boot() {
  if (!savedPin) {
    showPin();
    return;
  }
  await load();
}

async function submitPin() {
  if (pin.length < PIN_LENGTH || busy || locked) return;
  busy = true;
  renderDots();
  setPinError("");
  const attempt = pin;
  entry?.blur();
  try {
    const data = await rpc("movie_admin_overview", { p_pin: attempt });
    if (!data || data.ok === false) {
      savedPin = "";
      writePin("");
      showPin(data || { error: "network" });
      return;
    }
    savedPin = attempt;
    writePin(attempt);
    pin = "";
    renderBook(data);
    showBook();
  } catch (error) {
    console.error(error);
    showPin({ error: "network" });
  } finally {
    busy = false;
    renderDots();
  }
}

async function load() {
  if (!savedPin) {
    showPin();
    return;
  }
  bookError.hidden = true;
  try {
    const data = await rpc("movie_admin_overview", { p_pin: savedPin });
    if (!data || data.ok === false) {
      if (data?.error === "pin" || data?.error === "locked" || data?.error === "pin_not_set") {
        savedPin = "";
        writePin("");
        showPin(data);
        return;
      }
      showBook();
      bookError.hidden = false;
      bookError.textContent = "Couldn't refresh. Try again in a moment.";
      return;
    }
    renderBook(data);
    showBook();
  } catch (error) {
    console.error(error);
    showBook();
    bookError.hidden = false;
    bookError.textContent = "Couldn't refresh. Try again in a moment.";
  }
}

function applyFlags(rsvpsOpen, votingOpen) {
  toggleRsvp.setAttribute("aria-pressed", rsvpsOpen ? "true" : "false");
  toggleVote.setAttribute("aria-pressed", votingOpen ? "true" : "false");
  $("rsvp-switch-label").textContent = rsvpsOpen ? "Open" : "Closed";
  $("vote-switch-label").textContent = votingOpen ? "Open" : "Closed";
}

function splitOf(row) {
  const count = Number(row?.vote_b_count) || 0;
  if (!row || !row.vote_b || count < 1 || row.would_attend === "none") return null;
  const rest = Number(row.party_size) - count;
  if (rest < 1) return null;
  return { rest, count };
}

function attendLine(row) {
  const split = splitOf(row);
  if (split) return `${split.rest} for ${movieTitle(row.vote)} · ${split.count} for ${movieTitle(row.vote_b)}`;
  if (row.would_attend === "none") return "Can't make it";
  if (row.would_attend === "both") {
    return row.vote ? `Either · voted ${movieTitle(row.vote)}` : "Either";
  }
  return `${movieTitle(row.would_attend)} only`;
}

function partyCount(row) {
  const split = splitOf(row);
  if (split) return `${split.rest} + ${split.count}`;
  return peopleLabel(row.party_size);
}

function renderBook(data) {
  applyFlags(data.rsvps_open !== false, data.voting_open !== false);
  const votes = data.votes || {};
  const cards = EVENT.movies.map((movie) => [
    movie.id,
    `If ${movie.short}`,
    Number(data[`if_${movie.id}`]) || 0,
    Number(votes[movie.id]) || 0,
  ]);
  const lead = cards[0][3] === cards[1][3] ? "" : cards[0][3] > cards[1][3] ? cards[0][0] : cards[1][0];
  projection.replaceChildren();
  cards.forEach(([id, label, people, count]) => {
    const card = document.createElement("div");
    card.className = `proj${id === lead ? " is-lead" : ""}`;
    const title = document.createElement("p");
    title.className = "proj-label";
    title.textContent = label;
    const big = document.createElement("p");
    big.className = "proj-people";
    big.innerHTML = `<b>${people}</b> ${people === 1 ? "person" : "people"}`;
    const vote = document.createElement("p");
    vote.className = "proj-votes";
    vote.textContent = `${peopleLabel(count)} voting${id === lead ? " · leading" : ""}`;
    card.append(title, big, vote);
    projection.append(card);
  });

  const nos = Number(data.none_parties) || 0;
  const coming = Number(data.coming) || 0;
  tally.textContent = `${peopleLabel(coming)} coming${nos ? ` · ${nos} can't make it` : ""}`;

  const rows = Array.isArray(data.rsvps) ? data.rsvps : [];
  guestCount.textContent = rows.length ? String(rows.length) : "";
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No RSVPs yet.";
    list.append(empty);
    renderPast(data.history);
    return;
  }

  const timeFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT.timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  rows.forEach((row) => {
    const article = document.createElement("article");
    article.className = `guest${row.would_attend === "none" ? " is-out" : ""}`;
    const top = document.createElement("div");
    top.className = "guest-top";
    const name = document.createElement("h3");
    name.textContent = row.name;
    top.append(name);
    if (row.would_attend !== "none") {
      const count = document.createElement("p");
      count.className = "count";
      count.textContent = partyCount(row);
      top.append(count);
    }

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = attendLine(row);

    article.append(top, meta);

    if (row.note) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = row.note;
      article.append(note);
    }

    const when = document.createElement("p");
    when.className = "when";
    const stamp = row.updated_at || row.created_at;
    when.textContent = stamp ? timeFormat.format(new Date(stamp)) : "";
    article.append(when);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link danger";
    remove.textContent = "Remove";
    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "link";
    keep.textContent = "Keep";
    keep.hidden = true;
    remove.addEventListener("click", async () => {
      if (!remove.dataset.armed) {
        remove.dataset.armed = "1";
        remove.textContent = "Yes, remove";
        keep.hidden = false;
        return;
      }
      remove.disabled = true;
      try {
        const result = await rpc("movie_admin_delete", { p_pin: savedPin, p_id: row.id });
        if (!result || result.ok === false) {
          if (result?.error === "pin" || result?.error === "locked" || result?.error === "pin_not_set") {
            savedPin = "";
            writePin("");
            showPin(result);
            return;
          }
          bookError.hidden = false;
          bookError.textContent = "Couldn't remove that RSVP.";
          remove.disabled = false;
          return;
        }
        await load();
      } catch (error) {
        console.error(error);
        bookError.hidden = false;
        bookError.textContent = "Couldn't remove that RSVP.";
        remove.disabled = false;
      }
    });
    keep.addEventListener("click", () => {
      delete remove.dataset.armed;
      remove.textContent = "Remove";
      keep.hidden = true;
    });
    actions.append(remove, keep);
    article.append(actions);
    list.append(article);
  });
  renderPast(data.history);
}

function formatPastDate(iso) {
  const [year, month, day] = String(iso || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT.timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 18, 0, 0)));
}

function renderPast(history) {
  const head = $("past-head");
  const root = $("past-nights");
  const nights = Array.isArray(history) ? history : [];
  const show = nights.length > 0;
  head.hidden = !show;
  root.hidden = !show;
  root.replaceChildren();
  if (!show) return;

  nights.forEach((night) => {
    const votes = night.votes || {};
    const countA = Number(votes[night.movie_a]) || 0;
    const countB = Number(votes[night.movie_b]) || 0;
    const people = Number(night.headcount) || 0;

    const article = document.createElement("article");
    article.className = "past-night";

    const date = document.createElement("p");
    date.className = "past-date";
    date.textContent = formatPastDate(night.event_date);

    const films = document.createElement("p");
    films.className = "past-films";
    const titleA = document.createElement("span");
    titleA.textContent = night.movie_a_title || "";
    const vs = document.createElement("span");
    vs.className = "vs";
    vs.textContent = "vs";
    const titleB = document.createElement("span");
    titleB.textContent = night.movie_b_title || "";
    films.append(titleA, vs, titleB);

    const winner = document.createElement("p");
    winner.className = "past-winner";
    const name = document.createElement("b");
    name.textContent = night.winner_title || "Tie";
    winner.append(document.createTextNode(night.winner_title ? "Winner " : ""), name);

    const meta = document.createElement("p");
    meta.className = "past-meta";
    const count = document.createElement("b");
    count.textContent = String(people);
    meta.append(
      count,
      document.createTextNode(
        ` ${people === 1 ? "person" : "people"} · ${night.movie_a_title} ${countA} · ${night.movie_b_title} ${countB}`,
      ),
    );

    article.append(date, films, winner, meta);
    root.append(article);
  });
}

function armReset(armed) {
  const button = $("reset");
  if (armed) button.dataset.armed = "1";
  else delete button.dataset.armed;
  button.textContent = armed ? "Delete all" : "Reset votes";
  $("reset-note").hidden = !armed;
  $("reset-cancel").hidden = !armed;
}

async function resetVotes() {
  if (!savedPin || busy) return;
  if (!$("reset").dataset.armed) {
    armReset(true);
    return;
  }
  busy = true;
  $("reset").disabled = true;
  bookError.hidden = true;
  try {
    const result = await rpc("movie_admin_reset", { p_pin: savedPin });
    if (!result || result.ok === false) {
      if (result?.error === "pin" || result?.error === "locked" || result?.error === "pin_not_set") {
        savedPin = "";
        writePin("");
        showPin(result);
        return;
      }
      bookError.hidden = false;
      bookError.textContent = "Couldn't reset the votes.";
      return;
    }
    armReset(false);
    await load();
  } catch (error) {
    console.error(error);
    bookError.hidden = false;
    bookError.textContent = "Couldn't reset the votes.";
  } finally {
    busy = false;
    $("reset").disabled = false;
  }
}

async function flipFlag(which) {
  if (!savedPin || busy) return;
  const rsvpsOpen = toggleRsvp.getAttribute("aria-pressed") === "true";
  const votingOpen = toggleVote.getAttribute("aria-pressed") === "true";
  const nextRsvp = which === "rsvp" ? !rsvpsOpen : rsvpsOpen;
  const nextVote = which === "vote" ? !votingOpen : votingOpen;
  applyFlags(nextRsvp, nextVote);
  busy = true;
  try {
    const data = await rpc("movie_admin_set_open", {
      p_pin: savedPin,
      p_rsvps_open: nextRsvp,
      p_voting_open: nextVote,
    });
    if (!data || data.ok === false) {
      applyFlags(rsvpsOpen, votingOpen);
      if (data?.error === "pin" || data?.error === "locked" || data?.error === "pin_not_set") {
        savedPin = "";
        writePin("");
        showPin(data);
        return;
      }
      bookError.hidden = false;
      bookError.textContent = "Couldn't update that switch.";
      return;
    }
    applyFlags(data.rsvps_open, data.voting_open);
    bookError.hidden = true;
  } catch (error) {
    console.error(error);
    applyFlags(rsvpsOpen, votingOpen);
    bookError.hidden = false;
    bookError.textContent = "Couldn't update that switch.";
  } finally {
    busy = false;
  }
}
