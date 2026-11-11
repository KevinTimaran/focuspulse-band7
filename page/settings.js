const C = { bg: 0x050b0d, white: 0xf7fff9, muted: 0x8fa39c, green: 0x44e4aa, blue: 0x79baff, pill: 0x16353a };

// Two columns (focus | rest). Each shows previous / current / next value in a card near the
// centre of the screen; the arrow buttons above and below the card change the value.
// The numbers are display-only. No haptics on this screen.
const RANGE = {
  workDuration: { min: 5, max: 60, step: 5 },
  restDuration: { min: 1, max: 30, step: 1 },
};
const COLS = {
  workDuration: { x: 8, w: 84, title: 'ENFOQUE' },
  restDuration: { x: 100, w: 84, title: 'DESCANSO' },
};
const Y = { title: 122, up: 146, card: 196, prev: 198, cur: 224, next: 282, down: 316, caption: 364 };

let pageAlive = false;
let wheels = {};

function state() {
  const a = getApp();
  return (a._options && a._options.globalData) || a.globalData || globalThis.__FOCUSPULSE_GLOBAL__;
}

function createPageBackground() {
  if (typeof hmUI === 'undefined' || !hmUI.widget || hmUI.widget.FILL_RECT === undefined) return;
  try {
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: 192, h: 490, color: C.bg });
  } catch (_e) {}
}

function label(x, y, w, h, value, size, color = C.white) {
  return hmUI.createWidget(hmUI.widget.TEXT, {
    x, y, w, h,
    text: String(value),
    color,
    text_size: size,
    align_h: hmUI.align.CENTER_H,
    align_v: hmUI.align.CENTER_V,
    text_style: hmUI.text_style.NONE,
  });
}

const pad = (n) => ('0' + n).slice(-2);

// Value `dir` steps away from the current one, wrapping around like a wheel.
function peek(key, dir) {
  const r = RANGE[key];
  const count = Math.round((r.max - r.min) / r.step) + 1;
  const idx = Math.round((state()[key] - r.min) / r.step);
  const next = (((idx + dir) % count) + count) % count;
  return r.min + next * r.step;
}

function setNumber(widget, value, color) {
  if (!widget || typeof widget.setProperty !== 'function') return;
  try { widget.setProperty(hmUI.prop.MORE, { text: pad(value), color }); } catch (_e) {}
}

function render() {
  if (!pageAlive) return;
  const s = state();
  for (const key of Object.keys(RANGE)) {
    const w = wheels[key];
    if (!w) continue;
    setNumber(w.prev, peek(key, -1), C.muted);
    setNumber(w.cur, s[key], C.white);
    setNumber(w.next, peek(key, 1), C.muted);
  }
}

function change(key, dir) {
  if (!pageAlive) return;
  const s = state();
  s[key] = peek(key, dir);
  const total = (s.currentMode === 'WORK' ? s.workDuration : s.restDuration) * 60;
  if (!s.timerRunning && !s.isPaused) {
    s.secondsRemaining = total;
  } else {
    s.secondsRemaining = Math.min(s.secondsRemaining, total);
  }
  render();
}

function back() {
  if (!pageAlive) return;
  pageAlive = false;
  try {
    if (typeof hmApp !== 'undefined' && typeof hmApp.gotoPage === 'function') {
      hmApp.gotoPage({ url: 'page/index' });
      return;
    }
  } catch (_e) {}
  try { if (typeof hmApp !== 'undefined' && typeof hmApp.goBack === 'function') hmApp.goBack(); } catch (_e) {}
}

function startNow() {
  if (!pageAlive) return;
  const s = state();
  if (!s.timerRunning && !s.isPaused) {
    s.secondsRemaining = (s.currentMode === 'WORK' ? s.workDuration : s.restDuration) * 60;
  }
  s.timerRunning = true;
  s.isPaused = false;
  s.lastTimestamp = Date.now();
  back();
}

function arrow(key, y, text, dir) {
  const col = COLS[key];
  return hmUI.createWidget(hmUI.widget.BUTTON, {
    x: col.x, y, w: col.w, h: 46, radius: 23,
    normal_color: 0x243336, press_color: 0x38514d,
    text, color: C.green, text_size: 20,
    click_func: function () { change(key, dir); },
  });
}

function wheel(key) {
  const col = COLS[key];
  const s = state();
  label(col.x, Y.title, col.w, 20, col.title, 13, C.blue);
  arrow(key, Y.up, '▲', -1);
  return {
    prev: label(col.x, Y.prev, col.w, 26, pad(peek(key, -1)), 18, C.muted),
    cur: label(col.x, Y.cur, col.w, 56, pad(s[key]), 40, C.white),
    next: label(col.x, Y.next, col.w, 26, pad(peek(key, 1)), 18, C.muted),
  };
}

Page({
  build() {
    pageAlive = true;
    wheels = {};
    createPageBackground();

    label(20, 56, 152, 28, 'AJUSTES', 18, C.green);

    // One shared card behind both columns, drawn before the numbers.
    if (hmUI.widget.FILL_RECT !== undefined) {
      try { hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 6, y: Y.card, w: 180, h: 116, radius: 22, color: C.pill }); } catch (_e) {}
    }
    wheels.workDuration = wheel('workDuration');
    wheels.restDuration = wheel('restDuration');
    arrow('workDuration', Y.down, '▼', 1);
    arrow('restDuration', Y.down, '▼', 1);
    label(8, Y.caption, 176, 16, 'minutos', 11, C.muted);

    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 24, y: 386, w: 144, h: 46, radius: 23,
      normal_color: 0x0c765a, press_color: 0x0a513f,
      text: 'Listo', color: C.white, text_size: 16,
      click_func: function () { back(); },
    });

    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 24, y: 438, w: 144, h: 46, radius: 23,
      normal_color: 0x243336, press_color: 0x38514d,
      text: 'Iniciar ahora', color: C.white, text_size: 14,
      click_func: function () { startNow(); },
    });

    render();
  },
  onDestroy() {
    pageAlive = false;
    wheels = {};
  },
});
