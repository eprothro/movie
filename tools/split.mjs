// Split our vote: parties of 2+ only, capped at party size minus 1,
// editable, and a 2/2 split is still one party of 4. Nothing calls the live database.
//
//   python3 -m http.server 8765
//   node tools/split.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.RSVP_BASE || "http://127.0.0.1:8765/";
const shots = process.env.RSVP_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();

function standings(votes, coming) {
  return {
    ok: true,
    votes,
    coming,
    rsvps_open: true,
    voting_open: true,
  };
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
        vote_b: null,
        vote_b_count: null,
        note: body.p_note || "",
      };
      const votes = { inside_out_2026: 0, wild_robot: 0 };
      if (saved.vote) votes[saved.vote] = saved.would_attend === "none" ? 0 : saved.party_size;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          token: "tok-split",
          rsvp: saved,
          standings: standings(votes, saved.would_attend === "none" ? 0 : saved.party_size),
        }),
      });
      return;
    }
    if (fn === "movie_split_vote") {
      calls.push({ fn, body });
      const count = body.p_count;
      if (!saved) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "not_found" }),
        });
        return;
      }
      if (count == null || count === 0) {
        saved = { ...saved, vote_b: null, vote_b_count: null };
      } else {
        saved = {
          ...saved,
          vote_b: saved.vote === "inside_out_2026" ? "wild_robot" : "inside_out_2026",
          vote_b_count: count,
        };
      }
      const votes = { inside_out_2026: 0, wild_robot: 0 };
      const extra = Number(saved.vote_b_count) || 0;
      votes[saved.vote] = saved.party_size - extra;
      if (saved.vote_b) votes[saved.vote_b] = extra;
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
  await page.locator(`.poster[data-movie="${movie}"]`).tap();
  await page.locator(`[data-also="${also}"]`).tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  const active = await page.locator(".step.is-active").innerText();
  assert.doesNotMatch(active, /Split our vote/, "first-time flow stays free of the split");
  for (let i = 1; i < party; i += 1) await page.locator("#party-inc").tap();
  await page.fill("#name", "Westley");
  await page.locator("#name-submit").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
}

function inView(box, height) {
  return box && box.y >= -1 && box.y + box.height <= height + 1;
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  const { context, page, calls } = await guest(viewport);
  await rsvp(page, { party: 4 });
  assert.equal(calls.at(-1).fn, "movie_submit_rsvp");
  assert.equal(calls.at(-1).body.p_party_size, 4);
  assert.equal(calls.at(-1).body.p_vote, "inside_out_2026");
  assert.equal("p_count" in calls.at(-1).body, false);
  assert.equal(await page.locator("#split").isHidden(), false, `${size} split hidden for a party of 4`);
  assert.equal((await page.locator("#split").innerText()).trim(), "Split our vote");
  assert.equal((await page.locator("#change").innerText()).trim(), "Change RSVP");
  const foot = await page.locator("#split").boundingBox();
  const change = await page.locator("#change").boundingBox();
  assert.ok(inView(foot, viewport.height), `${size} split button ${JSON.stringify(foot)}`);
  assert.ok(inView(change, viewport.height), `${size} change button ${JSON.stringify(change)}`);
  if (shots && viewport.width === 390) {
    await page.screenshot({ path: `${shots}/split-confirm-390x844.png` });
    console.log("shot split-confirm");
  }

  await page.locator("#split").tap();
  await page.waitForFunction(() => document.body.dataset.step === "split");
  const asked = await page.evaluate(() => ({
    line: document.getElementById("screen-line").textContent,
    sub: document.getElementById("screen-sub").textContent,
    rest: document.getElementById("split-rest").textContent,
    value: document.getElementById("split-value").textContent,
    label: document.getElementById("split-label").textContent,
    focused: document.activeElement?.tagName,
    clear: document.getElementById("split-clear").hidden,
  }));
  assert.equal(asked.line, "The Wild Robot");
  assert.equal(asked.sub, "How many of us?");
  assert.equal(asked.rest, "The rest of us are for Inside Out.");
  assert.equal(asked.label, "For The Wild Robot");
  assert.equal(asked.value, "2", `${size} opens on half the party`);
  assert.equal(asked.clear, true, `${size} unsplit control before a split`);
  assert.notEqual(asked.focused, "INPUT");
  assert.equal(await page.locator("#split-inc").isDisabled(), false);
  await page.locator("#split-inc").tap();
  assert.equal(await page.locator("#split-value").innerText(), "3");
  assert.equal(await page.locator("#split-inc").isDisabled(), true, `${size} cap at party size minus 1`);
  assert.equal(await page.locator("#split-value").innerText(), "3", `${size} stepper stops at the cap`);
  await page.locator("#split-dec").tap();
  await page.locator("#split-dec").tap();
  assert.equal(await page.locator("#split-value").innerText(), "1");
  assert.equal(await page.locator("#split-dec").isDisabled(), true, `${size} at least one of us`);
  await page.locator("#split-inc").tap();
  assert.equal(await page.locator("#split-value").innerText(), "2");
  const stepBox = await page.locator("#split-submit").boundingBox();
  const dial = await page.locator(".step.is-active .stepper").boundingBox();
  assert.ok(inView(stepBox, viewport.height), `${size} split submit ${JSON.stringify(stepBox)}`);
  assert.ok(inView(dial, viewport.height), `${size} stepper ${JSON.stringify(dial)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(overflow, false, `${size} horizontal overflow`);
  if (shots && viewport.width === 390) {
    await page.screenshot({ path: `${shots}/split-flow-390x844.png` });
    console.log("shot split-flow");
  }

  await page.locator("#split-submit").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  const splitCall = calls.filter((call) => call.fn === "movie_split_vote").at(-1);
  assert.equal(splitCall.body.p_token, "tok-split");
  assert.equal(splitCall.body.p_count, 2);
  const after = await page.evaluate(() => ({
    sub: document.getElementById("confirm-sub").textContent,
    line: document.getElementById("screen-line").textContent,
    badges: [...document.querySelectorAll(".bucket.is-mine .you")].map((el) => el.textContent),
    tubs: [...document.querySelectorAll(".bucket b")].map((el) => el.textContent),
    button: document.getElementById("split").hidden,
  }));
  assert.equal(after.line, "See you Friday");
  assert.equal(after.sub, "2 for Inside Out, 2 for The Wild Robot");
  assert.deepEqual(after.badges, ["2 of us", "2 of us"]);
  assert.deepEqual(after.tubs, ["2", "2"]);
  assert.equal(Number(after.tubs[0]) + Number(after.tubs[1]), 4, `${size} tubs are not double counted`);
  assert.equal(after.button, false);
  // The step fades in after a short delay. Wait until it is actually painted.
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".step.is-active")).opacity === "1");
  const shown = await page.locator("#confirm-sub").boundingBox();
  const actions = await page.locator("#split").boundingBox();
  assert.ok(inView(shown, viewport.height), `${size} post-split sentence ${JSON.stringify(shown)}`);
  assert.ok(inView(actions, viewport.height), `${size} post-split actions ${JSON.stringify(actions)}`);
  if (shots && viewport.width === 390) {
    await page.screenshot({ path: `${shots}/split-done-390x844.png` });
    console.log("shot split-done");
  }

  await page.locator("#split").tap();
  await page.waitForFunction(() => document.body.dataset.step === "split");
  assert.equal(await page.locator("#split-value").innerText(), "2", `${size} reopens on the saved split`);
  assert.equal(await page.locator("#split-clear").isHidden(), false);
  await page.locator("#split-clear").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  const cleared = calls.filter((call) => call.fn === "movie_split_vote").at(-1);
  assert.equal(cleared.body.p_count, null);
  assert.equal(await page.locator("#confirm-sub").innerText(), "");
  assert.equal(await page.locator(".bucket.is-mine .you").evaluate((el) => el.textContent), "Your vote");
  assert.equal(await page.locator(".bucket.is-mine").count(), 1);

  await page.locator("#split").tap();
  await page.waitForFunction(() => document.body.dataset.step === "split");
  await page.locator("#split-submit").tap();
  await page.waitForFunction(() => document.getElementById("confirm-sub").textContent.includes("Wild Robot"));
  await page.locator("#change").tap();
  await page.waitForFunction(() => document.body.dataset.step === "pick");
  await page.locator('.poster[data-movie="inside_out_2026"]').tap();
  await page.locator('[data-also="yes"]').tap();
  await page.waitForFunction(() => document.body.dataset.step === "name");
  assert.equal(await page.locator("#party-value").innerText(), "4");
  await page.locator("#name-submit").tap();
  await page.waitForFunction(() => document.body.dataset.step === "confirm");
  const edited = calls.filter((call) => call.fn === "movie_submit_rsvp").at(-1);
  assert.equal(edited.body.p_party_size, 4);
  assert.equal(edited.body.p_vote, "inside_out_2026");
  assert.equal(await page.locator("#confirm-sub").innerText(), "", `${size} Change RSVP clears the split`);
  assert.equal(await page.locator(".bucket.is-mine").count(), 1);
  console.log("ok split", size);
  await context.close();
}

{
  const { context, page } = await guest({ width: 390, height: 844 });
  await rsvp(page, { party: 1 });
  assert.equal(await page.locator("#split").isHidden(), true, "a solo guest never sees split");
  assert.equal(await page.locator("#change").isHidden(), false);
  console.log("ok solo");
  await context.close();
}

{
  const { context, page } = await guest({ width: 375, height: 667 });
  await rsvp(page, { party: 2 });
  await page.locator("#split").tap();
  await page.waitForFunction(() => document.body.dataset.step === "split");
  assert.equal(await page.locator("#split-value").innerText(), "1");
  assert.equal(await page.locator("#split-dec").isDisabled(), true);
  assert.equal(await page.locator("#split-inc").isDisabled(), true, "a pair can only split 1 and 1");
  const submit = await page.locator("#split-submit").boundingBox();
  assert.ok(inView(submit, 667), `pair submit ${JSON.stringify(submit)}`);
  await page.locator("#split-submit").tap();
  await page.waitForFunction(() => document.getElementById("confirm-sub").textContent === "1 for Inside Out, 1 for The Wild Robot");
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
  await context.addInitScript(() => localStorage.setItem("prothro-movie-night-token", "tok-split"));
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
            vote_b: "wild_robot",
            vote_b_count: 2,
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
  await page.waitForFunction(() => document.getElementById("confirm-sub").textContent.includes("Wild Robot"));
  assert.equal(await page.locator("#confirm-sub").innerText(), "2 for Inside Out, 2 for The Wild Robot");
  assert.equal(await page.locator("#screen-line").innerText(), "See you Friday");
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
              vote_b: "wild_robot",
              vote_b_count: 2,
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
  assert.equal(book.count, "2 + 2");
  assert.equal(book.meta, "2 for Inside Out · 2 for The Wild Robot");
  assert.doesNotMatch(book.tally, /8/);
  if (shots) {
    await page.locator(".guest").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${shots}/split-admin-390x844.png` });
    console.log("shot split-admin");
  }
  console.log("ok admin split");
  await context.close();
}

await browser.close();
console.log("all split checks passed");
