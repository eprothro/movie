// Both answers to "And if the other one wins?", for each movie, plus can't-make-it.
// Run from the repo root, with the site already being served:
//   python3 -m http.server 8765
//   NODE_PATH=/tmp/pw/node_modules node tools/rsvp-paths.mjs
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.RSVP_BASE || "http://127.0.0.1:8765/";
const shots = process.env.RSVP_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

const movies = [
  ["princess_bride", "The Princess Bride"],
  ["top_gun", "Top Gun: Maverick"],
];

const browser = await chromium.launch();
const submitted = [];

async function newPage(viewport, userAgent) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    ...(userAgent ? { userAgent } : {}),
  });
  await context.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const body = route.request().postDataJSON() || {};
    const votes = { princess_bride: 2, top_gun: 1 };
    let data;
    if (fn === "movie_submit_rsvp") {
      submitted.push(body);
      data = {
        ok: true,
        token: "tok-test",
        rsvp: {
          name: body.p_name,
          party_size: body.p_party_size,
          would_attend: body.p_would_attend,
          vote: body.p_vote,
        },
        standings: { ok: true, votes, rsvps_open: true, voting_open: true },
      };
    } else {
      data = { ok: true, rsvp: null, votes, rsvps_open: true, voting_open: true };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.dataset.screen === "card");
  return { context, page };
}

async function screen(page) {
  await page.waitForFunction(() => !document.getElementById("screen-card").classList.contains("is-swapping"));
  return page.evaluate(() => ({
    kicker: document.getElementById("screen-kicker").textContent,
    line: document.getElementById("screen-line").textContent,
    sub: document.getElementById("screen-sub").textContent,
    heading: document.getElementById("confirm-title").textContent,
    headingHidden: document.getElementById("confirm-title").classList.contains("sr-only"),
    step: document.body.dataset.step,
  }));
}

// The confirm step fades in, and the corn fill runs after a frame. A shot
// taken on the step change catches an empty pasture under the screen.
async function confirmChrome(page, label) {
  // A short phone leaves Change RSVP just past the fold. Bring it up only
  // while the movie screen stays fully in frame.
  await page.evaluate(() => {
    const change = document.getElementById("change");
    const screen = document.querySelector(".screen");
    const overflow = change.getBoundingClientRect().bottom - window.innerHeight;
    const room = screen.getBoundingClientRect().top - 12;
    const nudge = Math.min(Math.max(0, overflow), Math.max(0, room));
    if (nudge > 1) window.scrollBy(0, Math.ceil(nudge));
  });
  await page.waitForFunction(() => {
    const votes = document.getElementById("votes");
    const change = document.getElementById("change");
    const step = votes.closest(".step");
    const box = (el) => {
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.95) return null;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return null;
      return rect;
    };
    const votesBox = box(votes);
    const changeBox = box(change);
    if (!step.classList.contains("is-active") || !votesBox || !changeBox) return false;
    const vh = window.innerHeight;
    if (votesBox.top < -1 || votesBox.bottom > vh + 1 || changeBox.top > vh - 8) return false;
    // Corn starts fully lowered and rises after the fill transition. Reduced
    // motion only shortens the duration; the delay still has to elapse.
    return [...votes.querySelectorAll(".corn")].every((corn) => {
      const ty = new DOMMatrix(getComputedStyle(corn).transform).m42;
      return ty < corn.getBoundingClientRect().height * 0.5;
    });
  });
  const boxes = await page.evaluate(() => ({
    votes: (() => {
      const el = document.getElementById("votes");
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, text: el.innerText, label: el.getAttribute("aria-label") };
    })(),
    change: (() => {
      const el = document.getElementById("change");
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, text: el.textContent, hidden: el.hidden };
    })(),
    vh: window.innerHeight,
  }));
  assert.equal(boxes.change.hidden, false, `${label} Change RSVP hidden`);
  assert.match(boxes.change.text, /Change RSVP/, `${label} Change RSVP`);
  assert.match(boxes.votes.text, /votes so far/i, `${label} standings`);
  assert.match(boxes.votes.text, /The Princess Bride/, `${label} princess tub`);
  assert.match(boxes.votes.text, /Top Gun: Maverick/, `${label} top gun tub`);
  assert.match(boxes.votes.label, /The Princess Bride 2/, `${label} princess count`);
  assert.match(boxes.votes.label, /Top Gun: Maverick 1/, `${label} top gun count`);
  assert.ok(boxes.votes.top >= -1 && boxes.votes.bottom <= boxes.vh + 1, `${label} standings in view`);
  assert.ok(boxes.change.top < boxes.vh - 8, `${label} Change RSVP in view`);
  assert.equal(await page.locator(".route-alt, [data-dir-alt]").count(), 0, `${label} secondary maps link`);
  const badge = await page.evaluate(() => {
    const labels = [...document.querySelectorAll(".you")].map((el) => el.textContent);
    const mine = document.querySelector(".bucket.is-mine .you");
    if (!mine) return { labels, shown: false };
    const pill = mine.getBoundingClientRect();
    const row = mine.parentElement.getBoundingClientRect();
    const bucket = mine.closest(".bucket").getBoundingClientRect();
    const style = getComputedStyle(mine);
    return {
      labels,
      shown: style.display !== "none" && Number(style.opacity) > 0.9,
      text: mine.textContent,
      lines: mine.getClientRects().length,
      fits: pill.left >= bucket.left - 1 && pill.right <= bucket.right + 1 && pill.top >= row.top - 1 && pill.bottom <= row.bottom + 1,
    };
  });
  assert.deepEqual(badge.labels, ["Your vote", "Your vote"], `${label} badge copy`);
  if (label !== "cant") {
    assert.equal(badge.shown, true, `${label} badge shown`);
    assert.equal(badge.text, "Your vote", `${label} badge`);
    assert.equal(badge.lines, 1, `${label} badge wraps`);
    assert.equal(badge.fits, true, `${label} badge fits beside the count`);
  }
}

function oneLine(page, id) {
  return page.locator(id).evaluate((el) => {
    const rects = [...el.getClientRects()];
    const face = document.querySelector(".face").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      lines: rects.length,
      inside: box.width === 0 || (box.left >= face.left - 1 && box.right <= face.right + 1),
    };
  });
}

const viewports = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
];

for (const viewport of viewports) {
  const size = `${viewport.width}x${viewport.height}`;
  for (const [id, title] of movies) {
    for (const answer of ["yes", "no"]) {
      const conditional = answer === "no";
      const { context, page } = await newPage(viewport);
      await page.locator(`.poster[data-movie="${id}"]`).tap();
      await page.locator(`[data-also="${answer}"]`).tap();
      await page.waitForFunction(() => document.body.dataset.step === "name");
      const ask = await screen(page);
      const button = await page.locator("#name-submit").innerText();
      const spoken = await page.locator("#name-title").innerText();
      assert.equal(ask.line, "Who's coming?", `${id} ${answer} line`);
      assert.equal(ask.sub, conditional ? `(assuming ${title} wins)` : "", `${id} ${answer} subtitle`);
      assert.equal(button, conditional ? "Save our spot" : "Count me in", `${id} ${answer} button`);
      assert.equal(spoken, conditional ? `Who's coming? (assuming ${title} wins)` : "Who's coming?");
      await page.fill("#name", "Westley");
      await page.locator("#name-submit").tap();
      await page.waitForFunction(() => document.body.dataset.step === "confirm");
      const done = await screen(page);
      const payload = submitted.at(-1);
      assert.equal(payload.p_vote, id);
      assert.equal(payload.p_would_attend, conditional ? id : "both");
      assert.equal(done.kicker, "");
      assert.equal(done.line, "See you Saturday");
      assert.equal(done.headingHidden, true);
      const line = await oneLine(page, "#screen-line");
      assert.equal(line.lines, 1, `${id} ${answer} screen line wraps at ${size}`);
      assert.equal(line.inside, true, `${id} ${answer} screen line overflows at ${size}`);
      if (conditional) {
        assert.equal(done.sub, `if ${title} wins`);
        assert.equal(done.heading, `See you Saturday if ${title} wins.`);
        const sub = await oneLine(page, "#screen-sub");
        assert.equal(sub.lines, 1, `${id} screen subtitle wraps at ${size}`);
        assert.equal(sub.inside, true, `${id} screen subtitle overflows at ${size}`);
      } else {
        assert.equal(done.sub, "");
        assert.equal(done.heading, "See you Saturday.");
        const subLines = await page.locator("#screen-sub").evaluate((el) => el.getClientRects().length);
        assert.equal(subLines, 0, `${id} still-in subline`);
      }
      await confirmChrome(page, `${id} ${answer}`);
      if (shots && !conditional) {
        await page.screenshot({ path: `${shots}/still-in-${id}-${size}.png` });
      }
      if (shots && conditional && id === "princess_bride") {
        await page.screenshot({ path: `${shots}/conditional-${id}-${size}.png` });
      }
      console.log("ok", size, id, answer, button, JSON.stringify(ask.sub), "->", payload.p_would_attend);
      await context.close();
    }
  }

  {
    const { context, page } = await newPage(viewport);
    await page.locator("#cant").tap();
    await page.waitForFunction(() => document.body.dataset.step === "cant");
    const ask = await screen(page);
    assert.equal(ask.line, "We'll see you next time!");
    assert.equal(ask.sub, "");
    await page.fill("#cant-name", "Buttercup");
    await page.locator("#cant-submit").tap();
    await page.waitForFunction(() => document.body.dataset.step === "confirm");
    const done = await screen(page);
    const payload = submitted.at(-1);
    assert.equal(payload.p_would_attend, "none");
    assert.equal(payload.p_vote, null);
    assert.equal(done.line, "We'll see you next time!");
    assert.equal(done.heading, "We'll see you next time!");
    assert.equal(done.headingHidden, true);
  await confirmChrome(page, "cant");
  if (shots) await page.screenshot({ path: `${shots}/cant-${size}.png` });
  console.log("ok", size, "cant");
  await context.close();
  }

  {
    const id = "princess_bride";
    const title = "The Princess Bride";
    const { context, page } = await newPage(viewport);
    await page.evaluate(() => {
      window.__seen = [];
      const card = document.getElementById("screen-card");
      const grab = () => {
        const opacity = Number(getComputedStyle(card).opacity);
        const swapping = card.classList.contains("is-swapping");
        if (swapping || opacity < 0.9) return;
        const snap = [
          document.body.dataset.step,
          document.getElementById("screen-kicker").textContent,
          document.getElementById("screen-line").textContent,
          document.getElementById("screen-sub").textContent,
          document.getElementById("confirm-title").classList.contains("sr-only") ? "hidden" : "shown",
        ].join("|");
        const log = window.__seen;
        if (log.at(-1) !== snap) log.push(snap);
      };
      new MutationObserver(grab).observe(card, {
        subtree: true,
        attributes: true,
        characterData: true,
        childList: true,
      });
      new MutationObserver(grab).observe(document.getElementById("confirm-title"), { attributes: true, childList: true, characterData: true });
    });
    const lineTop = () =>
      page.evaluate(() => {
        const line = document.getElementById("screen-line").getBoundingClientRect();
        const face = document.querySelector(".face").getBoundingClientRect();
        return Math.round(line.top - face.top);
      });

    await page.locator(`.poster[data-movie="${id}"]`).tap();
    await page.locator('[data-also="yes"]').tap();
    await page.fill("#name", "Westley");
    await page.locator("#name-submit").tap();
    await page.waitForFunction(() => document.body.dataset.step === "confirm");
    const still = await screen(page);
    assert.equal(still.line, "See you Saturday");
    assert.equal(still.sub, "");
    assert.equal(still.kicker, "");
    assert.equal(still.headingHidden, true);
    const stillTop = await lineTop();

    await page.locator("#change").tap();
    await page.waitForFunction(() => document.body.dataset.step === "pick");
    await page.locator(`.poster[data-movie="${id}"]`).tap();
    await page.waitForFunction(() => document.body.dataset.step === "other");
    await page.locator('[data-also="no"]').tap();
    await page.waitForFunction(() => document.body.dataset.step === "name");
    const probably = await screen(page);
    assert.equal(probably.line, "Who's coming?");
    assert.equal(probably.sub, `(assuming ${title} wins)`);
    await page.locator(".step.is-active [data-back]").tap();
    await page.waitForFunction(() => document.body.dataset.step === "other");
    await page.locator('[data-also="yes"]').tap();
    await page.waitForFunction(() => document.body.dataset.step === "name");
    const back = await screen(page);
    assert.equal(back.line, "Who's coming?");
    assert.equal(back.sub, "");
    await page.locator("#name-submit").tap();
    await page.waitForFunction(() => document.body.dataset.step === "confirm");
    const again = await screen(page);
    assert.equal(again.line, "See you Saturday");
    assert.equal(again.sub, "");
    assert.equal(again.kicker, "");
    assert.equal(again.headingHidden, true);
    assert.equal(await lineTop(), stillTop, `${size} still-in line moved`);

    await page.locator("#change").tap();
    await page.waitForFunction(() => document.body.dataset.step === "pick");
    await page.locator(`.poster[data-movie="${id}"]`).tap();
    await page.waitForFunction(() => document.body.dataset.step === "other");
    await page.locator('[data-also="no"]').tap();
    await page.waitForFunction(() => document.body.dataset.step === "name");
    await page.locator("#name-submit").tap();
    await page.waitForFunction(() => document.body.dataset.step === "confirm");
    const conditional = await screen(page);
    assert.equal(conditional.line, "See you Saturday");
    assert.equal(conditional.sub, `if ${title} wins`);
    assert.equal(conditional.kicker, "");
    assert.equal(conditional.headingHidden, true);
    const condTop = await lineTop();
    assert.ok(Math.abs(condTop - stillTop) <= 1, `${size} headline shifted ${stillTop} vs ${condTop}`);

    const seen = await page.evaluate(() => window.__seen);
    const flashed = seen.filter((snap) => {
      const [step, kicker, line, sub, heading] = snap.split("|");
      if (kicker === "Your vote") return true;
      if (line === title) return true;
      if (heading === "shown" && step === "confirm") return true;
      if (step === "confirm" && line === "See you Saturday" && sub.startsWith("if ") && !sub.includes(title)) return true;
      return false;
    });
    assert.deepEqual(flashed, [], `${size} stale screen text`);
    console.log("ok", size, "edit switch");
    await context.close();
  }
}

for (const viewport of viewports) {
  const size = `${viewport.width}x${viewport.height}`;
  const { context, page } = await newPage(viewport);
  const label = () => page.locator("#name-submit").innerText().then((text) => text.trim());
  const box = async () => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page.locator("#name-submit").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
  };
  await page.locator('.poster[data-movie="princess_bride"]').tap();
  await page.locator('[data-also="yes"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".step.is-active")).transform === "none");
  assert.equal(await label(), "Count me in", `${size} party 1`);
  const atOne = await box();
  await page.locator("#party-inc").tap();
  assert.equal(await page.locator("#party-value").innerText(), "2");
  assert.equal(await label(), "Count us in", `${size} party 2`);
  const atTwo = await box();
  assert.deepEqual(atTwo, atOne, `${size} button shifted ${JSON.stringify(atOne)} -> ${JSON.stringify(atTwo)}`);
  await page.locator("#party-dec").tap();
  assert.equal(await label(), "Count me in", `${size} back to 1`);
  assert.deepEqual(await box(), atOne, `${size} button shifted on the way back`);
  await page.locator("#party-inc").tap();
  await page.locator(".step.is-active [data-back]").tap();
  await page.waitForFunction(() => document.body.dataset.step === "other");
  await page.locator('[data-also="yes"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  assert.equal(await label(), "Count us in", `${size} already 2`);
  await page.locator(".step.is-active [data-back]").tap();
  await page.waitForFunction(() => document.body.dataset.step === "other");
  await page.locator('[data-also="no"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  assert.equal(await label(), "Save our spot", `${size} conditional at 2`);
  await page.locator("#party-inc").tap();
  assert.equal(await label(), "Save our spot", `${size} conditional stepper`);
  await page.locator("#party-dec").tap();
  await page.locator(".step.is-active [data-back]").tap();
  await page.waitForFunction(() => document.body.dataset.step === "other");
  await page.locator('[data-also="yes"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  assert.equal(await label(), "Count us in", `${size} definite again`);
  if (shots && viewport.width === 390) {
    await page.fill("#name", "Evan Prothro");
    await page.screenshot({ path: `${shots}/count-us-in-${size}.png` });
    console.log("shot", `count-us-in-${size}`);
    await page.fill("#name", "");
  }
  await page.fill("#name", "Westley");
  await page.locator("#name-submit").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  assert.equal(submitted.at(-1).p_party_size, 2, `${size} saved headcount`);
  await page.locator("#change").tap();
  await page.waitForFunction(() => document.body.dataset.step === "pick");
  await page.locator('.poster[data-movie="princess_bride"]').tap();
  await page.locator('[data-also="yes"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  assert.equal(await page.locator("#party-value").innerText(), "2", `${size} edited headcount`);
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".step.is-active")).transform === "none");
  assert.equal(await label(), "Update", `${size} editing a pair`);
  const editing = await box();
  await page.locator("#party-inc").tap();
  await page.locator("#party-dec").tap();
  assert.equal(await label(), "Update", `${size} editing stepper`);
  assert.deepEqual(await box(), editing, `${size} update button shifted`);
  console.log("ok", size, "count us in");
  await context.close();
}

const maps = {
  google: "https://www.google.com/maps/dir/?api=1&destination=32.15498,-95.36768",
  apple: "https://maps.apple.com/?daddr=32.15498,-95.36768&dirflg=d",
  geo: "geo:0,0?q=32.15498,-95.36768(Prothro%20Movie%20Night)",
};

async function directions(userAgent) {
  const { context, page } = await newPage({ width: 390, height: 844 }, userAgent);
  const info = await page.evaluate(() => ({
    hrefs: [...document.querySelectorAll("[data-dir]")].map((a) => a.getAttribute("href")),
    alts: document.querySelectorAll(".route-alt, [data-dir-alt]").length,
    texts: [...document.querySelectorAll("a")].map((a) => a.textContent.replace(/\s+/g, " ").trim()),
  }));
  await context.close();
  return info;
}

function assertMaps(info, expected, label) {
  assert.equal(info.alts, 0, `${label} secondary link`);
  assert.ok(info.hrefs.length >= 3, `${label} link count`);
  for (const href of info.hrefs) assert.equal(href, expected, label);
  assert.equal(info.texts.filter((text) => text === "Apple Maps" || text === "Google Maps").length, 0, label);
  assert.ok(info.texts.some((text) => text.includes("Directions")), label);
  assert.ok(info.texts.some((text) => text.includes("Bullard, TX")), label);
}

const iphoneUA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const androidUA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const desktopUA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

assertMaps(await directions(iphoneUA), maps.apple, "iphone");
assertMaps(await directions(androidUA), maps.geo, "android");
assertMaps(await directions(desktopUA), maps.google, "desktop");

{
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "load" });
  const hrefs = await page.locator("[data-dir]").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  assert.ok(hrefs.length >= 3);
  for (const href of hrefs) assert.equal(href, maps.google, "html default");
  assert.equal(await page.locator(".route-alt, [data-dir-alt]").count(), 0);
  await context.close();
}
console.log("ok directions", maps.apple, maps.geo, maps.google);

const introCases = [
  ["2026-10-09T15:00-05:00", false, "friday"],
  ["2026-10-10T11:59-05:00", false, "saturday-1159"],
  ["2026-10-10T12:00-05:00", true, "saturday-noon"],
  ["2026-10-10T13:00-05:00", true, "saturday-1pm"],
  ["2026-10-10T21:00-05:00", true, "saturday-9pm"],
  ["2026-10-11T10:00-05:00", false, "sunday"],
  ["2026-10-10T16:59:00Z", false, "utc-before-noon-chicago"],
  ["2026-10-10T17:00:00Z", true, "utc-noon-chicago"],
];

function countdownText(nowIso, showIso) {
  const diff = new Date(showIso).getTime() - new Date(nowIso).getTime();
  if (diff <= 0) return -diff < 3 * 3600e3 ? "Now showing" : "That was a good one";
  const total = Math.floor(diff / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${String(h).padStart(2, "0")}h`);
  parts.push(`${String(m).padStart(2, "0")}m`, `${String(s).padStart(2, "0")}s`);
  return parts.join("");
}

async function introAt(now, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  const url = new URL(base);
  url.searchParams.set("now", now);
  await page.goto(url.href, { waitUntil: "load" });
  await page.waitForFunction(() => /\d/.test(document.getElementById("showtime").textContent));
  const info = await page.evaluate(() => {
    const where = document.querySelector(".hero .where");
    const box = where.getBoundingClientRect();
    const cue = document.getElementById("cue").getBoundingClientRect();
    return {
      date: document.getElementById("date-label").textContent,
      when: document.querySelector(".when").innerText.replace(/\s+/g, " ").trim(),
      place: where.querySelector("span").textContent.trim(),
      tonight: where.classList.contains("is-tonight"),
      href: where.getAttribute("href"),
      height: box.height,
      width: box.width,
      rm: document.getElementById("rm-date").textContent,
      bring: [...document.querySelector(".hero .bring").children].map((el) => el.textContent).join("|"),
      bringGaps: (() => {
        const gaps = (el) => {
          const [a, dot, b] = [...el.children].map((node) => node.getBoundingClientRect());
          return { left: dot.left - a.right, right: b.left - dot.right };
        };
        return { bring: gaps(document.querySelector(".hero .bring")), when: gaps(document.querySelector(".when")) };
      })(),
      countdown: document.getElementById("countdown").textContent,
      countSize: parseFloat(getComputedStyle(document.getElementById("countdown")).fontSize),
      numSize: document.querySelector("#countdown b")
        ? parseFloat(getComputedStyle(document.querySelector("#countdown b")).fontSize)
        : 0,
      unitSize: document.querySelector("#countdown span")
        ? parseFloat(getComputedStyle(document.querySelector("#countdown span")).fontSize)
        : 0,
      showtime: document.getElementById("showtime").dateTime,
      gap: document.getElementById("countdown").getBoundingClientRect().top - box.bottom,
      cueTop: cue.top,
      cueBottom: cue.bottom,
      vh: window.innerHeight,
      scroll: window.scrollY,
    };
  });
  return { context, page, info };
}

for (const [now, tonight, label] of introCases) {
  const { context, info } = await introAt(now, { width: 390, height: 844 });
  assert.equal(info.tonight, tonight, label);
  assert.equal(info.date, tonight ? "Tonight" : "Saturday, Oct 10", label);
  assert.equal(info.rm, tonight ? "Tonight" : "Saturday, Oct 10", label);
  assert.equal(info.place, tonight ? "Directions" : "Bullard, TX", label);
  assert.equal(info.bring, "Snacks provided||Bring your own chair", label);
  assert.ok(Math.abs(info.bringGaps.bring.left - info.bringGaps.bring.right) < 1, `${label} dot ${info.bringGaps.bring.left} ${info.bringGaps.bring.right}`);
  assert.ok(Math.abs(info.bringGaps.bring.left - info.bringGaps.when.left) < 1, `${label} dot vs date`);
  assert.ok(Math.abs(info.bringGaps.bring.right - info.bringGaps.when.right) < 1, `${label} dot vs showtime`);
  if (info.numSize) assert.ok(info.numSize >= info.unitSize + 6, `${label} countdown type ${info.numSize}/${info.unitSize}`);
  else assert.ok(info.countSize >= 16, `${label} countdown size ${info.countSize}`);
  assert.match(info.when, /Showtime/, label);
  assert.match(info.when, /\d/, label);
  assert.equal(info.href, maps.google, label);
  const expected = countdownText(now, info.showtime);
  assert.equal(info.countdown, expected, `${label} countdown`);
  assert.doesNotMatch(info.countdown, /^-|00h00m00s/, `${label} broken countdown`);
  assert.equal(info.scroll, 0, label);
  if (tonight) {
    assert.ok(info.height >= 44, `${label} height ${info.height}`);
    assert.ok(info.width >= 44, `${label} width ${info.width}`);
    assert.ok(info.gap >= 20, `${label} countdown gap ${info.gap}`);
  } else {
    assert.ok(info.gap < 12, `${label} normal gap changed ${info.gap}`);
  }
  assert.ok(info.cueBottom <= info.vh + 1, `${label} scroll cue clipped`);
  console.log("ok intro", label, info.date, info.place, info.countdown, `gap ${Math.round(info.gap)}`);
  await context.close();
}

{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: iphoneUA,
  });
  const page = await context.newPage();
  const url = new URL(base);
  url.searchParams.set("now", "2026-10-10T13:00-05:00");
  await page.goto(url.href, { waitUntil: "load" });
  const href = await page.locator(".hero .where").getAttribute("href");
  assert.equal(href, maps.apple, "saturday iphone directions");
  assert.equal(await page.locator(".hero .where span").textContent(), "Directions");
  await context.close();
  console.log("ok intro iphone directions");
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(base, { waitUntil: "load" });
  await page.locator("#cue").click();
  await page.waitForFunction(() => {
    const y = window.scrollY;
    const prev = window.__scrollY ?? -1;
    window.__scrollY = y;
    window.__scrollStable = y === prev ? (window.__scrollStable || 0) + 1 : 0;
    const leader = parseFloat(getComputedStyle(document.querySelector(".leader")).opacity);
    const card = parseFloat(getComputedStyle(document.getElementById("screen-card")).opacity);
    const posters = parseFloat(getComputedStyle(document.getElementById("posters")).opacity);
    return (
      document.body.dataset.screen === "card" &&
      leader < 0.05 &&
      card > 0.98 &&
      posters > 0.98 &&
      window.__scrollStable > 2 &&
      y > 80
    );
  });
  const choice = await page.evaluate(() => {
    const arts = [...document.querySelectorAll(".poster-art")].map((el) => el.getBoundingClientRect());
    const posters = [...document.querySelectorAll(".poster")].map((el) => el.getBoundingClientRect());
    const or = document.querySelector(".choice-or").getBoundingClientRect();
    const style = getComputedStyle(document.querySelector(".choice-or"));
    return {
      text: document.querySelector(".choice-or").textContent,
      titleOpacity: parseFloat(getComputedStyle(document.querySelector(".poster-title")).opacity),
      titleColor: getComputedStyle(document.querySelector(".poster-title")).color,
      leaderOpacity: parseFloat(getComputedStyle(document.querySelector(".leader")).opacity),
      font: style.fontFamily,
      style: style.fontStyle,
      color: style.color,
      or: { cx: or.left + or.width / 2, cy: or.top + or.height / 2, w: or.width, h: or.height },
      arts: arts.map((r) => ({ t: r.top, b: r.bottom, l: r.left, r: r.right, cx: r.left + r.width / 2 })),
      posters: posters.map((r) => ({ l: r.left, r: r.right, b: r.bottom })),
      vw: innerWidth,
      vh: innerHeight,
    };
  });
  const size = `${viewport.width}x${viewport.height}`;
  assert.equal(choice.text, "or", size);
  assert.equal(choice.titleOpacity, 1, `${size} title opacity`);
  assert.ok(choice.leaderOpacity < 0.05, `${size} leader still up`);
  assert.equal(choice.style, "italic", size);
  assert.ok(choice.or.w >= 32 && choice.or.h >= 32, size);
  const sideBySide = choice.arts[0].b > choice.arts[1].t && choice.arts[1].l > choice.arts[0].r - 8;
  if (sideBySide) {
    const mid = (choice.arts[0].cx + choice.arts[1].cx) / 2;
    assert.ok(Math.abs(choice.or.cx - mid) <= 6, `${size} or x ${choice.or.cx} vs ${mid}`);
    assert.ok(choice.or.cy > choice.arts[0].t + 8 && choice.or.cy < choice.arts[0].b - 8, `${size} or y ${choice.or.cy}`);
  } else {
    assert.ok(choice.or.cy > choice.arts[0].b - 4 && choice.or.cy < choice.arts[1].t + 4, `${size} stacked or`);
  }
  for (const poster of choice.posters) {
    assert.ok(poster.l >= -1 && poster.r <= choice.vw + 1, `${size} poster offscreen`);
  }
  console.log("ok choice", size, sideBySide ? "side by side" : "stacked", `title ${choice.titleOpacity} ${choice.titleColor}`, `leader ${choice.leaderOpacity}`);
  if (shots) {
    await page.screenshot({ path: `${shots}/choice-or-${size}.png` });
    console.log("shot", `choice-or-${size}`);
  }
  await context.close();
}

if (shots) {
  const shotsWanted = [
    ["2026-10-10T13:00-05:00", { width: 375, height: 667 }, "intro-saturday-1pm-375x667"],
    ["2026-10-10T13:00-05:00", { width: 390, height: 844 }, "intro-saturday-1pm-390x844"],
    ["2026-10-09T15:00-05:00", { width: 375, height: 667 }, "intro-normal-375x667"],
    ["2026-10-09T15:00-05:00", { width: 390, height: 844 }, "intro-normal-390x844"],
  ];
  for (const [now, viewport, name] of shotsWanted) {
    const { context, page, info } = await introAt(now, viewport);
    assert.equal(info.place, name.startsWith("intro-saturday") ? "Directions" : "Bullard, TX", name);
    assert.equal(info.bring, "Snacks provided||Bring your own chair", name);
    assert.equal(info.countdown, countdownText(now, info.showtime), name);
    if (name.includes("1pm") && viewport.height > 740) assert.ok(info.gap >= 18, `${name} gap ${info.gap}`);
    await page.waitForFunction(() => {
      const cue = getComputedStyle(document.getElementById("cue")).opacity === "1";
      const top = document.querySelector(".screen").getBoundingClientRect().top;
      const prev = window.__screenTop;
      window.__screenTop = top;
      window.__screenStable = prev != null && Math.abs(top - prev) < 0.5 ? (window.__screenStable || 0) + 1 : 0;
      return cue && window.__screenStable > 4;
    });
    const clear = await page.evaluate(() => {
      const c = document.getElementById("countdown").getBoundingClientRect();
      const screen = document.querySelector(".screen").getBoundingClientRect();
      const cue = document.getElementById("cue").getBoundingClientRect();
      return {
        sky: screen.top - c.bottom,
        cueTop: cue.top,
        cueBottom: cue.bottom,
        countBottom: c.bottom,
        vh: innerHeight,
      };
    });
    assert.ok(clear.sky >= 8, `${name} overlaps the screen by ${-clear.sky}`);
    assert.ok(clear.cueBottom <= clear.vh + 1, `${name} scroll cue clipped`);
    assert.ok(clear.cueTop >= clear.countBottom - 1, `${name} countdown overlaps scroll`);
    await page.screenshot({ path: `${shots}/${name}.png` });
    console.log("shot", name);
    await context.close();
  }
}

await browser.close();
console.log("all paths passed");
