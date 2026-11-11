const C = { bg: 0x050b0d, white: 0xf7fff9, green: 0x44e4aa };

let pageAlive = false;
let vibrator = null;
let resetWidget = null;
let resetPendingAt = 0;

function state() {
  const a = getApp();
  return (a._options && a._options.globalData) || a.globalData || globalThis.__FOCUSPULSE_GLOBAL__;
}

function vibrate() {
  try {
    if (vibrator) {
      vibrator.stop();
      vibrator.scene = 23;
      vibrator.start();
    }
  } catch (_e) {}
}

function go(url) {
  if (!pageAlive) return;
  pageAlive = false;
  try {
    if (typeof hmApp !== 'undefined' && typeof hmApp.gotoPage === 'function') {
      hmApp.gotoPage({ url });
      return;
    }
  } catch (_e) {}
  try { if (typeof hmApp !== 'undefined' && typeof hmApp.goBack === 'function') hmApp.goBack(); } catch (_e) {}
}

function resetProps(pending) {
  return {
    x: 16, y: 252, w: 160, h: 92, radius: 30,
    normal_color: pending ? 0x8f3b2a : 0x483126, press_color: 0x684331,
    text: pending ? 'Seguro? Toca otra vez' : 'Reiniciar ciclo',
    color: C.white, text_size: 17,
  };
}

// Two taps within 4 s: stop the timer and return to a full focus cycle (counters are kept).
function resetCycle() {
  if (!pageAlive) return;
  const now = Date.now();
  if (!resetPendingAt || now - resetPendingAt > 4000) {
    resetPendingAt = now;
    try { resetWidget.setProperty(hmUI.prop.MORE, resetProps(true)); } catch (_e) {}
    return;
  }
  resetPendingAt = 0;
  const s = state();
  s.timerRunning = false;
  s.isPaused = false;
  s.currentMode = 'WORK';
  s.secondsRemaining = s.workDuration * 60;
  s.lastTimestamp = now;
  go('page/index');
}

function bigButton(y, text, color, press, action) {
  return hmUI.createWidget(hmUI.widget.BUTTON, {
    x: 16, y, w: 160, h: 92, radius: 30,
    normal_color: color, press_color: press,
    text, color: C.white, text_size: 18,
    click_func: function () { if (!pageAlive) return; vibrate(); action(); },
  });
}

Page({
  build() {
    pageAlive = true;
    resetPendingAt = 0;
    if (typeof hmUI.widget.FILL_RECT !== 'undefined') {
      try { hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: 192, h: 490, color: C.bg }); } catch (_e) {}
    }
    try { vibrator = hmSensor.createSensor(hmSensor.id.VIBRATE); } catch (_e) {}
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 12, y: 12, w: 168, h: 28, text: 'MENÚ', color: C.green, text_size: 17,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text_style: hmUI.text_style.NONE,
    });
    // Three large buttons, one below the other.
    bigButton(52, 'Ajustes', 0x243336, 0x38514d, function () { go('page/settings'); });
    bigButton(152, 'Resumen', 0x243336, 0x38514d, function () { go('page/stats'); });
    resetWidget = hmUI.createWidget(hmUI.widget.BUTTON, {
      ...resetProps(false),
      click_func: function () { if (!pageAlive) return; vibrate(); resetCycle(); },
    });
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 16, y: 360, w: 160, h: 56, radius: 28,
      normal_color: 0x0c765a, press_color: 0x0a513f,
      text: 'Volver', color: C.white, text_size: 16,
      click_func: function () { if (!pageAlive) return; vibrate(); go('page/index'); },
    });
  },
  onDestroy() {
    pageAlive = false;
    resetWidget = null;
    try {
      if (vibrator) {
        vibrator.stop();
        if (hmSensor.deleteSensor) hmSensor.deleteSensor(vibrator);
      }
    } catch (_e) {}
    vibrator = null;
  },
});
