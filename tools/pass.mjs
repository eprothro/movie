// Pass the phone: parties of 2+ only. One tap is one person. A fast double
// tap casts one vote. Anyone who has not tapped yet still counts toward the
// RSVP vote, so a party of 4 never becomes 8. Nothing calls the live database.
//
//   python3 -m http.server 8765
//   node tools/pass.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.RSVP_BASE || "http://127.0.0.1:8765/";
const shots = process.env.RSVP_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();

function standings(votes, coming) {
  return { ok: true, votes, coming, rsvps_open: true, voting_open: true };
}

function sharesOf(saved) {
  const extras = Array.isArray(saved.extra_votes) ? saved.extra_votes : [];
  const unvoted = Math.max(0, saved.party_size - 1 - extras.length);
  const votes = { inside_out_2026: 0, wild_robot: 0 };
  if (saved.would_attend !== "none" && saved.vote) votes[saved.vote] += 1 + unvoted;
  for (const id of extras) votes[id] += 1;
  return votes;
}

async function guest(viewport) {
  const calls = [];
  let saved = null;
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
    if (fn === "movie_get_standings") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(standings({ inside_out_2026: 0, wild_robot: 0 }, 0)),
      });
      return;
    }
    if (fn === "movie_get_rsvp") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, rsvp: saved }),
      });
      return;
    }
    if (fn === "movie_submit_rsvp") {
      calls.push({ fn, body });
      saved = {
        name: body.p_name,
        party_size: body.p_party_size,
        would_attend: body.p_would_attend,
        vote: body.p_vote,
        extra_votes: null,
        note: body.p_note || "",
      };
      const votes = sharesOf(saved);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          token: "tok-pass",
          rsvp: saved,
          standings: standings(votes, saved.would_attend === "none" ? 0 : saved.party_size),
        }),
      });
      return;
    }
    if (fn === "movie_pass_vote") {
      calls.push({ fn, body });
      // Stay on the posters long enough for a second tap to land.
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!saved) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "not_found" }),
        });
        return;
      }
      const list = Array.isArray(saved.extra_votes) ? saved.extra_votes : [];
      if (body.p_vote) {
        saved = { ...saved, extra_votes: [...list, body.p_vote] };
      } else {
        const next = list.slice(0, -1);
        saved = { ...saved, extra_votes: next.length ? next : null };
      }
      const votes = sharesOf(saved);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          rsvp: saved,
          standings: standings(votes, saved.party_size),
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector(".poster"));
  return { context, page, calls };
}

async function rsvp(page, { party, movie = "inside_out_2026", also = "yes" }) {
  await page.locator(`#posters .poster[data-movie="${movie}"]`).tap();
  await page.locator(`[data-also="${also}"]`).tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  const active = await page.locator(".step.is-active").innerText();
  assert.doesNotMatch(active, /Pass the phone/, "first-time flow stays free of the handoff");
  for (let i = 1; i < party; i += 1) await page.locator("#party-inc").tap();
  await page.fill("#name", "Westley");
  await page.locator("#name-submit").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
}

async function painted(page) {
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".step.is-active")).opacity === "1");
}

function inView(box, height) {
  return box && box.y >= -1 && box.y + box.height <= height + 1;
}

async function cast(page, movie) {
  await page.locator(`#pass-posters [data-pass="${movie}"]`).tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  await painted(page);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  const { context, page, calls } = await guest(viewport);
  await rsvp(page, { party: 4 });
  await painted(page);
  assert.equal(calls.at(-1).fn, "movie_submit_rsvp");
  assert.equal(calls.at(-1).body.p_party_size, 4);
  assert.equal(calls.at(-1).body.p_vote, "inside_out_2026");
  assert.equal("p_vote" in calls.at(-1).body, true);
  assert.equal(await page.locator("#pass").isHidden(), false, `${size} pass hidden for a party of 4`);
  assert.equal((await page.locator("#pass").innerText()).trim(), "Pass the phone");
  assert.equal(await page.locator("#undo").isHidden(), true, `${size} no undo before a handoff`);
  assert.equal(await page.locator("#confirm-sub").innerText(), "");
  const foot = await page.locator("#pass").boundingBox();
  const change = await page.locator("#change").boundingBox();
  assert.ok(inView(foot, viewport.height), `${size} pass button ${JSON.stringify(foot)}`);
  assert.ok(inView(change, viewport.height), `${size} change button ${JSON.stringify(change)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(overflow, false, `${size} horizontal overflow`);
  if (shots && viewport.width === 390) {
    await page.screenshot({ path: `${shots}/pass-confirm-390x844.png` });
    console.log("shot pass-confirm");
  }

  await page.locator("#pass").tap();
  await page.waitForFunction(() => document.body.dataset.step === "pass");
  await painted(page);
  const asked = await page.evaluate(() => ({
    line: document.getElementById("screen-line").textContent,
    sub: document.getElementById("screen-sub").textContent,
    duplicate: document.getElementById("pass-line"),
    inputs: document.querySelectorAll(".step.is-active input").length,
    steppers: document.querySelectorAll(".step.is-active .stepper").length,
  }));
  assert.equal(asked.line, "Your turn!");
  assert.equal(asked.sub, "Tap your movie");
  assert.equal(asked.duplicate, null, `${size} the prompt is only on the screen`);
  assert.equal(asked.inputs, 0, `${size} no name field`);
  assert.equal(asked.steppers, 0, `${size} no stepper`);
  const posters = await page.locator("#pass-posters").boundingBox();
  const left = await page.locator('#pass-posters [data-pass="inside_out_2026"]').boundingBox();
  const right = await page.locator('#pass-posters [data-pass="wild_robot"]').boundingBox();
  assert.ok(inView(posters, viewport.height), `${size} posters ${JSON.stringify(posters)}`);
  assert.ok(inView(left, viewport.height) && inView(right, viewport.height), `${size} both posters in view`);
  if (shots && viewport.width === 390) {
    await page.screenshot({ path: `${shots}/pass-turn-390x844.png` });
    console.log("shot pass-turn");
  }

  const before = calls.filter((call) => call.fn === "movie_pass_vote").length;
  const poster = page.locator('#pass-posters [data-pass="wild_robot"]');
  const firstTap = poster.tap();
  await page.waitForTimeout(40);
  const secondTap = poster.tap();
  await Promise.all([firstTap, secondTap]);
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  await painted(page);
  const casts = calls.filter((call) => call.fn === "movie_pass_vote");
  assert.equal(casts.length - before, 1, `${size} a double tap casts one vote`);
  assert.equal(casts.at(-1).body.p_vote, "wild_robot");
  assert.equal(await page.locator("#confirm-sub").innerText(), "2 of 4 of us voted");
  assert.deepEqual(
    await page.locator(".bucket.is-mine .you").evaluateAll((nodes) => nodes.map((el) => el.textContent)),
    ["3 of us", "1 of us"],
  );

  await page.locator("#pass").tap();
  await page.waitForFunction(() => document.body.dataset.step === "pass");
  await cast(page, "wild_robot");
  assert.equal(await page.locator("#confirm-sub").innerText(), "3 of 4 of us voted");
  const after = await page.evaluate(() => ({
    badges: [...document.querySelectorAll(".bucket.is-mine .you")].map((el) => el.textContent),
    tubs: [...document.querySelectorAll(".bucket b")].map((el) => el.textContent),
    button: document.getElementById("pass").hidden,
    undo: document.getElementById("undo").hidden,
    line: document.getElementById("screen-line").textContent,
  }));
  assert.equal(after.line, "See you Friday");
  assert.deepEqual(after.badges, ["2 of us", "2 of us"]);
  assert.deepEqual(after.tubs, ["2", "2"]);
  assert.equal(Number(after.tubs[0]) + Number(after.tubs[1]), 4, `${size} tubs are not double counted`);
  assert.equal(after.button, false, `${size} one person still hasn't voted`);
  assert.equal(after.undo, false);
  const again = await page.locator("#pass").boundingBox();
  const undo = await page.locator("#undo").boundingBox();
  assert.ok(inView(again, viewport.height), `${size} pass after votes ${JSON.stringify(again)}`);
  assert.ok(inView(undo, viewport.height), `${size} undo ${JSON.stringify(undo)}`);
  if (shots && viewport.width === 390) {
    await page.screenshot({ path: `${shots}/pass-done-390x844.png` });
    console.log("shot pass-done");
  }

  await page.locator("#pass").tap();
  await page.waitForFunction(() => document.body.dataset.step === "pass");
  await cast(page, "inside_out_2026");
  assert.equal(await page.locator("#confirm-sub").innerText(), "All 4 of us voted");
  assert.equal(await page.locator("#pass").isHidden(), true, `${size} button hides when everyone has voted`);
  assert.equal(calls.filter((call) => call.fn === "movie_pass_vote").length, 3);

  await page.locator("#undo").tap();
  await page.waitForFunction(() => document.getElementById("confirm-sub").textContent === "3 of 4 of us voted");
  const undone = calls.filter((call) => call.fn === "movie_pass_vote").at(-1);
  assert.equal(undone.body.p_vote, null, `${size} undo sends no movie`);
  assert.equal(await page.locator("#pass").isHidden(), false, `${size} undo brings the handoff back`);

  await page.locator("#change").tap();
  await page.waitForFunction(() => document.body.dataset.step === "pick");
  await page.locator('#posters .poster[data-movie="inside_out_2026"]').tap();
  await page.locator('[data-also="yes"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  assert.equal(await page.locator("#party-value").innerText(), "4");
  await page.locator("#name-submit").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  const edited = calls.filter((call) => call.fn === "movie_submit_rsvp").at(-1);
  assert.equal(edited.body.p_party_size, 4);
  assert.equal(edited.body.p_vote, "inside_out_2026");
  assert.equal(await page.locator("#confirm-sub").innerText(), "", `${size} Change RSVP clears the extra votes`);
  assert.equal(await page.locator(".bucket.is-mine .you").evaluate((el) => el.textContent), "Your vote");
  assert.equal(await page.locator(".bucket.is-mine").count(), 1);
  console.log("ok pass", size);
  await context.close();
}

{
  const { context, page } = await guest({ width: 390, height: 844 });
  await rsvp(page, { party: 1 });
  assert.equal(await page.locator("#pass").isHidden(), true, "a solo guest never sees pass");
  assert.equal(await page.locator("#undo").isHidden(), true);
  assert.equal(await page.locator("#change").isHidden(), false);
  console.log("ok solo");
  await context.close();
}

{
  const { context, page } = await guest({ width: 375, height: 667 });
  await rsvp(page, { party: 2 });
  await page.locator("#pass").tap();
  await page.waitForFunction(() => document.body.dataset.step === "pass");
  await cast(page, "wild_robot");
  assert.equal(await page.locator("#confirm-sub").innerText(), "All 2 of us voted");
  assert.equal(await page.locator("#pass").isHidden(), true, "a pair is full after one handoff");
  assert.deepEqual(
    await page.locator(".bucket.is-mine .you").evaluateAll((nodes) => nodes.map((el) => el.textContent)),
    ["1 of us", "1 of us"],
  );
  console.log("ok pair");
  await context.close();
}

{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => localStorage.setItem("prothro-movie-night-token", "tok-pass"));
  await context.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    if (fn === "movie_get_rsvp") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          rsvp: {
            name: "Westley",
            party_size: 4,
            would_attend: "both",
            vote: "inside_out_2026",
            extra_votes: ["wild_robot", "wild_robot"],
            note: "",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(standings({ inside_out_2026: 2, wild_robot: 2 }, 4)),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("confirm-sub").textContent.includes("of us voted"));
  assert.equal(await page.locator("#confirm-sub").innerText(), "3 of 4 of us voted");
  assert.equal(await page.locator("#screen-line").innerText(), "See you Friday");
  assert.equal(await page.locator("#pass").isHidden(), false);
  assert.deepEqual(
    await page.locator(".bucket.is-mine .you").evaluateAll((nodes) => nodes.map((el) => el.textContent)),
    ["2 of us", "2 of us"],
  );
  console.log("ok reopen");
  await context.close();
}

{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => sessionStorage.setItem("prothro-movie-admin-pin", "0000"));
  await context.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    if (fn === "movie_admin_overview") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          coming: 4,
          none_parties: 0,
          votes: { inside_out_2026: 2, wild_robot: 2 },
          if_inside_out_2026: 4,
          if_wild_robot: 4,
          rsvps_open: true,
          voting_open: true,
          history: [],
          rsvps: [
            {
              id: "row-1",
              name: "Westley",
              party_size: 4,
              would_attend: "both",
              vote: "inside_out_2026",
              extra_votes: ["wild_robot", "wild_robot"],
              note: "",
              created_at: "2026-10-16T18:00:00Z",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(`${base}admin/`, { waitUntil: "load" });
  await page.waitForSelector(".guest");
  const book = await page.evaluate(() => ({
    tally: document.getElementById("tally").textContent,
    votes: [...document.querySelectorAll(".proj-votes")].map((el) => el.textContent),
    people: [...document.querySelectorAll(".proj-people")].map((el) => el.innerText.replace(/\s+/g, " ")),
    count: document.querySelector(".guest .count").textContent,
    meta: document.querySelector(".guest .meta").textContent,
  }));
  assert.equal(book.tally, "4 people coming");
  assert.deepEqual(book.votes, ["2 people voting", "2 people voting"]);
  assert.deepEqual(book.people, ["4 people", "4 people"]);
  assert.equal(book.count, "4 people");
  assert.equal(book.meta, "Inside Out 2 · Wild Robot 2");
  assert.doesNotMatch(book.tally, /8/);
  if (shots) {
    await page.locator(".guest").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${shots}/pass-admin-390x844.png` });
    console.log("shot pass-admin");
  }
  console.log("ok admin pass");
  await context.close();
}

await browser.close();
console.log("all pass checks passed");
