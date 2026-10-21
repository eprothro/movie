// Past nights: headcount matches the live "coming" number, the sum of
// party_size for people who could come. A would_attend of "none" is left
// out. A party that passed the phone still counts once. Its votes are
// shared, and the winner is whichever side is ahead.
// The booth renders that payload. Nothing calls the live database.
//
//   python3 -m http.server 8765
//   node tools/history.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.RSVP_BASE || "http://127.0.0.1:8765/";
const shots = process.env.RSVP_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

function voteShare(row, movie) {
  if (!row.vote) return 0;
  const extras = Array.isArray(row.extra_votes) ? row.extra_votes : [];
  const unvoted = Math.max(0, row.party_size - 1 - extras.length);
  let n = row.vote === movie ? 1 + unvoted : 0;
  for (const id of extras) if (id === movie) n += 1;
  return n;
}

function archive(event, rows) {
  let ahead = 0;
  let behind = 0;
  let headcount = 0;
  for (const row of rows) {
    if (row.would_attend === "none") continue;
    headcount += row.party_size;
    ahead += voteShare(row, event.movie_a);
    behind += voteShare(row, event.movie_b);
  }
  const winner = ahead > behind ? event.movie_a : behind > ahead ? event.movie_b : null;
  const winner_title =
    winner === event.movie_a ? event.movie_a_title : winner === event.movie_b ? event.movie_b_title : null;
  return {
    event_date: event.event_date,
    showtime: event.showtime || null,
    movie_a: event.movie_a,
    movie_a_title: event.movie_a_title,
    movie_b: event.movie_b,
    movie_b_title: event.movie_b_title,
    winner,
    winner_title,
    headcount,
    votes: { [event.movie_a]: ahead, [event.movie_b]: behind },
  };
}

const oct10 = {
  event_date: "2026-10-10",
  showtime: "2026-10-11T00:14:44.319Z",
  movie_a: "princess_bride",
  movie_a_title: "The Princess Bride",
  movie_b: "top_gun",
  movie_b_title: "Top Gun: Maverick",
};
const oct10Rows = [
  { party_size: 4, would_attend: "both", vote: "princess_bride" },
  { party_size: 1, would_attend: "princess_bride", vote: "princess_bride" },
  { party_size: 2, would_attend: "top_gun", vote: "top_gun" },
  { party_size: 3, would_attend: "both", vote: null },
  { party_size: 6, would_attend: "none", vote: null },
];
const older = {
  event_date: "2026-08-01",
  movie_a: "alpha",
  movie_a_title: "Alpha",
  movie_b: "beta",
  movie_b_title: "Beta",
};
const olderRows = [
  { party_size: 4, would_attend: "alpha", vote: "alpha" },
  { party_size: 4, would_attend: "beta", vote: "beta" },
  { party_size: 1, would_attend: "both", vote: null },
];

const won = archive(oct10, oct10Rows);
const tied = archive(older, olderRows);
assert.equal(won.headcount, 10);
assert.equal(
  oct10Rows.reduce((sum, row) => sum + row.party_size, 0),
  16,
  "the can't-make-it party is in the book",
);
assert.deepEqual(won.votes, { princess_bride: 5, top_gun: 2 });
assert.equal(won.winner, "princess_bride");
assert.equal(won.winner_title, "The Princess Bride");
assert.equal(tied.headcount, 9);
assert.deepEqual(tied.votes, { alpha: 4, beta: 4 });
assert.equal(tied.winner, null);
assert.equal(tied.winner_title, null);
const passedNight = archive(oct10, [
  { party_size: 4, would_attend: "both", vote: "princess_bride", extra_votes: ["top_gun", "top_gun"] },
  { party_size: 6, would_attend: "none", vote: null },
]);
assert.equal(passedNight.headcount, 4, "a passed phone still counts the party once");
assert.deepEqual(passedNight.votes, { princess_bride: 2, top_gun: 2 });
assert.equal(passedNight.votes.princess_bride + passedNight.votes.top_gun, passedNight.headcount);
const uneven = archive(oct10, [
  { party_size: 4, would_attend: "both", vote: "princess_bride", extra_votes: ["top_gun"] },
]);
assert.equal(uneven.headcount, 4);
assert.deepEqual(uneven.votes, { princess_bride: 3, top_gun: 1 });
assert.equal(uneven.winner, "princess_bride");
console.log("ok history tally", won.votes, "tie", tied.votes, "pass", passedNight.votes);

const current = {
  ok: true,
  coming: 0,
  none_parties: 0,
  votes: { inside_out_2026: 0, wild_robot: 0 },
  if_inside_out_2026: 0,
  if_wild_robot: 0,
  rsvps_open: true,
  voting_open: true,
  rsvps: [],
};

async function booth(browser, history) {
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
        body: JSON.stringify({ ...current, history }),
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

const browser = await chromium.launch();

{
  const { context, page } = await booth(browser, [won, tied]);
  await page.waitForSelector(".past-night");
  const cards = await page.locator(".past-night").evaluateAll((nodes) =>
    nodes.map((node) => ({
      date: node.querySelector(".past-date").textContent,
      films: node.querySelector(".past-films").innerText.replace(/\s+/g, " ").trim(),
      winner: node.querySelector(".past-winner b").textContent,
      winnerLine: node.querySelector(".past-winner").innerText.replace(/\s+/g, " ").trim(),
      meta: node.querySelector(".past-meta").innerText.replace(/\s+/g, " ").trim(),
    })),
  );
  assert.equal(cards.length, 2);
  assert.equal(cards[0].date, "Saturday, Oct 10");
  assert.match(cards[0].films, /The Princess Bride/);
  assert.match(cards[0].films, /Top Gun: Maverick/);
  assert.match(cards[0].films, /\bvs\b/);
  assert.equal(cards[0].winner, "The Princess Bride");
  assert.match(cards[0].winnerLine, /^WINNER/);
  assert.match(cards[0].meta, /10 people/);
  assert.match(cards[0].meta, /The Princess Bride 5/);
  assert.match(cards[0].meta, /Top Gun: Maverick 2/);
  assert.equal(cards[1].winner, "Tie");
  assert.doesNotMatch(cards[1].winnerLine, /Winner/);
  assert.match(cards[1].films, /Alpha/);
  assert.match(cards[1].films, /Beta/);
  assert.match(cards[1].meta, /9 people/);
  assert.match(cards[1].meta, /Alpha 4/);
  assert.match(cards[1].meta, /Beta 4/);
  const live = (await page.locator("#projection").innerText()).replace(/\s+/g, " ");
  assert.match(live, /INSIDE OUT/);
  assert.match(live, /WILD ROBOT/);
  assert.doesNotMatch(live, /Princess Bride|Top Gun/);
  assert.equal(await page.locator("#guest-list .empty").innerText(), "No RSVPs yet.");
  console.log("ok past nights", cards[0].date, cards[0].winner, cards[1].winner);
  if (shots) {
    await page.locator("#past-head").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${shots}/admin-past-390x844.png` });
    console.log("shot admin-past-390x844");
  }
  await context.close();
}

{
  const { context, page } = await booth(browser, []);
  assert.equal(await page.locator("#past-head").isHidden(), true);
  assert.equal(await page.locator("#past-nights").isHidden(), true);
  assert.equal(await page.locator(".past-night").count(), 0);
  console.log("ok past nights hidden when empty");
  await context.close();
}

{
  const { context, page } = await booth(browser, undefined);
  assert.equal(await page.locator("#past-head").isHidden(), true);
  console.log("ok past nights hidden without a payload");
  await context.close();
}

await browser.close();
console.log("all history checks passed");
