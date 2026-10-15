// Admin PIN: the fourth digit submits, a wrong one clears and shakes,
// and paste plus the numeric input both work. Nothing calls the live database.
//
//   python3 -m http.server 8765
//   node tools/pin.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.RSVP_BASE || "http://127.0.0.1:8765/";
const shots = process.env.RSVP_SHOTS || "";
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();

async function pinPage(accept) {
  const calls = [];
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
    if (fn === "movie_admin_overview") {
      calls.push(body.p_pin);
      const ok = body.p_pin === accept;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          ok
            ? { ok: true, votes: {}, rsvps: [], history: [], coming: 0, rsvps_open: true, voting_open: true }
            : { ok: false, error: "pin" },
        ),
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
  await page.waitForSelector("#pin-entry");
  return { context, page, calls };
}

async function paste(page, text) {
  await page.locator("#pin-entry").focus();
  await page.evaluate((value) => {
    const el = document.getElementById("pin-entry");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => value } });
    el.dispatchEvent(event);
  }, text);
}

{
  const { context, page, calls } = await pinPage("2468");
  assert.equal(await page.locator("#unlock").count(), 0);
  const field = await page.locator("#pin-entry").evaluate((el) => ({
    type: el.type,
    inputMode: el.inputMode,
    pattern: el.getAttribute("pattern"),
    maxLength: el.maxLength,
  }));
  assert.equal(field.type, "text");
  assert.equal(field.inputMode, "numeric");
  assert.equal(field.pattern, "[0-9]*");
  assert.equal(field.maxLength, 4);
  for (const digit of "246") await page.locator(`[data-digit="${digit}"]`).click();
  await page.waitForTimeout(200);
  assert.deepEqual(calls, [], "three digits must not submit");
  assert.equal(await page.locator("#book").isHidden(), true);
  await page.locator('[data-digit="8"]').click();
  await page.waitForFunction(() => document.getElementById("book").hidden === false);
  assert.deepEqual(calls, ["2468"]);
  console.log("ok pin keypad submits on the 4th digit");
  await context.close();
}

{
  const { context, page, calls } = await pinPage("2468");
  for (const digit of "0000") await page.locator(`[data-digit="${digit}"]`).click();
  await page.waitForFunction(() => document.getElementById("pin-dots").classList.contains("is-wrong"));
  const wrong = await page.evaluate(() => {
    const dots = document.getElementById("pin-dots");
    return {
      value: document.getElementById("pin-entry").value,
      filled: dots.querySelectorAll("i.on").length,
      animation: getComputedStyle(dots).animationName,
      error: document.getElementById("pin-error").textContent,
      bookHidden: document.getElementById("book").hidden,
    };
  });
  assert.equal(wrong.value, "");
  assert.equal(wrong.filled, 0);
  assert.equal(wrong.animation, "shake");
  assert.match(wrong.error, /doesn't match/);
  assert.equal(wrong.bookHidden, true);
  assert.deepEqual(calls, ["0000"]);
  for (const digit of "2468") await page.locator(`[data-digit="${digit}"]`).click();
  await page.waitForFunction(() => document.getElementById("book").hidden === false);
  assert.deepEqual(calls, ["0000", "2468"]);
  console.log("ok pin wrong clears and shakes, then a right one opens");
  await context.close();
}

{
  const { context, page, calls } = await pinPage("2468");
  await paste(page, "24-68");
  await page.waitForFunction(() => document.getElementById("book").hidden === false);
  assert.deepEqual(calls, ["2468"], "paste keeps digits only");
  console.log("ok pin paste");
  await context.close();
}

{
  const { context, page, calls } = await pinPage("2468");
  await paste(page, "24685");
  await page.waitForFunction(() => document.getElementById("book").hidden === false);
  assert.deepEqual(calls, ["2468"], "paste uses the first four digits");
  console.log("ok pin paste truncates");
  await context.close();
}

{
  const { context, page, calls } = await pinPage("1357");
  await page.locator("#pin-entry").focus();
  await page.keyboard.type("1357");
  await page.waitForFunction(() => document.getElementById("book").hidden === false);
  assert.deepEqual(calls, ["1357"], "numeric entry submits once");
  console.log("ok pin numeric input");
  await context.close();
}

{
  const { context, page, calls } = await pinPage("1357");
  await page.locator("#pin-entry").focus();
  await page.keyboard.type("12");
  await page.waitForTimeout(250);
  assert.deepEqual(calls, []);
  assert.equal(await page.locator("#pin-entry").inputValue(), "12");
  console.log("ok pin waits for four");
  await context.close();
}

if (shots) {
  const { context, page } = await pinPage("2468");
  await page.screenshot({ path: `${shots}/admin-pin-390x844.png` });
  console.log("shot admin-pin-390x844");
  await context.close();
}

await browser.close();
console.log("all pin checks passed");
