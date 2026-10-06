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

// Mirrors supabase/migrations/003_vote_headcount.sql.
function tally(rows) {
  const votes = { princess_bride: 0, top_gun: 0 };
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
    if (row.would_attend === "princess_bride" || row.would_attend === "both") ifPrincess += row.party_size;
    if (row.would_attend === "top_gun" || row.would_attend === "both") ifTop += row.party_size;
    if (row.vote === "princess_bride" || row.vote === "top_gun") votes[row.vote] += row.party_size;
  }
  return {
    votes,
    coming,
    if_princess_bride: ifPrincess,
    if_top_gun: ifTop,
    none_parties: noneParties,
    rsvps_open: true,
    voting_open: true,
    ok: true,
  };
}

function forms(rows) {
  return {
    princess_bride: rows.filter((row) => row.vote === "princess_bride").length,
    top_gun: rows.filter((row) => row.vote === "top_gun").length,
  };
}

const mixed = [
  { name: "Westley", party_size: 4, would_attend: "both", vote: "princess_bride" },
  { name: "Buttercup", party_size: 1, would_attend: "princess_bride", vote: "princess_bride" },
  { name: "Fezzik", party_size: 2, would_attend: "both", vote: "top_gun" },
  { name: "Inigo", party_size: 1, would_attend: "top_gun", vote: "top_gun" },
  { name: "Vizzini", party_size: 6, would_attend: "none", vote: null },
];
const tied = [
  { name: "Westley", party_size: 4, would_attend: "both", vote: "princess_bride" },
  { name: "Buttercup", party_size: 1, would_attend: "princess_bride", vote: "princess_bride" },
  { name: "Fezzik", party_size: 3, would_attend: "both", vote: "top_gun" },
  { name: "Inigo", party_size: 2, would_attend: "top_gun", vote: "top_gun" },
  { name: "Vizzini", party_size: 8, would_attend: "none", vote: null },
];

const mixedTotals = tally(mixed);
const tiedTotals = tally(tied);
assert.deepEqual(mixedTotals.votes, { princess_bride: 5, top_gun: 3 });
assert.deepEqual(forms(mixed), { princess_bride: 2, top_gun: 2 }, "form counts would hide the lead");
assert.equal(mixedTotals.coming, 8);
assert.equal(mixedTotals.none_parties, 1, "a can't-make-it party adds no people to a movie");
assert.equal(mixedTotals.if_princess_bride, 7);
assert.equal(mixedTotals.if_top_gun, 7);
assert.deepEqual(tiedTotals.votes, { princess_bride: 5, top_gun: 5 });
assert.notDeepEqual(tiedTotals.votes, forms(tied));
console.log("ok tally", mixedTotals.votes, "tie", tiedTotals.votes);

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
  const { context, page } = await guest(browser, mixedTotals, "2026-10-10T21:00:00-05:00");
  await page.waitForFunction(() => document.getElementById("screen-line").textContent === "The Princess Bride");
  assert.match(await page.locator("#screen-kicker").innerText(), /now showing/i);
  console.log("ok leader on the screen");
  await context.close();
}

{
  const { context, page } = await guest(browser, tiedTotals, "2026-10-10T21:00:00-05:00");
  await page.waitForFunction(() => document.getElementById("screen-line").textContent === "Movie Night");
  console.log("ok tie on the screen");
  await context.close();
}

{
  const { context, page } = await guest(browser, mixedTotals);
  await page.waitForFunction(() => document.body.dataset.screen === "card");
  await page.locator('.poster[data-movie="princess_bride"]').tap();
  await page.locator('[data-also="yes"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  await page.fill("#name", "Westley");
  await page.locator("#name-submit").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  await page.waitForFunction(() => document.querySelector('.bucket[data-movie="princess_bride"] b').textContent === "5");
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
  assert.match(label, /The Princess Bride 5/);
  assert.match(label, /Top Gun: Maverick 3/);
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
  await page.locator('.poster[data-movie="top_gun"]').tap();
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
