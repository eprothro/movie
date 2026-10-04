import { EVENT, PIN_KEY, movieTitle, peopleLabel } from "./config.js";

const $ = (id) => document.getElementById(id);

const pinScreen = $("pin-screen");
const opening = $("opening");
const book = $("book");
const dots = $("pin-dots");
const live = $("pin-live");
const unlockBtn = $("unlock");
const pinError = $("pin-error");
const keypad = $("keypad");
const stats = $("stats");
const list = $("guest-list");
const bookError = $("book-error");
const toggleRsvp = $("toggle-rsvp");
const toggleVote = $("toggle-vote");
const noLine = $("no-line");

const STATUS = { yes: "Yes", maybe: "Maybe", no: "Can't" };

let pin = "";
let savedPin = readPin();
let locked = false;
let busy = false;

keypad.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || locked) return;
  if (button.id === "pin-del") {
    pin = pin.slice(0, -1);
  } else if (button.id === "pin-clear") {
    pin = "";
  } else if (button.dataset.digit && pin.length < 8) {
    pin += button.dataset.digit;
  }
  renderDots();
});

unlockBtn.addEventListener("click", () => submitPin());
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

document.addEventListener("keydown", (event) => {
  if (pinScreen.hidden || locked) return;
  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    if (pin.length < 8) pin += event.key;
    renderDots();
  } else if (event.key === "Backspace") {
    event.preventDefault();
    pin = pin.slice(0, -1);
    renderDots();
  } else if (event.key === "Enter" && pin.length >= 4) {
    event.preventDefault();
    submitPin();
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

function renderDots() {
  dots.replaceChildren();
  for (let i = 0; i < pin.length; i += 1) dots.append(document.createElement("i"));
  live.textContent = pin.length ? `${pin.length} digits entered` : "";
  unlockBtn.disabled = locked || pin.length < 4 || busy;
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
  keypad.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
  renderDots();
}

function showPin(problem) {
  document.documentElement.classList.remove("has-pin");
  opening.hidden = true;
  book.hidden = true;
  pinScreen.hidden = false;
  if (!problem) {
    setPinError("");
    return;
  }
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
    pin = "";
    renderDots();
    return;
  }
  setPinError("Couldn't open the guest book. Try again in a moment.");
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
  if (pin.length < 4 || busy || locked) return;
  busy = true;
  unlockBtn.textContent = "Checking…";
  renderDots();
  setPinError("");
  const attempt = pin;
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
    unlockBtn.textContent = "Unlock";
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

function renderBook(data) {
  applyFlags(data.rsvps_open !== false, data.voting_open !== false);
  const votes = data.votes || {};
  const cards = [
    ["Coming", data.yes_headcount || 0],
    ["Maybe", data.maybe_headcount || 0],
    ["Inside Out", votes.inside_out || 0],
    ["Maverick", votes.top_gun || 0],
  ];
  stats.replaceChildren();
  cards.forEach(([label, value]) => {
    const tile = document.createElement("div");
    tile.className = "stat";
    const num = document.createElement("b");
    num.textContent = String(value);
    const caption = document.createElement("span");
    caption.textContent = label;
    tile.append(num, caption);
    stats.append(tile);
  });

  const nos = Number(data.no_parties) || 0;
  if (nos > 0) {
    noLine.hidden = false;
    noLine.textContent = nos === 1 ? "1 can't make it" : `${nos} can't make it`;
  } else {
    noLine.hidden = true;
    noLine.textContent = "";
  }

  const rows = Array.isArray(data.rsvps) ? data.rsvps : [];
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "quiet";
    empty.textContent = "No RSVPs yet.";
    list.append(empty);
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
    article.className = "guest";
    const top = document.createElement("div");
    top.className = "guest-top";
    const name = document.createElement("h3");
    name.textContent = row.name;
    const count = document.createElement("p");
    count.className = "count";
    count.textContent = peopleLabel(row.party_size);
    top.append(name, count);

    const meta = document.createElement("p");
    meta.className = "meta";
    const status = STATUS[row.status] || row.status;
    const vote = row.vote ? movieTitle(row.vote) : "";
    meta.textContent = vote ? `${status} · ${vote}` : status;

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
