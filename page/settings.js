const C = { bg: 0x050b0d, white: 0xf7fff9, muted: 0xb7c6c0, green: 0x44e4aa, blue: 0x79baff };

let pageAlive = false;
let workWidget = null;
let restWidget = null;
let vibrator = null;
let confirmText = null;
let resetPendingAt = 0;

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

function label(x, y, w, h, value, size, color = C.white, extra = {}) {
  return hmUI.createWidget(hmUI.widget.TEXT, {
    x, y, w, h,
    text: String(value),
    color,
    text_size: size,
    align_h: hmUI.align.CENTER_H,
    align_v: hmUI.align.CENTER_V,
    text_style: hmUI.text_style.NONE,
    ...extra,
  });
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

function render() {
  if (!pageAlive) return;
  const s = state();
  try {
    if (workWidget && hmUI.prop && hmUI.prop.MORE !== undefined) {
      workWidget.setProperty(hmUI.prop.MORE, { text: s.workDuration + ' min', color: C.white });
    }
    if (restWidget && hmUI.prop && hmUI.prop.MORE !== undefined) {
      restWidget.setProperty(hmUI.prop.MORE, { text: s.restDuration + ' min', color: C.white });
    }
  } catch (_e) {}
}

function change(key, delta) {
  if (!pageAlive) return;
  const s = state();
  const min = key === 'workDuration' ? 5 : 1;
  const max = key === 'workDuration' ? 60 : 30;
  s[key] = Math.max(min, Math.min(max, s[key] + delta));
  if (!s.timerRunning && !s.isPaused) {
    s.secondsRemaining = (s.currentMode === 'WORK' ? s.workDuration : s.restDuration) * 60;
  } else {
    s.secondsRemaining = Math.min(s.secondsRemaining, (s.currentMode === 'WORK' ? s.workDuration : s.restDuration) * 60);
  }
  render();
}

function confirmReset() {
  if (!pageAlive) return;
  if (Date.now() - resetPendingAt > 5000) {
    resetPendingAt = Date.now();
    try {
      confirmText.setProperty(hmUI.prop.MORE, { text: 'Toca otra vez para confirmar', color: 0xffd89a });
    } catch (_e) {}
    return;
  }
  resetPendingAt = 0;
  const s = state();
  s.timerRunning = false;
  s.isPaused = false;
  s.currentMode = 'WORK';
  s.secondsRemaining = s.workDuration * 60;
  s.lastTimestamp = Date.now();
  try {
    confirmText.setProperty(hmUI.prop.MORE, { text: 'Ciclo reiniciado', color: C.green });
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

function stepButton(x, y, caption, action) {
  return hmUI.createWidget(hmUI.widget.BUTTON, {
    x, y, w: 46, h: 48, radius: 18,
    normal_color: 0x243336,
    press_color: 0x38514d,
    text: caption,
    color: C.white,
    text_size: 22,
    click_func: function () {
      if (!pageAlive) return;
      vibrate();
      action();
    },
  });
}

function valueDisplay(x, y, key) {
  const s = state();
  return label(x, y, 60, 48, s[key] + ' min', 17, C.white, {
    click_func: function () {
      if (!pageAlive) return;
      vibrate();
      change(key, key === 'workDuration' ? 5 : 1);
    },
  });
}

Page({
  build() {
    pageAlive = true;
    resetPendingAt = 0;
    createPageBackground();
    try { vibrator = hmSensor.createSensor(hmSensor.id.VIBRATE); } catch (_e) {}

    label(20, 12, 152, 24, 'AJUSTES', 18, C.green);
    label(16, 40, 160, 22, 'Enfoque · toca valor o +/−', 12, C.white);
    stepButton(16, 66, '-', function () { change('workDuration', -5); });
    workWidget = valueDisplay(66, 66, 'workDuration');
    stepButton(130, 66, '+', function () { change('workDuration', 5); });

    label(16, 120, 160, 22, 'Descanso · toca valor o +/−', 12, C.white);
    stepButton(16, 146, '-', function () { change('restDuration', -1); });
    restWidget = valueDisplay(66, 146, 'restDuration');
    stepButton(130, 146, '+', function () { change('restDuration', 1); });

    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 24, y: 202, w: 144, h: 46, radius: 23,
      normal_color: 0x483126, press_color: 0x684331,
      text: 'Reiniciar ciclo', color: C.white, text_size: 14,
      click_func: function () { vibrate(); confirmReset(); },
    });

    confirmText = label(16, 250, 160, 20, '', 11, C.muted);

    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 24, y: 274, w: 144, h: 46, radius: 23,
      normal_color: 0x0c765a, press_color: 0x0a513f,
      text: 'Iniciar ahora', color: C.white, text_size: 15,
      click_func: function () { vibrate(); startNow(); },
    });

    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 24, y: 328, w: 144, h: 46, radius: 23,
      normal_color: 0x243336, press_color: 0x38514d,
      text: 'Volver', color: C.white, text_size: 15,
      click_func: function () { vibrate(); back(); },
    });

    render();
  },
  onDestroy() {
    pageAlive = false;
    workWidget = null;
    restWidget = null;
    confirmText = null;
    try {
      if (vibrator) {
        vibrator.stop();
        if (hmSensor.deleteSensor) hmSensor.deleteSensor(vibrator);
      }
    } catch (_e) {}
    vibrator = null;
  },
});
