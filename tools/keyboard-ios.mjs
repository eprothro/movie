// The name step on an iPhone, with Safari's toolbar and the keyboard.
// Run from the repo root, with the site already being served:
//   python3 -m http.server 8765
//   node tools/keyboard-ios.mjs            (RSVP_ENGINES=webkit to run one)
//
// iOS 26 Safari: the layout viewport, innerHeight and lvh run the full screen,
// under the floating toolbar; svh and visualViewport stop above it. The
// keyboard hides the toolbar and shrinks only the visual viewport. Safari
// scrolls the focused field above it, and lets the page scroll by the
// keyboard's height. iosShim plays that back and draws the toolbar and the
// keyboard, so a screenshot shows what the phone shows. Every RPC is mocked.
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.RSVP_BASE || "http://127.0.0.1:8765/";
const shots = process.env.RSVP_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

const BAR = 83;
// The field and the button have to clear the toolbar or keyboard by this much.
const EDGE = 8;
const WATCH_MS = 2200;
const phones = [
  { width: 375, height: 667, keyboard: 260, variants: ["Count me in", "Save our spot", "Update"] },
  { width: 390, height: 844, keyboard: 336, variants: ["Count me in", "Save our spot", "Update"] },
  { width: 402, height: 874, keyboard: 336, variants: ["Count me in"] },
];
const engines = { webkit, chromium };
const only = (process.env.RSVP_ENGINES || "webkit,chromium").split(",");

function iosShim({ bar, keyboardPx, width, height }) {
  // innerHeight is not the phone's yet when this runs: the viewport meta tag
  // has not been read.
  const H = height;
  const listeners = { resize: new Set(), scroll: new Set() };
  const fake = {
    width,
    height: H - bar,
    offsetTop: 0,
    offsetLeft: 0,
    pageTop: 0,
    pageLeft: 0,
    scale: 1,
    addEventListener(type, fn) {
      listeners[type]?.add(fn);
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn);
    },
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
  const emit = (type) => listeners[type]?.forEach((fn) => fn(new Event(type)));
  let keyboard = 0;
  let timer = 0;
  let closeTimer = 0;
  let gesture = -1e9;
  let spacer = null;
  let dock = null;
  let keys = null;
  const field = () => {
    const el = document.activeElement;
    return el?.id === "name" || el?.id === "cant-name" ? el : null;
  };
  const apply = () => {
    fake.height = H - Math.max(bar, keyboard);
    fake.pageTop = window.scrollY;
    if (spacer) spacer.style.height = `${keyboard}px`;
    if (keys) keys.style.height = `${keyboard}px`;
    if (dock) dock.style.opacity = keyboard ? "0" : "1";
  };
  // Safari keeps the focused field above the keyboard as it rises.
  const reveal = () => {
    const el = field();
    if (!el || !keyboard) return;
    const bottom = fake.height - 8;
    const r = el.getBoundingClientRect();
    if (r.bottom > bottom) window.scrollBy(0, Math.ceil(r.bottom - bottom));
  };
  const animateTo = (target) => {
    window.clearInterval(timer);
    const from = keyboard;
    if (from === target) return;
    let frame = 0;
    timer = window.setInterval(() => {
      frame += 1;
      keyboard = Math.round(from + (target - from) * Math.min(1, frame / 8));
      apply();
      reveal();
      emit("resize");
      if (frame >= 8) window.clearInterval(timer);
    }, 40);
  };
  window.__kb = {
    get height() {
      return keyboard;
    },
    get vv() {
      return fake.height;
    },
  };
  for (const type of ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
    document.addEventListener(type, () => (gesture = performance.now()), true);
  }
  // A focus() outside a tap (the step arriving) brings up no keyboard on iOS.
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target?.id !== "name" && event.target?.id !== "cant-name") return;
      window.clearTimeout(closeTimer);
      if (keyboard > 0 || performance.now() - gesture < 120) animateTo(keyboardPx);
    },
    true,
  );
  document.addEventListener(
    "focusout",
    () => {
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        if (!field()) animateTo(0);
      }, 100);
    },
    true,
  );
  window.addEventListener(
    "scroll",
    () => {
      fake.pageTop = window.scrollY;
      emit("scroll");
    },
    { passive: true },
  );
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = `
      :root { --vis: ${H - bar}px !important; }
      [data-mock] { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647; pointer-events: none;
        font: 500 15px -apple-system, "Helvetica Neue", sans-serif; color: #fff; }
      [data-mock="toolbar"] { height: ${bar}px; display: flex; gap: 8px; padding: 8px 12px 0;
        background: linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.5)); transition: none; }
      [data-mock="toolbar"] i { display: grid; place-items: center; height: 48px; border-radius: 24px; font-style: normal;
        background: rgba(60, 60, 67, 0.86); box-shadow: 0 0 0 1px rgba(255,255,255,0.14), 0 6px 18px rgba(0,0,0,0.5); }
      [data-mock="toolbar"] i.b { flex: none; width: 48px; font-size: 22px; }
      [data-mock="toolbar"] i.u { flex: 1; }
      [data-mock="keyboard"] { height: 0; overflow: hidden; background: #2b2b2f; box-shadow: 0 -1px 0 rgba(255,255,255,0.12); }
      [data-mock="keyboard"] .acc { display: flex; justify-content: space-between; align-items: center; height: 44px;
        padding: 0 16px; background: #3a3a3e; color: #8ab4ff; }
      [data-mock="keyboard"] .row { display: flex; justify-content: center; gap: 6px; padding: 10px 3px 0; }
      [data-mock="keyboard"] .row span { flex: 0 1 32px; height: 42px; border-radius: 6px; background: #6c6c70;
        display: grid; place-items: center; font-size: 20px; }
      [data-mock="keyboard"] .row span.w { flex: 0 1 200px; font-size: 15px; }
    `;
    document.head.append(style);
    spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = "0px";
    dock = document.createElement("div");
    dock.dataset.mock = "toolbar";
    dock.innerHTML = '<i class="b">‹</i><i class="u">movie.prothro.site</i><i class="b">···</i>';
    keys = document.createElement("div");
    keys.dataset.mock = "keyboard";
    const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
      .map((row) => `<div class="row">${[...row].map((k) => `<span>${k}</span>`).join("")}</div>`)
      .join("");
    keys.innerHTML = `<div class="acc"><span>⌃ ⌄</span><span>Done</span></div>${rows}<div class="row"><span>123</span><span class="w">space</span><span>done</span></div>`;
    document.body.append(spacer, dock, keys);
  });
}

async function phonePage(browser, phone) {
  const sent = [];
  const context = await browser.newContext({
    viewport: { width: phone.width, height: phone.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(iosShim, {
    bar: BAR,
    keyboardPx: phone.keyboard,
    width: phone.width,
    height: phone.height,
  });
  await context.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const body = route.request().postDataJSON() || {};
    const votes = { princess_bride: 2, top_gun: 1 };
    let data = { ok: true, rsvp: null, votes, rsvps_open: true, voting_open: true };
    if (fn === "movie_submit_rsvp") {
      sent.push(body);
      data = {
        ok: true,
        token: "tok-test",
        rsvp: { name: body.p_name, party_size: body.p_party_size, would_attend: body.p_would_attend, vote: body.p_vote },
        standings: { ok: true, votes, rsvps_open: true, voting_open: true },
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(base, { waitUntil: "load" });
  await page.locator("#cue").click();
  await page.waitForFunction(() => document.body.dataset.screen === "card", null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const top = document.getElementById("rsvp").getBoundingClientRect().top;
    return Math.abs(top) <= 1 && !document.documentElement.classList.contains("is-walking");
  });
  await page.waitForTimeout(700);
  return { context, page, sent };
}

// Samples scrollY every frame while act() runs and for WATCH_MS in all.
async function watch(page, act) {
  await page.evaluate((ms) => {
    window.__ys = [];
    const t0 = performance.now();
    const tick = (now) => {
      window.__ys.push([now - t0, window.scrollY]);
      if (now - t0 < ms) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, WATCH_MS);
  await act();
  await page.waitForFunction((ms) => window.__ys.length && window.__ys.at(-1)[0] >= ms, WATCH_MS, {
    timeout: WATCH_MS + 10000,
  });
  return page.evaluate((ms) => {
    const ys = window.__ys.map(([, y]) => y);
    let reversals = 0;
    let dir = 0;
    for (let i = 1; i < ys.length; i++) {
      const d = Math.sign(ys[i] - ys[i - 1]);
      if (!d) continue;
      if (dir && d !== dir) reversals += 1;
      dir = d;
    }
    const tail = window.__ys.filter(([t]) => t >= ms - 1000).map(([, y]) => y);
    return {
      n: ys.length,
      min: Math.min(...ys),
      max: Math.max(...ys),
      first: ys[0],
      last: ys.at(-1),
      reversals,
      tail: Math.max(...tail) - Math.min(...tail),
    };
  }, WATCH_MS);
}

const fmt = (r) => `${r.first}->${r.last} (${r.min}..${r.max}) rev ${r.reversals} tail ${r.tail}`;

function steady(r, tag, { still = false } = {}) {
  assert.ok(r.n > 40, `${tag} too few frames ${r.n}`);
  assert.equal(r.reversals, 0, `${tag} changed direction: ${fmt(r)}`);
  assert.ok(r.tail <= 1, `${tag} still moving at the end: ${fmt(r)}`);
  if (still) assert.ok(r.max - r.min <= 1, `${tag} moved: ${fmt(r)}`);
}

function layout(page) {
  return page.evaluate(() => {
    const vv = window.visualViewport;
    const step = document.querySelector(".step.is-active");
    const input = step.querySelector("#name, #cant-name");
    const label = input.closest(".field");
    const button = step.querySelector('[type="submit"]');
    const hit = (el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(at) && (at === el || el.contains(at));
    };
    const r = (el) => el.getBoundingClientRect();
    return {
      step: document.body.dataset.step,
      top: vv.offsetTop,
      bottom: vv.offsetTop + vv.height,
      keyboard: window.__kb.height,
      label: Math.round(r(label).top),
      fieldTop: Math.round(r(input).top),
      fieldBottom: Math.round(r(input).bottom),
      buttonTop: Math.round(r(button).top),
      buttonBottom: Math.round(r(button).bottom),
      hitField: hit(input),
      hitButton: hit(button),
      y: window.scrollY,
      stageTop: Math.round(document.getElementById("rsvp").getBoundingClientRect().top + window.scrollY),
      max: document.documentElement.scrollHeight - window.innerHeight,
    };
  });
}

function visible(l, tag) {
  const where = `label ${l.label} field ${l.fieldTop}-${l.fieldBottom} button ${l.buttonTop}-${l.buttonBottom} in ${l.top}-${l.bottom}`;
  assert.ok(l.label >= l.top, `${tag} label above the top: ${where}`);
  assert.ok(l.fieldBottom <= l.bottom - EDGE, `${tag} field hidden: ${where}`);
  assert.ok(l.buttonTop >= l.top, `${tag} button above the top: ${where}`);
  assert.ok(l.buttonBottom <= l.bottom - EDGE, `${tag} button hidden: ${where}`);
  assert.ok(l.hitField && l.hitButton, `${tag} not tappable: ${where}`);
  return `button ${l.buttonBottom}/${Math.round(l.bottom)}`;
}

async function keyboardSettled(page, open) {
  await page.waitForFunction((open) => (open ? window.__kb.height > 0 : window.__kb.height === 0), open);
  await page.waitForTimeout(900);
}

async function blur(page) {
  await page.evaluate(() => document.activeElement?.blur());
}

async function shot(page, name) {
  if (!shots) return;
  await page.screenshot({ path: `${shots}/${name}.png` });
  console.log("shot", name);
}

async function toName(page, label) {
  await page.locator('.poster[data-movie="princess_bride"]').tap();
  await page.locator(`[data-also="${label === "Save our spot" ? "no" : "yes"}"]`).tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  if (label === "Update") {
    await page.fill("#name", "Westley");
    await page.locator("#name-submit").tap();
    await page.waitForFunction(() => document.body.dataset.step === "confirm");
    await page.locator("#change").tap();
    await page.waitForFunction(() => document.body.dataset.step === "pick");
    await page.locator('.poster[data-movie="princess_bride"]').tap();
    await page.locator('[data-also="yes"]').tap();
    await page.waitForFunction(() => document.body.dataset.step === "name");
    await page.fill("#name", "");
  }
  await blur(page);
  await keyboardSettled(page, false);
  assert.equal((await page.locator("#name-submit").innerText()).trim(), label);
}

async function nameFlow(browser, engine, phone, label) {
  const size = `${phone.width}x${phone.height}`;
  const tag = `${engine} ${size} ${label}`;
  const { context, page, sent } = await phonePage(browser, phone);
  const out = [];

  if (label === "Count me in") {
    const cant = await page.evaluate(() => Math.round(document.getElementById("cant").getBoundingClientRect().bottom));
    assert.ok(cant <= phone.height - BAR - EDGE, `${tag} Can't make it under the toolbar at ${cant}`);
    out.push(`pick cant ${cant}/${phone.height - BAR}`);
  }

  await toName(page, label);
  let l = await layout(page);
  assert.ok(Math.abs(l.y - l.stageTop) <= 1, `${tag} not resting on the stage ${l.y} vs ${l.stageTop}`);

  await page.fill("#name", "Evan Prothro");
  await blur(page);
  await keyboardSettled(page, false);
  l = await layout(page);
  out.push(`closed ${visible(l, `${tag} closed filled`)}`);
  if (engine === "webkit" && label === "Count me in") await shot(page, `ios-closed-filled-${size}`);
  await page.fill("#name", "");
  await blur(page);
  await keyboardSettled(page, false);
  const restY = (await layout(page)).y;

  const opened = await watch(page, () => page.locator("#name").tap());
  steady(opened, `${tag} focus`);
  l = await layout(page);
  assert.ok(l.keyboard > 0, `${tag} keyboard did not open`);
  out.push(`open ${fmt(opened)} ${visible(l, `${tag} keyboard open`)}`);
  if (engine === "webkit" && label === "Count me in") await shot(page, `ios-keyboard-open-${size}`);

  const typed = await watch(page, () => page.keyboard.type("Evan Prothro", { delay: 25 }));
  steady(typed, `${tag} typing`, { still: true });
  out.push(`type ${fmt(typed)} ${visible(await layout(page), `${tag} typing`)}`);

  const bottomed = await watch(page, () =>
    page.evaluate(
      () =>
        new Promise((done) => {
          const step = () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            if (window.scrollY >= max - 0.5) return done();
            window.scrollTo(0, Math.min(max, window.scrollY + 14));
            requestAnimationFrame(step);
          };
          step();
        }),
    ),
  );
  steady(bottomed, `${tag} scroll to bottom`);
  l = await layout(page);
  assert.ok(l.y >= l.max - 1, `${tag} not at the bottom ${l.y} of ${l.max}`);
  out.push(`bottom ${fmt(bottomed)} ${visible(l, `${tag} bottom, keyboard open`)}`);

  const closed = await watch(page, () => blur(page));
  steady(closed, `${tag} close`);
  await keyboardSettled(page, false);
  l = await layout(page);
  assert.ok(Math.abs(l.y - restY) <= 1, `${tag} did not come back to rest ${l.y} vs ${restY}`);
  out.push(`close ${fmt(closed)} ${visible(l, `${tag} closed again`)}`);

  await page.fill("#name", "");
  await blur(page);
  await keyboardSettled(page, false);
  const sentBefore = sent.length;
  const empty = await watch(page, () => page.locator("#name-submit").tap());
  steady(empty, `${tag} empty submit`);
  l = await layout(page);
  assert.ok(l.keyboard > 0, `${tag} empty submit left the keyboard down`);
  const field = await page.evaluate(() => ({
    invalid: document.getElementById("name").classList.contains("is-invalid"),
    focused: document.activeElement?.id,
    error: document.getElementById("name-error").hidden,
  }));
  assert.deepEqual(field, { invalid: true, focused: "name", error: true }, tag);
  assert.equal(sent.length, sentBefore, `${tag} empty submit sent`);
  out.push(`empty ${fmt(empty)} ${visible(l, `${tag} empty submit`)}`);
  if (engine === "webkit" && label === "Count me in") await shot(page, `ios-empty-submit-${size}`);

  const again = await watch(page, () => page.locator("#name-submit").tap());
  steady(again, `${tag} empty submit, keyboard up`, { still: true });
  assert.equal(sent.length, sentBefore, `${tag} second empty submit sent`);
  out.push(`again ${fmt(again)} ${visible(await layout(page), `${tag} empty submit, keyboard up`)}`);

  await page.keyboard.type("Buttercup", { delay: 20 });
  const saved = await watch(page, () => page.locator("#name-submit").tap());
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  steady(saved, `${tag} submit`);
  await keyboardSettled(page, false);
  const done = await page.evaluate(() => ({
    y: window.scrollY,
    stageTop: Math.round(document.getElementById("rsvp").getBoundingClientRect().top + window.scrollY),
  }));
  assert.ok(Math.abs(done.y - done.stageTop) <= 1, `${tag} confirm not at the stage ${done.y} vs ${done.stageTop}`);
  assert.equal(sent.length, sentBefore + 1, `${tag} saved`);
  assert.equal(sent.at(-1).p_name, "Buttercup", tag);
  out.push(`save ${fmt(saved)}`);

  console.log("ok", tag, "\n   ", out.join("\n    "));
  await context.close();
}

async function cantFlow(browser, engine, phone) {
  const size = `${phone.width}x${phone.height}`;
  const tag = `${engine} ${size} cant`;
  const { context, page, sent } = await phonePage(browser, phone);
  await page.locator("#cant").tap();
  await page.waitForFunction(() => document.body.dataset.step === "cant");
  await blur(page);
  await keyboardSettled(page, false);
  const rest = visible(await layout(page), `${tag} closed`);
  const opened = await watch(page, () => page.locator("#cant-name").tap());
  steady(opened, `${tag} focus`);
  const open = visible(await layout(page), `${tag} keyboard open`);
  const empty = await watch(page, () => page.locator("#cant-submit").tap());
  steady(empty, `${tag} empty submit`, { still: true });
  visible(await layout(page), `${tag} empty submit`);
  assert.equal(sent.length, 0, `${tag} sent`);
  console.log("ok", tag, `closed ${rest}`, `open ${fmt(opened)} ${open}`, `empty ${fmt(empty)}`);
  await context.close();
}

for (const name of only) {
  const browser = await engines[name].launch();
  for (const phone of phones) {
    for (const label of phone.variants) await nameFlow(browser, name, phone, label);
    await cantFlow(browser, name, phone);
  }
  await browser.close();
}
console.log("all keyboard paths passed");
