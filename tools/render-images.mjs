// Renders og.png, apple-touch-icon.png and favicon-32.png from the live page.
// Needs a local server on :8765 (python3 -m http.server 8765) and playwright-core
// with a Chrome binary: CHROME=/path/to/chrome node tools/render-images.mjs
import { chromium } from "playwright-core";

const base = process.env.BASE || "http://127.0.0.1:8765";
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/local/bin/google-chrome" });

const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.route("**/rest/v1/rpc/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
await og.goto(`${base}/`);
await og.addStyleTag({
  content: `
    :root { --s: 4.3px; }
    .flies-near { display: none !important; }
    .page { visibility: hidden !important; }
    .rig, .sway, .face, .halo i, .spill i { animation: none !important; transition: none !important; }
    .leader { opacity: 0 !important; }
    .card { opacity: 1 !important; transform: none !important; transition: none !important; }
    .shoot { display: none; }
    .ff { animation-play-state: paused !important; }
  `,
});
await og.evaluate(() => window.dispatchEvent(new Event("resize")));
await og.waitForTimeout(500);
// Walk partway in so the lit screen fills the frame under the stars.
await og.evaluate(() => {
  const top = document.getElementById("rsvp").getBoundingClientRect().top + scrollY;
  window.scrollTo(0, top * 0.5);
});
await og.waitForTimeout(1500);
await og.evaluate(() => {
  document.body.dataset.screen = "card";
  document.body.classList.add("lit");
  document.getElementById("screen-kicker").textContent = "Prothro";
  const line = document.getElementById("screen-line");
  line.textContent = "Movie Night";
  line.classList.remove("is-long");
  document.getElementById("screen-sub").textContent = "Saturday, Oct 10 · After sunset";
  document.getElementById("beam").style.opacity = "0.3";
});
await og.waitForTimeout(400);
await og.screenshot({ path: "og.png" });

for (const [size, file] of [[180, "apple-touch-icon.png"], [32, "favicon-32.png"]]) {
  const icon = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await icon.setContent(
    `<style>html,body{margin:0;background:#050a1d}img{display:block;width:${size}px;height:${size}px}</style><img src="${base}/favicon.svg">`,
  );
  await icon.waitForTimeout(300);
  if (size === 180) {
    // iOS rounds the corners itself; fill the square.
    await icon.addStyleTag({ content: "img{transform:scale(1.13)}" });
  }
  await icon.screenshot({ path: file });
}

await browser.close();
console.log("wrote og.png, apple-touch-icon.png, favicon-32.png");
