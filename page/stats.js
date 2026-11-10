const C = { bg: 0x050b0d, white: 0xf7fff9, green: 0x44e4aa, muted: 0xb7c6c0 };

let pageAlive = false;
let vibrator = null;
let adviceWidget = null;

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

function line(y, h, value, size, color = C.white) {
  return hmUI.createWidget(hmUI.widget.TEXT, {
    x: 16, y, w: 160, h,
    text: String(value),
    color,
    text_size: size,
    align_h: hmUI.align.CENTER_H,
    align_v: hmUI.align.CENTER_V,
    text_style: hmUI.text_style.WRAP || hmUI.text_style.NONE,
  });
}

function vibrate() {
  try {
    if (vibrator) {
      vibrator.stop();
      vibrator.scene = 24;
      vibrator.start();
    }
  } catch (_e) {}
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

Page({
  build() {
    pageAlive = true;
    const s = state();
    createPageBackground();
    try { vibrator = hmSensor.createSensor(hmSensor.id.VIBRATE); } catch (_e) {}
    line(14, 28, 'RESUMEN', 19, C.green);
    line(48, 22, 'Sesiones completas', 14, C.muted);
    line(72, 36, String(s.completedSessions), 26, C.white);
    line(114, 22, 'Tiempo de enfoque', 14, C.muted);
    line(138, 36, Math.floor(s.totalFocusSeconds / 60) + ' min', 24, C.white);
    line(180, 22, 'CONSEJO DE IA', 14, C.green);
    adviceWidget = line(206, 86, s.aiRecommendation || 'Sin consejo todavía', 12, C.white);
    globalThis.__FOCUSPULSE_AI__ = function (message) {
      if (!pageAlive || !adviceWidget) return;
      vibrate();
      try { adviceWidget.setProperty(hmUI.prop.MORE, { text: String(message) }); } catch (_e) {}
    };
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 24, y: 302, w: 144, h: 48, radius: 24,
      normal_color: 0x0c765a, press_color: 0x0a513f,
      text: 'Volver', color: C.white, text_size: 16,
      click_func: function () { vibrate(); back(); },
    });
  },
  onDestroy() {
    pageAlive = false;
    adviceWidget = null;
    globalThis.__FOCUSPULSE_AI__ = null;
    try {
      if (vibrator) {
        vibrator.stop();
        if (hmSensor.deleteSensor) hmSensor.deleteSensor(vibrator);
      }
    } catch (_e) {}
    vibrator = null;
  },
});
