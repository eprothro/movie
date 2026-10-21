// Headcount standings. The live totals come from movie_private.standings();
// this file checks the same rule, then the guest tubs and the admin booth
// with those totals mocked. Nothing here calls the live database.
//
//   python3 -m http.server 8765
//   node tools/headcount.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.RSVP_BASE || "http://127.0.0.1:8765/";
const shots = process.env.RSVP_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

// Mirrors movie_private.votes_for. The RSVP vote is person one. Each extra
// tap is one more person. Anyone who has not tapped yet still counts toward
// the RSVP vote, so the shares sum to party_size.
function voteShare(row, movie) {
  if (!row.vote) return 0;
  const extras = Array.isArray(row.extra_votes) ? row.extra_votes : [];
  const unvoted = Math.max(0, row.party_size - 1 - extras.length);
  let n = row.vote === movie ? 1 + unvoted : 0;
  for (const id of extras) if (id === movie) n += 1;
  return n;
}

function tally(rows) {
  const votes = { inside_out_2026: 0, wild_robot: 0 };
  let coming = 0;
  let ifPrincess = 0;
  let ifTop = 0;
  let noneParties = 0;
  for (const row of rows) {
    if (row.would_attend === "none") {
      noneParties += 1;
      continue;
    }
    coming += row.party_size;
    if (row.would_attend === "inside_out_2026" || row.would_attend === "both") ifPrincess += row.party_size;
    if (row.would_attend === "wild_robot" || row.would_attend === "both") ifTop += row.party_size;
    votes.inside_out_2026 += voteShare(row, "inside_out_2026");
    votes.wild_robot += voteShare(row, "wild_robot");
  }
  return {
    votes,
    coming,
    if_inside_out_2026: ifPrincess,
    if_wild_robot: ifTop,
    none_parties: noneParties,
    rsvps_open: true,
    voting_open: true,
    ok: true,
  };
}

function forms(rows) {
  return {
    inside_out_2026: rows.filter((row) => row.vote === "inside_out_2026").length,
    wild_robot: rows.filter((row) => row.vote === "wild_robot").length,
  };
}

const mixed = [
  { name: "Westley", party_size: 4, would_attend: "both", vote: "inside_out_2026" },
  { name: "Buttercup", party_size: 1, would_attend: "inside_out_2026", vote: "inside_out_2026" },
  { name: "Fezzik", party_size: 2, would_attend: "both", vote: "wild_robot" },
  { name: "Inigo", party_size: 1, would_attend: "wild_robot", vote: "wild_robot" },
  { name: "Vizzini", party_size: 6, would_attend: "none", vote: null },
];
const tied = [
  { name: "Westley", party_size: 4, would_attend: "both", vote: "inside_out_2026" },
  { name: "Buttercup", party_size: 1, would_attend: "inside_out_2026", vote: "inside_out_2026" },
  { name: "Fezzik", party_size: 3, would_attend: "both", vote: "wild_robot" },
  { name: "Inigo", party_size: 2, would_attend: "wild_robot", vote: "wild_robot" },
  { name: "Vizzini", party_size: 8, would_attend: "none", vote: null },
];

const mixedTotals = tally(mixed);
const tiedTotals = tally(tied);
assert.deepEqual(mixedTotals.votes, { inside_out_2026: 5, wild_robot: 3 });
assert.deepEqual(forms(mixed), { inside_out_2026: 2, wild_robot: 2 }, "form counts would hide the lead");
assert.equal(mixedTotals.coming, 8);
assert.equal(mixedTotals.none_parties, 1, "a can't-make-it party adds no people to a movie");
assert.equal(mixedTotals.if_inside_out_2026, 7);
assert.equal(mixedTotals.if_wild_robot, 7);
assert.deepEqual(tiedTotals.votes, { inside_out_2026: 5, wild_robot: 5 });
assert.notDeepEqual(tiedTotals.votes, forms(tied));
// Party of 4, votes A, B, B. A is the RSVP plus the one person who has not
// tapped yet. B is the two pass-along taps. Still 4 coming, not 8.
const passed = [
  { name: "Westley", party_size: 4, would_attend: "both", vote: "inside_out_2026", extra_votes: ["wild_robot", "wild_robot"] },
  { name: "Vizzini", party_size: 6, would_attend: "none", vote: null },
];
const passedTotals = tally(passed);
assert.equal(passedTotals.coming, 4, "two pass-along votes are still 4 people coming");
assert.deepEqual(passedTotals.votes, { inside_out_2026: 2, wild_robot: 2 });
assert.equal(
  passedTotals.votes.inside_out_2026 + passedTotals.votes.wild_robot,
  passedTotals.coming,
  "vote shares must not add a second copy of the party",
);
assert.equal(passedTotals.if_inside_out_2026, 4);
assert.equal(passedTotals.if_wild_robot, 4);
assert.equal(passedTotals.none_parties, 1);
const echoed = tally([
  { party_size: 4, would_attend: "both", vote: "inside_out_2026", extra_votes: ["inside_out_2026", "wild_robot"] },
]);
assert.deepEqual(echoed.votes, { inside_out_2026: 3, wild_robot: 1 });
assert.equal(echoed.votes.inside_out_2026 + echoed.votes.wild_robot, echoed.coming);
console.log("ok tally", mixedTotals.votes, "tie", tiedTotals.votes, "pass", passedTotals.votes);

function standingsBody(totals, rsvp) {
  const standings = {
    ok: true,
    votes: totals.votes,
    coming: totals.coming,
    rsvps_open: true,
    voting_open: true,
  };
  if (!rsvp) return JSON.stringify(standings);
  return JSON.stringify({ ...standings, token: "tok-test", rsvp, standings });
}

async function guest(browser, totals, now) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await context.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const body = route.request().postDataJSON() || {};
    if (fn === "movie_submit_rsvp") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: standingsBody(totals, {
          name: body.p_name,
          party_size: body.p_party_size,
          would_attend: body.p_would_attend,
          vote: body.p_vote,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: standingsBody(totals),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  const url = new URL(base);
  if (now) url.searchParams.set("now", now);
  await page.goto(url.href, { waitUntil: "load" });
  return { context, page };
}

const browser = await chromium.launch();

{
  const { context, page } = await guest(browser, mixedTotals, "2026-10-30T21:00:00-05:00");
  await page.waitForFunction(() => document.getElementById("screen-line").textContent === "Inside Out");
  assert.match(await page.locator("#screen-kicker").innerText(), /now showing/i);
  console.log("ok leader on the screen");
  await context.close();
}

{
  const { context, page } = await guest(browser, tiedTotals, "2026-10-30T21:00:00-05:00");
  await page.waitForFunction(() => document.getElementById("screen-line").textContent === "Movie Night");
  console.log("ok tie on the screen");
  await context.close();
}

{
  const { context, page } = await guest(browser, mixedTotals);
  await page.waitForFunction(() => document.body.dataset.screen === "card");
  await page.locator('.poster[data-movie="inside_out_2026"]').tap();
  await page.locator('[data-also="yes"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  await page.fill("#name", "Westley");
  await page.locator("#name-submit").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  await page.waitForFunction(() => document.querySelector('.bucket[data-movie="inside_out_2026"] b').textContent === "5");
  const tubs = await page.evaluate(() =>
    [...document.querySelectorAll(".bucket")].map((bucket) => ({
      id: bucket.dataset.movie,
      n: bucket.querySelector("b").textContent,
      mine: bucket.classList.contains("is-mine"),
      corn: bucket.querySelector(".corn").style.transform,
    })),
  );
  assert.deepEqual(
    tubs.map((tub) => tub.n),
    ["5", "3"],
  );
  assert.deepEqual(
    tubs.map((tub) => tub.mine),
    [true, false],
  );
  const shift = (transform) => Number(/translateY\(([-\d.]+)%\)/.exec(transform)[1]);
  assert.equal(shift(tubs[0].corn), 0);
  assert.equal(shift(tubs[1].corn), 26);
  const label = await page.locator("#votes").getAttribute("aria-label");
  assert.match(label, /People so far/);
  assert.match(label, /Inside Out 5/);
  assert.match(label, /The Wild Robot 3/);
  assert.equal(await page.locator(".votes-label").innerText(), "PEOPLE SO FAR");
  await page.evaluate(() => {
    const el = document.getElementById("votes");
    const top = el.getBoundingClientRect().top;
    if (top < 8 || el.getBoundingClientRect().bottom > innerHeight - 8) {
      window.scrollTo(0, window.scrollY + top - 24);
    }
  });
  if (shots) {
    await page.screenshot({ path: `${shots}/standings-guest-390x844.png` });
    console.log("shot standings-guest-390x844");
  }
  console.log("ok guest tubs", tubs.map((tub) => `${tub.n}${tub.mine ? "*" : ""}`).join(" "));
  await context.close();
}

{
  const { context, page } = await guest(browser, tiedTotals);
  await page.waitForFunction(() => document.body.dataset.screen === "card");
  await page.locator('.poster[data-movie="wild_robot"]').tap();
  await page.locator('[data-also="no"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  await page.fill("#name", "Inigo");
  await page.locator("#name-submit").tap();
  await page.waitForFunction(() => document.querySelectorAll(".bucket b")[0].textContent === "5");
  const tubs = await page.evaluate(() =>
    [...document.querySelectorAll(".bucket")].map((bucket) => ({
      n: bucket.querySelector("b").textContent,
      corn: bucket.querySelector(".corn").style.transform,
      mine: bucket.classList.contains("is-mine"),
    })),
  );
  assert.deepEqual(
    tubs.map((tub) => tub.n),
    ["5", "5"],
  );
  assert.equal(tubs[0].corn, tubs[1].corn);
  assert.deepEqual(
    tubs.map((tub) => tub.mine),
    [false, true],
    "conditional pick still marks Your vote",
  );
  console.log("ok guest tie");
  await context.close();
}

async function admin(browser, totals, rows) {
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
        body: JSON.stringify({ ...totals, rsvps: rows }),
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
  await page.waitForFunction(() => document.querySelectorAll(".proj-votes").length === 2);
  return { context, page };
}

{
  const { context, page } = await admin(browser, mixedTotals, mixed);
  const lines = await page.locator(".proj-votes").allInnerTexts();
  assert.deepEqual(lines.map((line) => line.replace(/\s+/g, " ").trim()), [
    "5 people voting · leading",
    "3 people voting",
  ]);
  assert.equal(await page.locator(".proj.is-lead").count(), 1);
  const tallyText = (await page.locator("#tally").innerText()).replace(/\s+/g, " ").trim();
  assert.equal(tallyText, "8 people coming · 1 can't make it");
  if (shots) {
    await page.screenshot({ path: `${shots}/standings-admin-390x844.png` });
    console.log("shot standings-admin-390x844");
  }
  console.log("ok admin", lines.join(" | "));
  await context.close();
}

{
  const { context, page } = await admin(browser, tiedTotals, tied);
  const lines = await page.locator(".proj-votes").allInnerTexts();
  assert.deepEqual(lines.map((line) => line.replace(/\s+/g, " ").trim()), ["5 people voting", "5 people voting"]);
  assert.equal(await page.locator(".proj.is-lead").count(), 0);
  console.log("ok admin tie");
  await context.close();
}

await browser.close();
console.log("all headcount checks passed");
