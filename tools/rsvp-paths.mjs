// Both answers to "And if the other one wins?", for each movie, plus can't-make-it.
// Run from the repo root, with the site already being served:
//   python3 -m http.server 8765
//   NODE_PATH=/tmp/pw/node_modules node tools/rsvp-paths.mjs
import { chromium } from "playwright";
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

async function newPage(viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
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
      if (conditional) {
        assert.equal(done.kicker, "");
        assert.equal(done.line, "See you Saturday");
        assert.equal(done.sub, `if ${title} wins`);
        assert.equal(done.headingHidden, true);
        assert.equal(done.heading, `See you Saturday if ${title} wins.`);
        const line = await oneLine(page, "#screen-line");
        const sub = await oneLine(page, "#screen-sub");
        assert.equal(line.lines, 1, `${id} screen line wraps at ${size}`);
        assert.equal(sub.lines, 1, `${id} screen subtitle wraps at ${size}`);
        assert.equal(line.inside, true, `${id} screen line overflows at ${size}`);
        assert.equal(sub.inside, true, `${id} screen subtitle overflows at ${size}`);
      } else {
        assert.equal(done.kicker, "Your vote");
        assert.equal(done.line, title);
        assert.equal(done.sub, "");
        assert.equal(done.headingHidden, false);
        assert.equal(done.heading, "See you Saturday.");
      }
      await confirmChrome(page, `${id} ${answer}`);
      const shoot = shots && (conditional || (id === "princess_bride" && answer === "yes"));
      if (shoot) {
        const name = conditional ? `conditional-${id}` : "still-in";
        await page.screenshot({ path: `${shots}/${name}-${size}.png` });
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
    console.log("ok", size, "cant");
    await context.close();
  }
}

await browser.close();
console.log("all paths passed");
