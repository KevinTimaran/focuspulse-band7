import { sendDeviceMessage } from '../shared/transport';

const C = {
  bg: 0x050b0d,
  white: 0xf7fff9,
  muted: 0xb7c6c0,
  green: 0x44e4aa,
  blue: 0x79baff,
  amber: 0xffc857,
  red: 0xffb4ad,
  track: 0x16353a,
};

const isNumber = (n) => typeof n === 'number' && isFinite(n);
const validBpm = (n) => isNumber(n) && n >= 25 && n <= 240 && Math.floor(n) === n;
const fmt = (n) => {
  const m = Math.floor(Math.max(0, n) / 60);
  const s = Math.max(0, n) % 60;
  return ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
};

let pageAlive = false;
let vibrator = null;
let heart = null;
let wear = null;
let wearSeenActive = false;
let heartCallback = null;
let tickerTask = null;
let timerGeneration = 0;
let ticks = 0;
let consecutiveSendFailures = 0;
let sensorStatus = 'Iniciando sensor';

let modeWidget = null;
let bpmWidget = null;
let statusWidget = null;
let timerWidget = null;
let linkWidget = null;
let actionWidget = null;
let progressFill = null;
let gestureOn = false;

const BAR_X = 16;
const BAR_Y = 200;
const BAR_W = 160;
const wrapStyle = () => (hmUI.text_style.WRAP !== undefined ? hmUI.text_style.WRAP : hmUI.text_style.NONE);

function card(x, y, w, h, color) {
  if (typeof hmUI === 'undefined' || !hmUI.widget || hmUI.widget.FILL_RECT === undefined) return null;
  try {
    return hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y, w, h, radius: 22, color });
  } catch (_e) { return null; }
}

function gd() {
  const app = typeof getApp === 'function' ? getApp() : null;
  return (app && app._options && app._options.globalData) || (app && app.globalData) || globalThis.__FOCUSPULSE_GLOBAL__ || {};
}

function createPageBackground() {
  if (typeof hmUI === 'undefined' || !hmUI.widget || hmUI.widget.FILL_RECT === undefined) return;
  try {
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: 192, h: 490, color: C.bg });
  } catch (_e) {}
}

function createText(x, y, w, h, value, size, color = C.white, extra = {}) {
  return hmUI.createWidget(hmUI.widget.TEXT, {
    x, y, w, h,
    text: String(value),
    text_size: size,
    color,
    align_h: hmUI.align.CENTER_H,
    align_v: hmUI.align.CENTER_V,
    text_style: hmUI.text_style.NONE,
    ...extra,
  });
}

function setText(widget, value, color) {
  if (!pageAlive || !widget || typeof widget.setProperty !== 'function') return;
  const str = String(value);
  try {
    if (typeof hmUI !== 'undefined' && hmUI.prop && hmUI.prop.MORE !== undefined) {
      widget.setProperty(hmUI.prop.MORE, { text: str, ...(color === undefined ? {} : { color }) });
      return;
    }
    if (typeof hmUI !== 'undefined' && hmUI.prop && hmUI.prop.TEXT !== undefined) {
      widget.setProperty(hmUI.prop.TEXT, str);
    }
  } catch (_e) {}
}

function actionBtnProps(s) {
  const label = s.timerRunning ? 'Pausar sesión' : (s.isPaused ? 'Reanudar' : 'Iniciar');
  return {
    x: 16, y: 366, w: 160, h: 60, radius: 30,
    normal_color: s.timerRunning ? 0x8f4f22 : 0x0c765a,
    press_color: s.timerRunning ? 0x663716 : 0x0a513f,
    text: label,
    color: C.white,
    text_size: 16,
  };
}

function updateActionButton() {
  if (!pageAlive || !actionWidget || typeof actionWidget.setProperty !== 'function') return;
  try {
    if (typeof hmUI !== 'undefined' && hmUI.prop && hmUI.prop.MORE !== undefined) {
      actionWidget.setProperty(hmUI.prop.MORE, actionBtnProps(gd()));
    }
  } catch (_e) {}
}

function startTicker() {
  stopTicker();
  const gen = ++timerGeneration;
  if (typeof timer !== 'undefined' && typeof timer.createTimer === 'function') {
    try {
      const id = timer.createTimer(1000, 1000, function () {
        if (!pageAlive || gen !== timerGeneration) return;
        tick(true);
      }, {});
      tickerTask = { native: true, id };
      return;
    } catch (_e) {}
  }
  if (typeof setInterval === 'function') {
    try {
      const id = setInterval(function () {
        if (!pageAlive || gen !== timerGeneration) return;
        tick(true);
      }, 1000);
      tickerTask = { native: false, id };
    } catch (_e) {}
  }
}

function stopTicker() {
  timerGeneration += 1;
  if (!tickerTask) return;
  const task = tickerTask;
  tickerTask = null;
  if (task.native && typeof timer !== 'undefined' && typeof timer.stopTimer === 'function') {
    try { timer.stopTimer(task.id); } catch (_e) {}
  } else if (!task.native && typeof clearInterval === 'function') {
    try { clearInterval(task.id); } catch (_e) {}
  }
}

function vibrate(scene) {
  try {
    if (vibrator) {
      vibrator.stop();
      vibrator.scene = scene;
      vibrator.start();
    }
  } catch (_e) {}
}

function initHeart() {
  try {
    const id = hmSensor.id.HEART !== undefined ? hmSensor.id.HEART : hmSensor.id.HEART_RATE;
    if (id === undefined) { sensorStatus = 'Sensor no disponible'; return; }
    heart = hmSensor.createSensor(id);
    heartCallback = function () { readHeart(); };
    let bound = false;
    const evCurrent = heart.event && heart.event.CURRENT !== undefined
      ? heart.event.CURRENT : (hmSensor.event && hmSensor.event.CURRENT);
    const evChange = heart.event && heart.event.CHANGE !== undefined
      ? heart.event.CHANGE : (hmSensor.event && hmSensor.event.CHANGE !== undefined ? hmSensor.event.CHANGE : 0);
    if (typeof heart.addEventListener === 'function') {
      if (evCurrent !== undefined) {
        heart.addEventListener(evCurrent, heartCallback);
        bound = true;
      }
      if (evChange !== undefined && evChange !== evCurrent) {
        try { heart.addEventListener(evChange, heartCallback); bound = true; } catch (_e) {}
      }
    }
    if (typeof heart.onCurrentChange === 'function') {
      try { heart.onCurrentChange(heartCallback); bound = true; } catch (_e) {}
    }
    sensorStatus = bound ? 'Buscando señal' : 'Sensor no disponible';
    try { void (typeof heart.getCurrent === 'function' ? heart.getCurrent() : heart.current); } catch (_e) {}
  } catch (_e) {
    heart = null;
    sensorStatus = 'Sensor no disponible';
  }
}

function isWorn() {
  if (!wear) return true;
  try {
    const value = wear.current;
    if (value === 1 || value === 2) {
      wearSeenActive = true;
      return true;
    }
    if (!wearSeenActive) return true;
    return false;
  } catch (_e) { return false; }
}

function invalidateReading() {
  const state = gd();
  state.lastBpm = null;
  state.isLiveHeartRate = false;
  state.measuredAt = 0;
  render();
}

function readHeart() {
  const state = gd();
  if (!isWorn()) {
    invalidateReading();
    return;
  }
  try {
    const raw = heart && (typeof heart.getCurrent === 'function' ? heart.getCurrent() : heart.current);
    // Only a fresh CURRENT value counts as live; a cached `last` must not renew measuredAt.
    const bpm = validBpm(raw) ? raw : null;
    if (validBpm(bpm)) {
      state.lastBpm = bpm;
      state.measuredAt = Date.now();
      state.isLiveHeartRate = true;
      render();
      return;
    }
  } catch (_e) {}
  invalidateReading();
}

function complete() {
  const state = gd();
  state.timerRunning = false;
  state.isPaused = false;
  vibrate(24);
  if (state.currentMode === 'WORK') {
    state.completedSessions += 1;
    state.totalFocusSeconds += state.workDuration * 60;
    state.currentMode = 'REST';
    state.secondsRemaining = state.restDuration * 60;
  } else {
    state.currentMode = 'WORK';
    state.secondsRemaining = state.workDuration * 60;
  }
  state.lastTimestamp = Date.now();
  updateActionButton();
  render();
  sendTelemetry();
}

function toggleTimer() {
  const state = gd();
  if (state.timerRunning) {
    state.timerRunning = false;
    state.isPaused = true;
  } else {
    if (!state.secondsRemaining || state.secondsRemaining <= 0) {
      state.secondsRemaining = (state.currentMode === 'WORK' ? state.workDuration : state.restDuration) * 60;
    }
    state.timerRunning = true;
    state.isPaused = false;
    state.lastTimestamp = Date.now();
    if (!tickerTask) startTicker();
  }
  updateActionButton();
  render();
  sendTelemetry();
}

function sendTelemetry() {
  if (!pageAlive) return;
  const state = gd(), now = Date.now();
  if (!isWorn() || (state.measuredAt && now - state.measuredAt > 30000)) invalidateReading();
  const live = state.isLiveHeartRate === true && validBpm(state.lastBpm) && state.measuredAt > 0;
  const sent = sendDeviceMessage({
    type: 'TELEMETRY_PING',
    bpm: live ? state.lastBpm : null,
    isLiveHeartRate: live,
    measuredAt: live ? state.measuredAt : 0,
    timerRunning: state.timerRunning,
    isPaused: state.isPaused,
    secondsRemaining: state.secondsRemaining,
    currentMode: state.currentMode,
    workDuration: state.workDuration,
    restDuration: state.restDuration,
    completedSessions: state.completedSessions,
    totalFocusSeconds: state.totalFocusSeconds,
    timestamp: now,
  });
  if (sent) {
    consecutiveSendFailures = 0;
    state.bleConnected = true;
  } else {
    consecutiveSendFailures += 1;
    if (!state.bleConnected || consecutiveSendFailures >= 3) {
      state.bleConnected = false;
      state.cloudSynced = false;
    }
  }
  render();
}

function render() {
  if (!pageAlive || !modeWidget) return;
  const s = gd();
  const live = s.isLiveHeartRate && validBpm(s.lastBpm) && Date.now() - s.measuredAt <= 30000;
  const baseMode = s.currentMode === 'WORK' ? 'ENFOQUE' : 'DESCANSO';
  const modeLabel = s.timerRunning ? baseMode + ' · EN CURSO' : (s.isPaused ? baseMode + ' · PAUSADO' : baseMode);
  const modeColor = s.timerRunning ? C.green : (s.isPaused ? C.amber : (s.currentMode === 'WORK' ? C.blue : C.green));
  setText(modeWidget, modeLabel, modeColor);
  setText(bpmWidget, live ? s.lastBpm + ' BPM' : '-- BPM', live ? C.white : C.muted);
  const pulseStatus = live
    ? (s.timerRunning ? 'Pulso en vivo · activo' : 'Pulso en vivo')
    : (!isWorn() ? 'Coloca la pulsera' : (sensorStatus === 'Buscando señal' ? 'Buscando señal…' : sensorStatus));
  setText(statusWidget, pulseStatus, live ? C.green : C.red);
  setText(timerWidget, fmt(s.secondsRemaining), s.timerRunning ? C.green : C.white);

  const total = Math.max(1, (s.currentMode === 'WORK' ? s.workDuration : s.restDuration) * 60);
  const ratio = Math.max(0, Math.min(1, 1 - s.secondsRemaining / total));
  if (progressFill && typeof progressFill.setProperty === 'function' && hmUI.prop && hmUI.prop.MORE !== undefined) {
    const started = s.timerRunning || s.isPaused;
    const fillW = started && ratio > 0 ? Math.max(10, Math.round(BAR_W * ratio)) : 10;
    try {
      progressFill.setProperty(hmUI.prop.MORE, {
        x: BAR_X, y: BAR_Y, w: fillW, h: 10, radius: 5,
        color: started && ratio > 0 ? modeColor : C.track,
      });
    } catch (_e) {}
  }

  const synced = s.cloudSynced && Date.now() - s.lastAckAt < 20000;
  const isAccountError = s.syncError === 'CONFIG' || s.syncError === 'AUTH';
  const linkText = synced
    ? 'Zepp + nube conectados'
    : (s.bleConnected ? (isAccountError ? 'Configura cuenta en Zepp' : 'Zepp conectado · sincronizando') : 'Sin enlace con Zepp');
  setText(linkWidget, linkText, synced ? C.green : (s.bleConnected && isAccountError ? C.amber : C.muted));
}

function tick(fromTimer) {
  if (!pageAlive) return;
  ticks += 1;
  const state = gd(), now = Date.now();
  if (!isWorn()) {
    invalidateReading();
  } else {
    if (heart) {
      try {
        const raw = typeof heart.getCurrent === 'function' ? heart.getCurrent() : heart.current;
        const bpm = validBpm(raw) ? raw : null;
        if (validBpm(bpm)) {
          state.lastBpm = bpm;
          state.measuredAt = now;
          state.isLiveHeartRate = true;
        }
      } catch (_e) {}
    }
    if (state.measuredAt && now - state.measuredAt > 30000) invalidateReading();
  }
  if (state.timerRunning && fromTimer !== false) {
    const delta = state.lastTimestamp > 0 ? now - state.lastTimestamp : 1000;
    const catchUp = state.lastTimestamp > 0 && delta >= 1000 && delta <= 3600000;
    const step = catchUp ? Math.floor(delta / 1000) : 1;
    state.secondsRemaining = Math.max(0, state.secondsRemaining - step);
    // Keep the sub-second remainder so timer jitter does not accumulate as drift.
    state.lastTimestamp = catchUp ? state.lastTimestamp + step * 1000 : now;
    if (state.secondsRemaining === 0) {
      complete();
      return;
    }
  }
  render();
  if (fromTimer !== false && ticks % 5 === 0) sendTelemetry();
}

function cleanup() {
  if (!pageAlive) return;
  pageAlive = false;
  consecutiveSendFailures = 0;
  stopTicker();
  try { if (typeof hmApp !== 'undefined' && typeof hmApp.setScreenKeep === 'function') hmApp.setScreenKeep(false); } catch (_e) {}
  globalThis.__FOCUSPULSE_CONNECTION__ = null;
  globalThis.__FOCUSPULSE_SEND_TELEMETRY__ = null;
  globalThis.__FOCUSPULSE_AI__ = null;
  try {
    if (heart && heartCallback && typeof heart.removeEventListener === 'function') {
      const event = heart.event && heart.event.CURRENT !== undefined ? heart.event.CURRENT : (hmSensor.event && hmSensor.event.CURRENT);
      heart.removeEventListener(event, heartCallback);
    }
  } catch (_e) {}
  for (const sensor of [heart, wear, vibrator]) {
    try { if (sensor && hmSensor.deleteSensor) hmSensor.deleteSensor(sensor); } catch (_e) {}
  }
  heart = null;
  wear = null;
  vibrator = null;
  modeWidget = null;
  bpmWidget = null;
  statusWidget = null;
  timerWidget = null;
  linkWidget = null;
  actionWidget = null;
  progressFill = null;
  if (gestureOn) {
    gestureOn = false;
    try { hmApp.unregisterGestureEvent(); } catch (_e) {}
  }
}

function openPage(url) {
  if (!pageAlive) return;
  vibrate(23);
  cleanup();
  try {
    if (typeof hmApp !== 'undefined' && typeof hmApp.gotoPage === 'function') {
      hmApp.gotoPage({ url });
    }
  } catch (_e) {}
}

Page({
  build() {
    if (pageAlive) cleanup();
    const state = gd();
    pageAlive = true;
    wearSeenActive = false;
    ticks = 0;
    consecutiveSendFailures = 0;
    progressFill = null;
    state.lastBpm = null;
    state.isLiveHeartRate = false;
    state.measuredAt = 0;

    createPageBackground();
    try { if (typeof hmApp !== 'undefined' && typeof hmApp.setScreenKeep === 'function') hmApp.setScreenKeep(true); } catch (_e) {}
    try { vibrator = hmSensor.createSensor(hmSensor.id.VIBRATE); } catch (_e) {}
    try {
      if (hmSensor.id.WEAR !== undefined) {
        wear = hmSensor.createSensor(hmSensor.id.WEAR);
        if (wear && (wear.current === 1 || wear.current === 2)) wearSeenActive = true;
      }
    } catch (_e) {}
    initHeart();

    createText(12, 14, 168, 22, 'FOCUSPULSE', 15, C.green);
    modeWidget = createText(8, 44, 176, 28, 'ENFOQUE', 15, C.blue);
    timerWidget = createText(6, 86, 180, 100, fmt(state.secondsRemaining), 58, C.white, {
      click_func: function () {
        if (!pageAlive) return;
        vibrate(23);
        toggleTimer();
      },
    });

    if (typeof hmUI !== 'undefined' && hmUI.widget && hmUI.widget.FILL_RECT !== undefined) {
      try {
        hmUI.createWidget(hmUI.widget.FILL_RECT, { x: BAR_X, y: BAR_Y, w: BAR_W, h: 10, radius: 5, color: C.track });
        progressFill = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: BAR_X, y: BAR_Y, w: 10, h: 10, radius: 5, color: C.track });
      } catch (_e) { progressFill = null; }
    }

    card(10, 226, 172, 98, 0x0d1d20);
    createText(12, 230, 168, 16, 'PULSO', 12, C.muted);
    bpmWidget = createText(12, 246, 168, 46, '-- BPM', 34, C.white);
    statusWidget = createText(12, 294, 168, 24, 'Sin lectura', 13, C.muted);

    linkWidget = createText(8, 334, 176, 22, 'Sin enlace con Zepp', 12, C.muted);

    actionWidget = hmUI.createWidget(hmUI.widget.BUTTON, {
      ...actionBtnProps(state),
      click_func: function () {
        if (!pageAlive) return;
        vibrate(23);
        toggleTimer();
      },
    });

    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 16, y: 436, w: 160, h: 46, radius: 23,
      normal_color: 0x242e33, press_color: 0x39434a,
      text: 'Menú', color: C.white, text_size: 14,
      click_func: function () { openPage('page/menu'); },
    });

    // Swipe up anywhere also opens the menu (same action as the button).
    try {
      if (typeof hmApp !== 'undefined' && typeof hmApp.registerGestureEvent === 'function' && hmApp.gesture) {
        hmApp.registerGestureEvent(function (event) {
          if (pageAlive && event === hmApp.gesture.UP) {
            openPage('page/menu');
            return true;
          }
          return false;
        });
        gestureOn = true;
      }
    } catch (_e) {}

    globalThis.__FOCUSPULSE_CONNECTION__ = function () { if (pageAlive) render(); };
    globalThis.__FOCUSPULSE_SEND_TELEMETRY__ = function () { if (pageAlive) sendTelemetry(); };
    globalThis.__FOCUSPULSE_AI__ = function () { if (!pageAlive) return; vibrate(24); render(); };

    tick(false);
    sendTelemetry();
    startTicker();
  },
  tick,
  toggleTimer,
  sendTelemetry,
  cleanup,
  onDestroy() {
    cleanup();
  },
});
