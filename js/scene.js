// Camera dolly through the pasture. Scroll progress p (0 at the top, 1 when
// the RSVP stage reaches the top of the viewport) walks the camera toward the
// screen. Every frame writes transforms only; layout is read on resize.

const TILT = 0.11; // horizon starts this much lower, as if looking up
const LIT_AT = 0.42;
const LEADER_STEP = 0.16;
const CARD_AT = LIT_AT + LEADER_STEP * 3;

const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const FLIES = {
  far: { n: 16, r: [1.1, 1.7], drift: 2.2 },
  mid: { n: 12, r: [2.4, 3.6], drift: 4.5 },
  near: { n: 9, r: [6, 11], drift: 9 },
  fore: { n: 10, r: [2.6, 5.5], drift: 6 },
};

// Fade the vote title while the screen is still this far below it, then hide
// it. A later hard cutoff guarantees the two never share pixels.
const CLEAR_FROM = 108;
const CLEAR_TO = 60;

function populate(world) {
  const rand = seeded(7);
  const pick = (a, b) => a + rand() * (b - a);
  world.querySelectorAll("[data-flies]").forEach((group) => {
    const cfg = FLIES[group.dataset.flies];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < cfg.n; i += 1) {
      const fly = document.createElement("i");
      fly.className = "ff";
      const kind = group.dataset.flies;
      const x = kind === "near" || kind === "fore" ? (i % 2 ? pick(3, 28) : pick(72, 97)) : pick(2, 98);
      fly.style.cssText =
        `--x:${x.toFixed(1)}%;--y:${pick(8, 92).toFixed(1)}%;` +
        `--r:calc(${pick(...cfg.r).toFixed(2)} * var(--s));` +
        `--dx:calc(${pick(-cfg.drift, cfg.drift).toFixed(2)} * var(--s));` +
        `--dy:calc(${pick(cfg.drift * 0.3, cfg.drift).toFixed(2)} * var(--s));` +
        `--t:${pick(5, 11).toFixed(2)}s;--b:${pick(2.6, 6).toFixed(2)}s;--d:${(-pick(0, 10)).toFixed(2)}s`;
      frag.append(fly);
    }
    group.append(frag);
  });
  const twinkles = world.querySelector("#twinkles");
  if (twinkles) {
    for (let i = 0; i < 18; i += 1) {
      const star = document.createElement("i");
      star.style.cssText =
        `--x:${pick(2, 98).toFixed(1)}%;--y:${pick(3, 70).toFixed(1)}%;--r:${pick(1.6, 2.8).toFixed(1)}px;` +
        `--t:${pick(2.4, 6).toFixed(2)}s;--d:${(-pick(0, 6)).toFixed(2)}s`;
      twinkles.append(star);
    }
  }
}

export function createScene({ world, stage, hero, hold, reduced, onScreen }) {
  populate(world);

  const layers = [...world.querySelectorAll(".L, .sky, .ground")].map((el) => {
    const fade = el.classList.contains("fence")
      ? [0.5, 0.82]
      : el.classList.contains("projector")
        ? [0.72, 0.92]
        : el.classList.contains("grass")
          ? [0.25, 0.55]
          : el.classList.contains("flies-near")
            ? [0.62, 0.9]
            : null;
    return {
      el,
      z: el.dataset.z ? Number(el.dataset.z) : null,
      z0: el.dataset.z0 ? Number(el.dataset.z0) : null,
      tilt: el.dataset.tilt ? Number(el.dataset.tilt) : 1,
      fade,
      last: "",
      lastOpacity: -1,
    };
  });

  const screenLayer = world.querySelector(".screen");
  const face = world.querySelector(".face");
  const projector = world.querySelector(".projector");
  const beam = world.querySelector("#beam");
  const hand = world.querySelector("#leader-hand");
  const leader = world.querySelector(".leader");
  const fore = world.querySelector("#fore");
  const root = document.body;

  let W = 0;
  let horizon = 0.42;
  let screenTop = 0;
  let holdBottom = 0;
  let H = 0;
  let hy = 0;
  let drop = 0;
  let stageTop = 1;
  let faceBottom = 0;
  let lensY = 0;
  let target = reduced ? 1 : 0;
  let current = target;
  let raf = 0;
  let lastT = 0;
  let screenState = "";
  let leaderN = "";
  let lit = null;
  const written = new Map();
  const write = (el, prop, value) => {
    const key = el.id || el.className;
    const k = `${key}|${prop}`;
    if (written.get(k) === value) return;
    written.set(k, value);
    if (prop.startsWith("--")) el.style.setProperty(prop, value);
    else el.style[prop] = value;
  };

  function measure() {
    W = world.clientWidth;
    H = world.clientHeight;
    horizon = Number(getComputedStyle(document.documentElement).getPropertyValue("--hz")) || 0.42;
    hy = H * horizon;
    drop = H * TILT;
    layers.forEach((layer) => {
      const { el } = layer;
      layer.el.style.transformOrigin = `${(W / 2 - el.offsetLeft).toFixed(1)}px ${(hy - el.offsetTop).toFixed(1)}px`;
      layer.last = "";
    });
    faceBottom = screenLayer.offsetTop + face.offsetTop + face.offsetHeight;
    screenTop = screenLayer.offsetTop;
    hold.style.transform = "";
    written.delete(`${hold.className}|transform`);
    const holdRect = hold.getBoundingClientRect();
    holdBottom = holdRect.bottom;
    lensY = projector.offsetTop + projector.offsetHeight * (45 / 110);
    stageTop = Math.max(1, stage.getBoundingClientRect().top + window.scrollY);
    target = reduced ? 1 : clamp(window.scrollY / stageTop);
    current = target;
    render(current);
    textFx(target);
  }

  function scaleFor(layer, e) {
    if (layer.z) return (layer.z - 1) / (layer.z - e);
    if (layer.z0) return layer.z0 / (layer.z0 - e);
    return 1;
  }

  function render(e) {
    const dy = (1 - e) * drop;
    let screenScale = 1;
    let projScale = 1;
    for (const layer of layers) {
      const s = scaleFor(layer, e);
      if (layer.el === screenLayer) screenScale = s;
      if (layer.el === projector) projScale = s;
      const t = `translate3d(0,${(dy * layer.tilt).toFixed(1)}px,0) scale(${s.toFixed(4)})`;
      if (t !== layer.last) {
        layer.el.style.transform = t;
        layer.last = t;
      }
      if (layer.fade) {
        const o = 1 - smooth(layer.fade[0], layer.fade[1], e);
        const rounded = Math.round(o * 100) / 100;
        if (rounded !== layer.lastOpacity) {
          layer.el.style.opacity = rounded;
          layer.el.style.visibility = rounded <= 0 ? "hidden" : "";
          layer.lastOpacity = rounded;
        }
      }
    }

    if (!reduced) {
      const rise = smooth(0.46, 0.62, (e * stageTop) / H);
      const edge = hy + dy + screenScale * (screenTop - hy);
      const gap = edge - holdBottom;
      // Gap keeps it off the screen; the scroll cap finishes the fade once the
      // leader is up, so it doesn't hang as a ghost above the countdown.
      const clear = Math.min(smooth(CLEAR_TO, CLEAR_FROM, gap), 1 - smooth(0.6, 0.72, e));
      // Leave upward, away from the screen, instead of dissolving on top of it.
      const up = (1 - clear) * 28;
      const down = (1 - rise) * 12;
      const o = edge < holdBottom - up + 16 ? 0 : Math.round(rise * clear * 100) / 100;
      write(hold, "opacity", String(o));
      write(hold, "visibility", o <= 0 ? "hidden" : "visible");
      write(hold, "transform", `translate3d(0,${(down - up).toFixed(1)}px,0)`);
    }

    const foreIn = smooth(0.8, 1, e);
    write(fore, "opacity", foreIn.toFixed(2));
    write(fore, "visibility", foreIn <= 0 ? "hidden" : "visible");
    write(fore, "transform", `translate3d(0,${((1 - foreIn) * 48).toFixed(1)}px,0)`);

    const yTop = hy + dy + screenScale * (faceBottom - hy);
    const yLens = hy + dy + projScale * (lensY - hy);
    const span = Math.max(1, yLens - yTop);
    const beamOpacity = 0.55 * (1 - smooth(0.68, 0.94, e));
    write(beam, "--beam", beamOpacity.toFixed(2));
    if (beamOpacity > 0) {
      write(beam, "transform", `translate3d(0,${yTop.toFixed(1)}px,0) scale(${screenScale.toFixed(4)},${(span / 100).toFixed(4)})`);
    }

    const isLit = reduced || e >= LIT_AT;
    if (isLit !== lit) {
      lit = isLit;
      root.classList.toggle("lit", isLit);
    }

    let state = "off";
    if (reduced || e >= CARD_AT) state = "card";
    else if (isLit) state = "leader";
    if (state === "leader") {
      const seg = (e - LIT_AT) / LEADER_STEP;
      const n = String(clamp(3 - Math.floor(seg), 1, 3));
      if (n !== leaderN) {
        leaderN = n;
        leader.dataset.n = n;
      }
      write(hand, "transform", `rotate(${((seg % 1) * 360).toFixed(0)}deg)`);
    }
    if (state !== screenState) {
      screenState = state;
      root.dataset.screen = state;
      onScreen?.(state);
    }
  }

  function textFx(p) {
    if (reduced) return;
    const y = p * stageTop;
    write(hero, "opacity", (1 - smooth(H * 0.05, H * 0.42, y)).toFixed(2));
  }

  function tick(time) {
    const dt = lastT ? Math.min(64, time - lastT) : 16.7;
    lastT = time;
    const k = 1 - Math.pow(1 - 0.2, dt / 16.7);
    current += (target - current) * k;
    if (Math.abs(target - current) < 0.0004) current = target;
    render(current);
    if (current !== target) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
      lastT = 0;
    }
  }

  function onScroll() {
    if (reduced) return;
    target = clamp(window.scrollY / stageTop);
    textFx(target);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  let resizeTimer = 0;
  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(measure, 120);
  }

  measure();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("load", measure, { once: true });
  document.fonts?.ready.then(measure);

  return {
    get stageTop() {
      return stageTop;
    },
    atStage() {
      return reduced || window.scrollY >= stageTop - 8;
    },
    goToStage({ instant = false } = {}) {
      if (reduced) return;
      window.scrollTo({ top: stageTop, behavior: instant ? "auto" : "smooth" });
    },
    measure,
  };
}
