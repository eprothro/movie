// Double-tap the backyard projector to open the booth. One tap stays put.
// The illustration opts out of the iOS double-tap zoom and text selection.
//
//   python3 -m http.server 8765
//   node tools/projector.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.RSVP_BASE || "http://127.0.0.1:8765/";
const browser = await chromium.launch();

async function guest() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.route("**/rest/v1/rpc/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, rsvp: null, votes: {}, rsvps_open: true, voting_open: true }),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const el = document.getElementById("projector");
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 8 && box.height > 8 && style.visibility !== "hidden" && Number(style.opacity) > 0.5;
  });
  return { context, page };
}

function pathOf(page) {
  return new URL(page.url()).pathname;
}

{
  const { context, page } = await guest();
  const hit = await page.evaluate(() => {
    const el = document.getElementById("projector");
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const style = getComputedStyle(el);
    // Chromium folds the WebKit aliases into the unprefixed properties and
    // leaves the prefixed computed value empty. The declaration still has to
    // be on a rule that matches the illustration.
    const declared = (prop) => {
      const computed = style.getPropertyValue(prop);
      if (computed) return computed;
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (!rule.selectorText || !el.matches(rule.selectorText)) continue;
          const value = rule.style.getPropertyValue(prop);
          if (value) return value;
        }
      }
      return computed;
    };
    return {
      inside: Boolean(top) && (top === el || el.contains(top)),
      touchAction: style.touchAction,
      userSelect: style.userSelect,
      webkitUserSelect: declared("-webkit-user-select"),
      scale: window.visualViewport ? window.visualViewport.scale : 1,
    };
  });
  assert.equal(hit.inside, true, "projector is the tap target");
  assert.equal(hit.touchAction, "manipulation");
  assert.equal(hit.userSelect, "none");
  assert.equal(hit.webkitUserSelect, "none");
  assert.equal(hit.scale, 1);
  // Playwright's WebKit drops -webkit-touch-callout (iOS Safari only). The
  // declaration still has to ship so a long-press doesn't raise the callout.
  const css = await page.evaluate(async () => (await fetch("css/site.css")).text());
  assert.match(css, /\.projector\s*\{[^}]*-webkit-touch-callout:\s*none/);
  assert.match(css, /\.projector\s*,\s*\.projector \*\s*\{[^}]*-webkit-touch-callout:\s*none/);

  await page.locator("#projector").click();
  await page.waitForTimeout(450);
  assert.equal(pathOf(page), "/", "a single tap stays on the invite");

  await page.locator("#projector").click();
  await page.waitForTimeout(500);
  await page.locator("#projector").click();
  await page.waitForTimeout(250);
  assert.equal(pathOf(page), "/", "two slow taps are not a double-tap");
  assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
  console.log("ok projector single tap");
  await context.close();
}

{
  const { context, page } = await guest();
  await page.locator("#projector").dblclick();
  await page.waitForURL(/\/admin\/?$/);
  assert.equal(await page.evaluate(() => window.visualViewport.scale), 1, "double-tap did not zoom");
  assert.match(await page.locator("h1").innerText(), /Movie/);
  console.log("ok projector double-tap");
  await context.close();
}

{
  const { context, page } = await guest();
  const box = await page.locator("#projector").boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
  await page.waitForURL(/\/admin\/?$/, { timeout: 3000 });
  console.log("ok projector touch double-tap");
  await context.close();
}

await browser.close();
console.log("all projector checks passed");
