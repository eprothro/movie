// Regenerates the procedural silhouettes in assets/scene/.
// Run from the repo root: node tools/scene-gen.mjs
// One viewBox unit is 0.1 of the scene unit (--s) used in css/site.css.
import { writeFileSync, mkdirSync } from "node:fs";

let seed = 20261010;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const r = (a, b) => a + rand() * (b - a);
const f = (n) => Math.round(n * 10) / 10;
const out = "assets/scene";
mkdirSync(out, { recursive: true });

const svg = (w, h, body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ${extra}>${body}</svg>\n`;

// Stars: square tile, cropped with object-fit: cover.
{
  const W = 1000;
  const H = 1000;
  let dots = "";
  for (let i = 0; i < 300; i += 1) {
    const x = r(0, W);
    // Denser toward the top, thinning toward the horizon.
    const y = Math.pow(rand(), 1.35) * H;
    const big = rand() < 0.07;
    const rad = big ? r(1.5, 2.3) : r(0.5, 1.25);
    const op = big ? r(0.8, 1) : r(0.25, 0.75) * (1 - (y / H) * 0.55);
    const warm = rand() < 0.16;
    dots += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="${warm ? "#ffe6b8" : "#f4f6ff"}" opacity="${f(op * 100) / 100}"/>`;
  }
  // A faint band of dust behind the stars.
  const band =
    `<defs><radialGradient id="mw" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9aa8ff" stop-opacity="0.11"/><stop offset="1" stop-color="#9aa8ff" stop-opacity="0"/></radialGradient></defs>` +
    `<g transform="rotate(-28 500 420)"><ellipse cx="500" cy="420" rx="760" ry="120" fill="url(#mw)"/><ellipse cx="420" cy="410" rx="380" ry="60" fill="url(#mw)"/></g>`;
  let dust = "";
  for (let i = 0; i < 220; i += 1) {
    const t = r(-1, 1);
    const x = 500 + t * 700;
    const y = 420 - t * 700 * Math.tan((28 * Math.PI) / 180) + r(-70, 70) * (1 - Math.abs(t) * 0.4);
    if (x < 0 || x > W || y < 0 || y > H) continue;
    dust += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r(0.35, 0.8))}" fill="#dfe4ff" opacity="${f(r(0.15, 0.45) * 100) / 100}"/>`;
  }
  writeFileSync(`${out}/stars.svg`, svg(W, H, band + dust + dots, 'preserveAspectRatio="xMidYMid slice"'));
}

// Distant tree line: East Texas pines and hardwoods.
function treeline() {
  const W = 4800;
  const H = 400;
  const base = 360;
  let shapes = "";
  let x = -40;
  // A low ridge of canopy so gaps never show sky.
  let ridge = `M0 ${H} L0 ${base - 40}`;
  for (let i = 0; i <= 48; i += 1) {
    const px = (i / 48) * W;
    ridge += ` Q ${f(px - 50)} ${f(base - 70 - r(0, 40))} ${f(px)} ${f(base - 40 - r(0, 30))}`;
  }
  ridge += ` L${W} ${H} Z`;
  shapes += `<path d="${ridge}"/>`;
  while (x < W + 40) {
    const edge = Math.abs(x - W / 2) / (W / 2);
    const tall = 0.75 + edge * 0.5;
    if (rand() < 0.55) {
      // Loblolly pine: tall bare trunk, tufted crown.
      const h = r(170, 300) * tall;
      const cx = x;
      const top = base - h;
      shapes += `<rect x="${f(cx - 3)}" y="${f(top + 30)}" width="6" height="${f(h)}"/>`;
      const tufts = 3 + Math.floor(r(0, 3));
      for (let k = 0; k < tufts; k += 1) {
        const ty = top + k * r(18, 28);
        const tw = r(26, 46) * (1 - k * 0.08);
        const off = r(-14, 14);
        shapes += `<ellipse cx="${f(cx + off)}" cy="${f(ty + 16)}" rx="${f(tw)}" ry="${f(r(14, 22))}"/>`;
      }
      x += r(34, 70);
    } else {
      // Rounded hardwood.
      const h = r(110, 190) * tall;
      const w = r(70, 120);
      const top = base - h;
      shapes += `<rect x="${f(x - 4)}" y="${f(top + h * 0.5)}" width="8" height="${f(h * 0.5)}"/>`;
      const lobes = 5 + Math.floor(r(0, 4));
      for (let k = 0; k < lobes; k += 1) {
        const lx = x + r(-w / 2, w / 2);
        const ly = top + r(10, h * 0.55);
        shapes += `<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(r(22, 40))}"/>`;
      }
      x += r(50, 90);
    }
  }
  return svg(W, H, `<g fill="#0c1326">${shapes}</g>`, 'preserveAspectRatio="xMidYMax slice"');
}
writeFileSync(`${out}/treeline.svg`, treeline());

function rolling(W, H, crest, amp, waves, fill, extra = "") {
  let d = `M0 ${H} L0 ${f(crest(0))}`;
  const n = 60;
  for (let i = 1; i <= n; i += 1) {
    const px = (i / n) * W;
    d += ` L${f(px)} ${f(crest(px))}`;
  }
  d += ` L${W} ${H} Z`;
  return `<path fill="${fill}" d="${d}"/>${extra}`;
}

// Back pasture with a windmill on the rise.
{
  const W = 4800;
  const H = 300;
  const crest = (x) => 70 + Math.sin(x / 520 + 1.2) * 22 + Math.sin(x / 190) * 6;
  const mx = 2400 - 380;
  const my = crest(mx) + 6;
  const mill =
    `<g fill="none" stroke="#0a1120" stroke-width="5" stroke-linecap="round">` +
    `<path d="M${mx - 26} ${my} L${mx - 6} ${my - 230} M${mx + 26} ${my} L${mx + 6} ${my - 230} M${mx - 20} ${my - 60} L${mx + 20} ${my - 60} M${mx - 14} ${my - 130} L${mx + 14} ${my - 130} M${mx - 20} ${my - 60} L${mx + 14} ${my - 130} M${mx + 20} ${my - 60} L${mx - 14} ${my - 130}"/></g>` +
    `<g fill="#0a1120" transform="translate(${mx} ${my - 236})">` +
    Array.from({ length: 12 }, (_, i) => `<path transform="rotate(${i * 30})" d="M-3 -4 L-7 -44 L7 -44 L3 -4 Z"/>`).join("") +
    `<circle r="8"/><path d="M4 -4 L58 -10 L58 8 L4 4 Z"/></g>`;
  writeFileSync(`${out}/hills-back.svg`, svg(W, H, rolling(W, H, crest, 0, 0, "#0a111d") + mill, 'preserveAspectRatio="xMidYMin slice"'));
}

// Near pasture.
{
  const W = 4800;
  const H = 700;
  const crest = (x) => 60 + Math.sin(x / 700 + 0.4) * 34 + Math.sin(x / 260 + 2) * 10;
  let tufts = "";
  for (let i = 0; i < 260; i += 1) {
    const x = r(0, W);
    const y = crest(x) + r(2, 10);
    const h = r(8, 20);
    tufts += `<path d="M${f(x)} ${f(y)} l${f(r(-4, 4))} ${f(-h)} l3 ${f(h)} l${f(r(2, 6))} ${f(-h * 0.8)} l2 ${f(h * 0.8)}Z"/>`;
  }
  writeFileSync(
    `${out}/hills-front.svg`,
    svg(W, H, rolling(W, H, crest, 0, 0, "#070b10") + `<g fill="#070b10">${tufts}</g>`, 'preserveAspectRatio="xMidYMin slice"'),
  );
}

// Fence line with an open gate in the middle. Drawn at its starting size.
{
  const W = 4800;
  const H = 180;
  const mid = W / 2;
  const gap = 230;
  const sag = (x) => 150 + Math.pow((x - mid) / mid, 2) * 22;
  let posts = "";
  let rails = "";
  const step = 150;
  const xs = [];
  for (let x = mid - gap; x > -step; x -= step) xs.unshift(x);
  for (let x = mid + gap; x < W + step; x += step) xs.push(x);
  xs.forEach((x) => {
    const b = sag(x);
    posts += `<rect x="${f(x - 7)}" y="${f(b - 108)}" width="14" height="112" rx="3"/>`;
  });
  const railPath = (dy, from, to) => {
    let d = `M${from} ${f(sag(from) - dy)}`;
    for (let x = from; x <= to; x += 60) d += ` L${f(x)} ${f(sag(x) - dy)}`;
    return d + ` L${to} ${f(sag(to) - dy)}`;
  };
  [28, 62, 96].forEach((dy) => {
    rails += `<path d="${railPath(dy, -20, mid - gap)}"/><path d="${railPath(dy, mid + gap, W + 20)}"/>`;
  });
  // The gate swung open toward us on its left hinge.
  const gx = mid - gap;
  const gb = sag(gx);
  const gate =
    `<g fill="none" stroke="#141b24" stroke-width="9" stroke-linecap="round">` +
    `<path d="M${gx} ${gb - 100} L${gx + 120} ${gb - 92} L${gx + 120} ${gb + 22} L${gx} ${gb}"/>` +
    `<path d="M${gx} ${gb - 66} L${gx + 120} ${gb - 50} M${gx} ${gb - 32} L${gx + 120} ${gb - 12} M${gx} ${gb - 100} L${gx + 120} ${gb + 22}"/></g>`;
  const body =
    `<g fill="#121922">${posts}</g>` +
    `<g fill="none" stroke="#121922" stroke-width="7" stroke-linecap="round">${rails}</g>` +
    `<g fill="none" stroke="#2a3549" stroke-width="2" opacity="0.7">${rails}</g>` +
    gate;
  writeFileSync(`${out}/fence.svg`, svg(W, H, body, 'preserveAspectRatio="xMidYMax slice"'));
}

// Tall grass right in front of the camera.
{
  const W = 4800;
  const H = 320;
  let blades = "";
  for (let i = 0; i < 520; i += 1) {
    const x = r(0, W);
    const center = Math.abs(x - W / 2) / (W / 2);
    const h = r(60, 220) * (0.55 + center * 0.7);
    const lean = r(-40, 40);
    const w = r(5, 12);
    blades += `<path d="M${f(x - w)} ${H} Q ${f(x + lean * 0.3)} ${f(H - h * 0.6)} ${f(x + lean)} ${f(H - h)} Q ${f(x + lean * 0.2 + w * 0.4)} ${f(H - h * 0.55)} ${f(x + w)} ${H} Z"/>`;
  }
  writeFileSync(`${out}/grass.svg`, svg(W, H, `<rect y="${H - 40}" width="${W}" height="40" fill="#030507"/><g fill="#030507">${blades}</g>`, 'preserveAspectRatio="xMidYMax slice"'));
}

// A big post oak at the right edge.
{
  const W = 800;
  const H = 1230;
  let lobes = "";
  const blobs = [
    [300, 260, 190], [480, 200, 200], [640, 300, 170], [200, 420, 150], [420, 400, 200],
    [600, 470, 160], [300, 560, 120], [720, 160, 130], [120, 300, 110], [520, 600, 100],
  ];
  blobs.forEach(([cx, cy, rad]) => {
    for (let k = 0; k < 9; k += 1) {
      const a = r(0, Math.PI * 2);
      const d = r(0, rad * 0.75);
      lobes += `<circle cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d)}" r="${f(r(rad * 0.35, rad * 0.6))}"/>`;
    }
  });
  const trunk =
    `<path d="M420 1230 C 430 1000, 440 860, 470 700 C 430 640, 360 600, 260 560 L 270 540 C 370 570, 440 600, 480 640 C 500 560, 540 500, 620 440 L 634 456 C 570 520, 540 600, 524 700 C 510 860, 520 1000, 540 1230 Z"/>`;
  writeFileSync(`${out}/oak.svg`, svg(W, H, `<g fill="#05080d">${trunk}${lobes}</g>`));
}

// Foreground meadow at the RSVP stage: a back row whose tips catch the screen
// light, and a darker front row that frames the edges.
{
  const W = 4800;
  const H = 400;
  const blade = (x, h, lean, w) =>
    `<path d="M${f(x - w)} ${H} Q ${f(x + lean * 0.3)} ${f(H - h * 0.6)} ${f(x + lean)} ${f(H - h)} Q ${f(x + lean * 0.2 + w * 0.4)} ${f(H - h * 0.55)} ${f(x + w)} ${H} Z"/>`;
  let back = "";
  let front = "";
  for (let i = 0; i < 700; i += 1) {
    const x = r(0, W);
    const edge = Math.abs(x - W / 2) / (W / 2);
    back += blade(x, r(70, 190) * (0.7 + edge * 0.5), r(-30, 30), r(4, 9));
  }
  for (let i = 0; i < 260; i += 1) {
    const x = r(0, W);
    const edge = Math.abs(x - W / 2) / (W / 2);
    front += blade(x, r(40, 120) + Math.pow(edge, 2) * r(120, 260), r(-50, 50), r(6, 13));
  }
  const defs =
    `<defs><linearGradient id="tip" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0.35" stop-color="#5b4a2e"/><stop offset="0.6" stop-color="#1d1a14"/><stop offset="1" stop-color="#07090b"/>` +
    `</linearGradient></defs>`;
  const body =
    defs +
    `<g fill="url(#tip)" opacity="0.9">${back}</g>` +
    `<rect y="${H - 30}" width="${W}" height="30" fill="#040608"/>` +
    `<g fill="#040608">${front}</g>`;
  writeFileSync(`${out}/meadow.svg`, svg(W, H, body, 'preserveAspectRatio="xMidYMax slice"'));
}

console.log("scene art written to", out);
