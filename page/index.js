/**
 * FocusPulse Smartwatch App - Zepp OS 1.0 (Xiaomi Smart Band 7)
 * Page: Main Pomodoro Timer (page/index.js)
 * Screen: 192 x 490 pixels (Pure OLED Black)
 */

// Safe timer abstraction supporting Zepp OS 1.0 QuickJS runtime and native timer module
function createSafeTimer(delay, repeat, callback) {
  // 1. Prioritize setInterval / setTimeout (proven standard in Zeus QuickJS runtime)
  if (repeat > 0 && typeof setInterval === 'function') {
    try {
      const handle = setInterval(callback, repeat);
      return { type: 'js_interval', handle: handle };
    } catch (e) {
      console.log('[FocusPulse Timer] setInterval error:', e);
    }
  }

  // 2. Next try native Zepp OS timer module (1ms delay for immediate starting, repeat period)
  if (typeof timer !== 'undefined' && typeof timer.createTimer === 'function') {
    try {
      const initDelay = repeat > 0 ? 1 : (delay || 1);
      const repeatPeriod = repeat > 0 ? repeat : 0;
      const handle = timer.createTimer(initDelay, repeatPeriod, callback, {});
      return { type: 'zepp', handle: handle };
    } catch (e) {
      console.log('[FocusPulse Timer] timer.createTimer error:', e);
    }
  }

  // 3. Fallback to setTimeout for single delays
  if (typeof setTimeout === 'function') {
    try {
      const handle = setTimeout(callback, delay || 0);
      return { type: 'js_timeout', handle: handle };
    } catch (e) {
      console.log('[FocusPulse Timer] setTimeout error:', e);
    }
  }

  return null;
}

function stopSafeTimer(timerObj) {
  if (!timerObj) return;
  if (timerObj.type === 'js_interval') {
    try {
      clearInterval(timerObj.handle);
    } catch (e) {}
  } else if (timerObj.type === 'zepp') {
    if (typeof timer !== 'undefined' && typeof timer.stopTimer === 'function') {
      try {
        timer.stopTimer(timerObj.handle);
      } catch (e) {}
    }
  } else if (timerObj.type === 'js_timeout') {
    try {
      clearTimeout(timerObj.handle);
    } catch (e) {}
  }
}

// Top-level global UI widget references for instant reactive updates in Zepp OS 1.0
const widgets = {
  headerModeWidget: null,
  bpmWidget: null,
  connWidget: null,
  trackArcWidget: null,
  progressArcWidget: null,
  timerTextWidget: null,
  subStatusWidget: null,
  streakWidget: null,
  btnPlayPauseWidget: null,
  btnStopWidget: null,
  btnSettingsWidget: null,
  btnStatsWidget: null,
};
globalThis.__FOCUSPULSE_WIDGETS__ = widgets;

// Helper to keep watch screen awake during active pomodoro countdown
function setScreenKeepState(keep) {
  try {
    if (typeof hmApp !== 'undefined' && typeof hmApp.setScreenKeep === 'function') {
      hmApp.setScreenKeep(!!keep);
    }
  } catch (e) {
    console.log('[FocusPulse ScreenKeep] Error setting screen keep:', e);
  }
}

// Robust property updater for Zepp OS 1.0 (Xiaomi Smart Band 7)
// Note: Zepp OS 1.0 native C widget runtime strictly requires hmUI.prop.MORE for TEXT widgets
// Do NOT call this on BUTTON widgets!
function updateWidgetText(widget, text, color) {
  if (!widget) return;
  const str = String(text);
  const props = { text: str };
  if (color !== undefined) {
    props.color = color;
  }
  try {
    if (typeof hmUI !== 'undefined' && hmUI.prop && hmUI.prop.MORE !== undefined) {
      widget.setProperty(hmUI.prop.MORE, props);
      return;
    }
  } catch (e) {}
  try {
    if (typeof hmUI !== 'undefined' && hmUI.prop && hmUI.prop.TEXT !== undefined) {
      widget.setProperty(hmUI.prop.TEXT, str);
    }
  } catch (e) {}
}

function getGlobalData() {
  let app = null;
  try {
    if (typeof getApp === 'function') {
      app = getApp();
    }
  } catch (e) {
    console.log('[FocusPulse Main] getApp error:', e);
  }

  let gd = null;
  if (app && app._options && app._options.globalData) {
    gd = app._options.globalData;
  } else if (app && app.globalData) {
    gd = app.globalData;
    if (app._options) app._options.globalData = gd;
  } else if (globalThis.__FOCUSPULSE_GLOBAL__) {
    gd = globalThis.__FOCUSPULSE_GLOBAL__;
  } else {
    gd = {
      workDuration: 25,
      restDuration: 5,
      completedSessions: 4,
      totalFocusSeconds: 135 * 60,
      currentMode: 'WORK',
      timerRunning: false,
      isPaused: false,
      secondsRemaining: 25 * 60,
      lastBpm: 75,
      isLiveHeartRate: false,
      bleConnected: false,
      aiRecommendation: 'AI: Heart rate spiked 20%.\nTake a 10 min break.',
      lastTimestamp: 0,
    };
    globalThis.__FOCUSPULSE_GLOBAL__ = gd;
  }

  if (app) {
    if (!app._options) app._options = {};
    app._options.globalData = gd;
    app.globalData = gd;
  }
  globalThis.__FOCUSPULSE_GLOBAL__ = gd;
  return gd;
}

Page({
  state: {
    workDuration: 25,
    restDuration: 5,
    currentMode: 'WORK', // 'WORK' | 'REST'
    secondsRemaining: 25 * 60,
    timerRunning: false,
    isPaused: false,
    bpm: 75,
    isLiveHeartRate: false, // true = real hardware sensor reading, false = fallback/sim
    bleConnected: false,    // true = iPhone BLE link verified, false = disconnected
    lastRenderedAngle: -999,
    lastTickTimestamp: 0,
    timerHandle: null,
    pendingTransitionTimer: null,
  },

  // Widgets
  headerModeWidget: null,
  bpmWidget: null,
  connWidget: null,
  trackArcWidget: null,
  progressArcWidget: null,
  timerTextWidget: null,
  subStatusWidget: null,
  streakWidget: null,
  btnPlayPauseWidget: null,
  btnStopWidget: null,

  // Hardware sensors & listeners
  vibrator: null,
  heartSensor: null,
  heartSensorCallback: null,
  bleCallback: null,
  lastSensorEventTime: 0,
  telemetryInterval: null,

  onInit() {
    console.log('[FocusPulse Main] onInit - starting independent BLE telemetry interval');
    this.startTelemetryInterval();
  },

  startTelemetryInterval() {
    if (this.telemetryInterval) return;
    try {
      this.telemetryInterval = setInterval(() => {
        this.sendTelemetryPing();
      }, 5000);
    } catch (e) {
      console.log('[FocusPulse Main] setInterval telemetry error:', e);
    }
  },

  build() {
    console.log('[FocusPulse Main] Building Main Pomodoro Page (192x490)');

    // 1. Sync state from globalData
    const globalData = getGlobalData();
    this.state.workDuration = globalData.workDuration || 25;
    this.state.restDuration = globalData.restDuration || 5;
    this.state.currentMode = globalData.currentMode || 'WORK';
    this.state.bpm = globalData.lastBpm || 75;
    this.state.isLiveHeartRate = !!globalData.isLiveHeartRate;
    this.state.bleConnected = !!globalData.bleConnected;

    const anchor = globalData.lastActiveTimestamp || globalData.lastTimestamp;

    // Account for elapsed wall-clock time if timer was running when page backgrounded
    if (globalData.timerRunning && anchor && anchor > 0) {
      const elapsedWallSec = Math.floor((Date.now() - anchor) / 1000);
      if (elapsedWallSec > 0) {
        if (globalData.secondsRemaining > elapsedWallSec) {
          globalData.secondsRemaining -= elapsedWallSec;
          const now = Date.now();
          globalData.lastTimestamp = now;
          globalData.lastActiveTimestamp = now;
        } else {
          // Timer finished while screen was off or user in background
          if (globalData.currentMode === 'WORK') {
            globalData.completedSessions = (globalData.completedSessions !== undefined ? globalData.completedSessions : 4) + 1;
            globalData.totalFocusSeconds = (globalData.totalFocusSeconds !== undefined ? globalData.totalFocusSeconds : (135 * 60)) + (this.state.workDuration * 60);
            globalData.currentMode = 'REST';
            this.state.currentMode = 'REST';
            globalData.secondsRemaining = this.state.restDuration * 60;
          } else {
            globalData.currentMode = 'WORK';
            this.state.currentMode = 'WORK';
            globalData.secondsRemaining = this.state.workDuration * 60;
          }
          globalData.timerRunning = false;
          globalData.isPaused = false;
          const now = Date.now();
          globalData.lastTimestamp = now;
          globalData.lastActiveTimestamp = now;
        }
      }
    }

    const currentTotalSec = (this.state.currentMode === 'WORK' ? this.state.workDuration : this.state.restDuration) * 60;

    if (globalData.timerRunning && globalData.secondsRemaining > 0) {
      this.state.secondsRemaining = globalData.secondsRemaining;
      this.state.timerRunning = true;
      this.state.isPaused = false;
      this.state.lastTickTimestamp = new Date().getTime();
    } else if (globalData.isPaused && globalData.secondsRemaining > 0) {
      this.state.secondsRemaining = globalData.secondsRemaining;
      this.state.timerRunning = false;
      this.state.isPaused = true;
      this.state.lastTickTimestamp = 0;
    } else if (globalData.secondsRemaining !== undefined && globalData.secondsRemaining > 0) {
      this.state.secondsRemaining = globalData.secondsRemaining;
      this.state.timerRunning = false;
      this.state.isPaused = false;
      this.state.lastTickTimestamp = 0;
    } else {
      this.state.secondsRemaining = currentTotalSec;
      globalData.secondsRemaining = currentTotalSec;
      this.state.timerRunning = false;
      this.state.isPaused = false;
      this.state.lastTickTimestamp = 0;
    }

    // 2. Initialize Hardware Sensors & BLE listener
    this.initSensors();
    this.initBleListener();

    // 3. Render Top Live BPM ("❤️ 75 LIVE" or "❤️ 75 SIM")
    // Explicit on-screen feedback if heart rate is real hardware sensor vs mock
    const initialHrTag = this.state.isLiveHeartRate ? 'LIVE' : 'SIM';
    const initialHrColor = this.state.isLiveHeartRate ? 0x30d158 : 0xff453a;
    widgets.bpmWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 10,
      y: 14,
      w: 172,
      h: 22,
      color: initialHrColor,
      text_size: 13,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: `❤️ ${this.state.bpm} ${initialHrTag}`,
    });
    this.bpmWidget = widgets.bpmWidget;

    // 4. Render Top Navigation Bar & Mode Badge
    // Top-left visible button: Settings (⚙️)
    widgets.btnSettingsWidget = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 18,
      y: 42,
      w: 42,
      h: 36,
      radius: 14,
      normal_color: 0x1c1c1e,
      press_color: 0x2c2c2e,
      text: '⚙️',
      color: 0xffffff,
      text_size: 16,
      click_func: () => {
        if (widgets.btnSettingsWidget) {
          try {
            widgets.btnSettingsWidget.setProperty(hmUI.prop.MORE, {
              x: 18,
              y: 42,
              w: 42,
              h: 36,
              radius: 14,
              normal_color: 0x1c1c1e,
              press_color: 0x2c2c2e,
              text: '⚙️',
              color: 0xffffff,
              text_size: 16,
            });
          } catch (e) {}
        }
        this.onSettingsClick();
      },
    });
    this.btnSettingsWidget = widgets.btnSettingsWidget;

    // Top-center: Mode Badge ("FOCUS" / "REST")
    const isWork = this.state.currentMode === 'WORK';
    const modeColor = isWork ? 0x0a84ff : 0x30d158;
    const modeLabel = isWork ? 'FOCUS' : 'REST';
    widgets.headerModeWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 64,
      y: 42,
      w: 64,
      h: 36,
      color: modeColor,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: modeLabel,
    });
    this.headerModeWidget = widgets.headerModeWidget;

    // Top-right visible button: Stats (📊)
    widgets.btnStatsWidget = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 132,
      y: 42,
      w: 42,
      h: 36,
      radius: 14,
      normal_color: 0x1c1c1e,
      press_color: 0x2c2c2e,
      text: '📊',
      color: 0xffffff,
      text_size: 16,
      click_func: () => {
        if (widgets.btnStatsWidget) {
          try {
            widgets.btnStatsWidget.setProperty(hmUI.prop.MORE, {
              x: 132,
              y: 42,
              w: 42,
              h: 36,
              radius: 14,
              normal_color: 0x1c1c1e,
              press_color: 0x2c2c2e,
              text: '📊',
              color: 0xffffff,
              text_size: 16,
            });
          } catch (e) {}
        }
        this.onStatsClick();
      },
    });
    this.btnStatsWidget = widgets.btnStatsWidget;

    // 5. Large hmUI.widget.ARC representing time progress
    // Track ARC (dark background ring): radius 80 + line_width 8/2 = 84px radius (fits within 172x172 box)
    widgets.trackArcWidget = hmUI.createWidget(hmUI.widget.ARC, {
      x: 10,
      y: 92,
      w: 172,
      h: 172,
      radius: 80,
      start_angle: 0,
      end_angle: 360,
      color: 0x1c1c1e,
      line_width: 8,
    });
    this.trackArcWidget = widgets.trackArcWidget;

    // Dynamic Progress ARC (starts at 12 o'clock = -90°)
    const initEndAngle = this.computeArcAngle();
    this.state.lastRenderedAngle = initEndAngle;
    widgets.progressArcWidget = hmUI.createWidget(hmUI.widget.ARC, {
      x: 10,
      y: 92,
      w: 172,
      h: 172,
      radius: 80,
      start_angle: -90,
      end_angle: initEndAngle,
      color: modeColor,
      line_width: 8,
    });
    this.progressArcWidget = widgets.progressArcWidget;

    // 6. Giant Center Timer TEXT ("25:00")
    widgets.timerTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: 154,
      w: 192,
      h: 48,
      color: 0xffffff,
      text_size: 38,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: this.formatTime(this.state.secondsRemaining),
    });
    this.timerTextWidget = widgets.timerTextWidget;

    // Sub-status indicator under the center timer ("READY" / "FOCUSING" / "PAUSED" / "RESTING")
    widgets.subStatusWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: 204,
      w: 192,
      h: 20,
      color: 0x8e8e93,
      text_size: 12,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: this.computeStatusText(),
    });
    this.subStatusWidget = widgets.subStatusWidget;

    // 7. Watch-to-Phone (iPhone) Connection Badge
    // Explicit on-screen indicator verifying live connection to iPhone
    const connLabel = this.state.bleConnected ? '📱 iPhone: OK' : '📱 iPhone: --';
    const connColor = this.state.bleConnected ? 0x30d158 : 0x8e8e93;
    widgets.connWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: 236,
      w: 192,
      h: 20,
      color: connColor,
      text_size: 12,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: connLabel,
    });
    this.connWidget = widgets.connWidget;

    // 8. Streak Indicator under the circle
    const completed = globalData.completedSessions !== undefined ? globalData.completedSessions : 4;
    widgets.streakWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: 268,
      w: 192,
      h: 24,
      color: 0xff9f0a,
      text_size: 13,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: `🔥 Session ${(completed % 4) + 1} of 4`,
    });
    this.streakWidget = widgets.streakWidget;

    // 9. Controls: Two hmUI.widget.BUTTON widgets at the bottom (Play/Pause and Stop)
    // Sized and positioned with ample margin from bottom bezel curvature
    const self = this;
    const playPauseText = this.state.timerRunning ? '⏸ Pause' : (this.state.isPaused ? '▶ Resume' : '▶ Start');
    const playBtnColor = this.state.timerRunning ? 0xff9f0a : (isWork ? 0x0a84ff : 0x30d158);
    const playBtnPressColor = this.state.timerRunning ? 0xd97706 : (isWork ? 0x0055b3 : 0x1f8838);

    widgets.btnPlayPauseWidget = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 20,
      y: 318,
      w: 152,
      h: 48,
      radius: 24,
      normal_color: playBtnColor,
      press_color: playBtnPressColor,
      text: playPauseText,
      color: 0xffffff,
      text_size: 16,
      click_func: () => {
        try {
          self.togglePlayPause();
        } catch (e) {
          console.log('[FocusPulse Main] togglePlayPause error:', e);
        }
        try {
          self.triggerVibration(23);
        } catch (ve) {}

        // Instant visual update on button press using setProperty directly
        self.applyPlayPauseWidgetUpdate();
        self.applyTimerWidgetsUpdate();
      },
    });
    this.btnPlayPauseWidget = widgets.btnPlayPauseWidget;

    widgets.btnStopWidget = hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 26,
      y: 376,
      w: 140,
      h: 42,
      radius: 21,
      normal_color: 0x1c1c1e,
      press_color: 0x2c2c2e,
      text: '⏹ Stop',
      color: 0xff453a,
      text_size: 15,
      click_func: () => {
        try {
          self.stopTimer();
        } catch (e) {
          console.log('[FocusPulse Main] stopTimer error:', e);
        }
        try {
          self.triggerVibration(23);
        } catch (ve) {}

        // Instant visual update on button press using setProperty directly
        self.applyPlayPauseWidgetUpdate();
        self.applyStopWidgetUpdate();
        self.applyTimerWidgetsUpdate();
      },
    });
    this.btnStopWidget = widgets.btnStopWidget;

    // If timer was already running when returning from another screen, resume interval and screen keep
    if (this.state.timerRunning) {
      this.state.lastTickTimestamp = new Date().getTime();
      setScreenKeepState(true);
      this.startTimerInterval();
    } else {
      setScreenKeepState(false);
    }

    // Ensure continuous BLE telemetry transmission remains active across page navigation resumes
    this.startTelemetryInterval();
  },

  onSettingsClick() {
    this.triggerVibration(23);
    if (this.state.pendingTransitionTimer) {
      stopSafeTimer(this.state.pendingTransitionTimer);
      this.state.pendingTransitionTimer = null;
      if (this.state.currentMode === 'WORK') {
        this.state.currentMode = 'REST';
        this.state.secondsRemaining = this.state.restDuration * 60;
      } else {
        this.state.currentMode = 'WORK';
        this.state.secondsRemaining = this.state.workDuration * 60;
      }
    }
    this.syncToGlobal();
    try {
      hmApp.gotoPage({ url: 'page/settings', file: 'page/settings' });
    } catch (e) {
      console.log('[FocusPulse Main] gotoPage settings error:', e);
    }
  },

  onStatsClick() {
    this.triggerVibration(23);
    if (this.state.pendingTransitionTimer) {
      stopSafeTimer(this.state.pendingTransitionTimer);
      this.state.pendingTransitionTimer = null;
      if (this.state.currentMode === 'WORK') {
        this.state.currentMode = 'REST';
        this.state.secondsRemaining = this.state.restDuration * 60;
      } else {
        this.state.currentMode = 'WORK';
        this.state.secondsRemaining = this.state.workDuration * 60;
      }
    }
    this.syncToGlobal();
    try {
      hmApp.gotoPage({ url: 'page/stats', file: 'page/stats' });
    } catch (e) {
      console.log('[FocusPulse Main] gotoPage stats error:', e);
    }
  },

  initBleListener() {
    try {
      if (typeof hmBle !== 'undefined') {
        if (typeof hmBle.connectStatus === 'function') {
          this.state.bleConnected = hmBle.connectStatus();
        }
        if (typeof hmBle.addListener === 'function') {
          this.bleCallback = (status) => {
            console.log('[FocusPulse Main] BLE Connection status changed:', status);
            this.state.bleConnected = !!status;
            this.updateConnectionDisplay();
          };
          hmBle.addListener(this.bleCallback);
        }
      }

      // Also listen on messaging.peerSocket for companion response verification
      if (typeof messaging !== 'undefined' && messaging.peerSocket) {
        if (this.peerSocketCallback && typeof messaging.peerSocket.removeListener === 'function') {
          try {
            messaging.peerSocket.removeListener('message', this.peerSocketCallback);
          } catch (e) {}
        }
        if (typeof messaging.peerSocket.addListener === 'function') {
          this.peerSocketCallback = (payload) => {
            try {
              this.state.bleConnected = true;
              this.updateConnectionDisplay();

              let data = payload;
              if (typeof payload === 'string') {
                try {
                  data = JSON.parse(payload);
                } catch (e) {
                  data = null;
                }
              }
              if (data && data.type === 'AI_VERDICT' && data.verdict) {
                const gd = getGlobalData();
                gd.aiRecommendation = String(data.verdict);
                console.log('[FocusPulse Main] Dynamic AI verdict stored in globalData:', data.verdict);
              } else {
                console.log('[FocusPulse Main] Received peerSocket handshake ack from iPhone companion');
              }
            } catch (err) {}
          };
          messaging.peerSocket.addListener('message', this.peerSocketCallback);
        }
      }
    } catch (e) {
      console.log('[FocusPulse Main] BLE init error:', e);
    }
  },

  sendTelemetryPing() {
    try {
      if (!this.state.timerRunning && typeof this.readHeartRateSensor === 'function') {
        this.readHeartRateSensor(false);
      }
      if (typeof messaging !== 'undefined' && messaging.peerSocket) {
        if (messaging.peerSocket.readyState === 1 && typeof messaging.peerSocket.send === 'function') {
          messaging.peerSocket.send(JSON.stringify({
            type: 'TELEMETRY_PING',
            bpm: this.state.bpm,
            isLiveHeartRate: this.state.isLiveHeartRate,
            bleConnected: this.state.bleConnected,
            timerRunning: this.state.timerRunning,
            secondsRemaining: this.state.secondsRemaining,
            currentMode: this.state.currentMode,
            timestamp: Date.now(),
          }));
        }
      }
    } catch (e) {
      console.log('[FocusPulse Main] sendTelemetryPing error:', e);
    }
  },

  initSensors() {
    // 1. VIBRATE Sensor
    try {
      if (typeof hmSensor !== 'undefined' && hmSensor.id && hmSensor.id.VIBRATE) {
        this.vibrator = hmSensor.createSensor(hmSensor.id.VIBRATE);
      }
    } catch (e) {
      console.log('[FocusPulse Main] Vibrate sensor error:', e);
    }

    // 2. HEART_RATE Sensor
    try {
      if (typeof hmSensor !== 'undefined' && hmSensor.id) {
        const sensorId = hmSensor.id.HEART !== undefined ? hmSensor.id.HEART : hmSensor.id.HEART_RATE;
        if (sensorId !== undefined) {
          this.heartSensor = hmSensor.createSensor(sensorId);
          if (this.heartSensor) {
            this.heartSensorCallback = () => {
              this.onHeartSensorEvent();
            };

            // Register event listener in Zepp OS 1.0
            if (typeof this.heartSensor.addEventListener === 'function') {
              const eventType = (hmSensor.event && hmSensor.event.CHANGE !== undefined) ? hmSensor.event.CHANGE : 0;
              this.heartSensor.addEventListener(eventType, this.heartSensorCallback);
            }
            // Zepp OS 2.0+ convenience method
            if (typeof this.heartSensor.onCurrentChange === 'function') {
              try {
                this.heartSensor.onCurrentChange(this.heartSensorCallback);
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      console.log('[FocusPulse Main] Heart rate sensor error:', e);
    }

    // Initial reading
    this.readHeartRateSensor(false);
  },

  onHeartSensorEvent() {
    const now = Date.now();
    // Throttle sensor callback UI updates to at most once per 1200ms to avoid saturating Dialog DA14697 MCU bridge
    if (this.lastSensorEventTime && (now - this.lastSensorEventTime) < 1200) {
      return;
    }
    this.lastSensorEventTime = now;
    this.readHeartRateSensor(true);
  },

  readHeartRateSensor(fromEvent) {
    let liveBpm = 0;
    let isLive = false;

    if (this.heartSensor) {
      try {
        if (typeof this.heartSensor.getCurrent === 'function') {
          liveBpm = this.heartSensor.getCurrent();
        }
        if (!liveBpm && this.heartSensor.current !== undefined) {
          liveBpm = this.heartSensor.current;
        }
        if (liveBpm && liveBpm > 40 && liveBpm < 220) {
          isLive = true;
        } else {
          // Check cached last measurement
          let lastBpm = 0;
          if (typeof this.heartSensor.getLast === 'function') {
            lastBpm = this.heartSensor.getLast();
          }
          if (!lastBpm && this.heartSensor.last !== undefined) {
            lastBpm = this.heartSensor.last;
          }
          if (lastBpm && lastBpm > 40 && lastBpm < 220) {
            liveBpm = lastBpm;
            isLive = false;
          }
        }
      } catch (e) {
        console.log('[FocusPulse Main] Error reading heart sensor:', e);
      }
    }

    if (isLive && liveBpm > 0) {
      this.state.bpm = liveBpm;
      this.state.isLiveHeartRate = true;
    } else if (liveBpm > 0) {
      this.state.bpm = liveBpm;
      this.state.isLiveHeartRate = false;
    } else {
      // Gentle variation only on manual polling if hardware sensor not yet streaming
      if (!fromEvent) {
        const delta = (Math.random() > 0.5 ? 1 : -1) * (Math.random() > 0.7 ? 1 : 0);
        this.state.bpm = Math.max(68, Math.min(88, this.state.bpm + delta));
      }
      this.state.isLiveHeartRate = false;
    }

    this.updateHeartRateDisplay();
  },

  updateHeartRateDisplay() {
    const target = widgets.bpmWidget || this.bpmWidget;
    if (!target) return;
    const isLive = this.state.isLiveHeartRate;
    const statusTag = isLive ? 'LIVE' : 'SIM';
    const text = `❤️ ${this.state.bpm} ${statusTag}`;
    const color = isLive ? 0x30d158 : 0xff453a;

    try {
      if (typeof hmUI !== 'undefined' && hmUI.prop && hmUI.prop.MORE !== undefined) {
        target.setProperty(hmUI.prop.MORE, {
          text: text,
          color: color,
        });
        return;
      }
    } catch (e) {}
    updateWidgetText(target, text, color);
  },

  updateConnectionDisplay() {
    const target = widgets.connWidget || this.connWidget;
    if (!target) return;
    const isConn = this.state.bleConnected;
    const text = isConn ? '📱 iPhone: OK' : '📱 iPhone: --';
    const color = isConn ? 0x30d158 : 0x8e8e93;

    try {
      if (typeof hmUI !== 'undefined' && hmUI.prop && hmUI.prop.MORE !== undefined) {
        target.setProperty(hmUI.prop.MORE, {
          text: text,
          color: color,
        });
        return;
      }
    } catch (e) {}
    updateWidgetText(target, text, color);
  },

  computeArcAngle() {
    const totalSecs = (this.state.currentMode === 'WORK' ? this.state.workDuration : this.state.restDuration) * 60;
    if (totalSecs <= 0) return -89;
    const elapsed = totalSecs - this.state.secondsRemaining;
    const progress = Math.max(0, Math.min(1, elapsed / totalSecs));

    if (progress <= 0) {
      return -89;
    }
    if (progress >= 1) {
      // 269 degrees represents 359 degrees sweep from -90° (prevents 360 wrap-around disappearance)
      return 269;
    }
    return -90 + Math.floor(progress * 358);
  },

  updateArcDisplay() {
    const target = widgets.progressArcWidget || this.progressArcWidget;
    if (!target) return;
    const angle = this.computeArcAngle();

    // Throttled: Only update ARC widget when the integer degree angle actually changes
    // This saves hundreds of unnecessary MCU redraws per session!
    if (angle === this.state.lastRenderedAngle) {
      return;
    }
    this.state.lastRenderedAngle = angle;

    const isWork = this.state.currentMode === 'WORK';
    const color = isWork ? 0x0a84ff : 0x30d158;

    try {
      target.setProperty(hmUI.prop.MORE, {
        x: 10,
        y: 92,
        w: 172,
        h: 172,
        radius: 80,
        line_width: 8,
        start_angle: -90,
        end_angle: angle,
        color: color,
      });
    } catch (e) {}
  },

  computeStatusText() {
    if (this.state.secondsRemaining <= 0) {
      return 'SESSION COMPLETE!';
    }
    if (this.state.timerRunning) {
      return this.state.currentMode === 'WORK' ? 'FOCUSING' : 'RESTING';
    }
    if (this.state.isPaused) {
      return 'PAUSED';
    }
    return this.state.currentMode === 'WORK' ? 'READY TO FOCUS' : 'BREAK READY';
  },

  applyPlayPauseWidgetUpdate() {
    const target = widgets.btnPlayPauseWidget || this.btnPlayPauseWidget;
    if (!target) return;
    const isRunning = this.state.timerRunning;
    const isPaused = this.state.isPaused;
    const isWork = this.state.currentMode === 'WORK';
    const text = isRunning ? '⏸ Pause' : (isPaused ? '▶ Resume' : '▶ Start');
    const normalColor = isRunning ? 0xff9f0a : (isWork ? 0x0a84ff : 0x30d158);
    const pressColor = isRunning ? 0xd97706 : (isWork ? 0x0055b3 : 0x1f8838);

    try {
      target.setProperty(hmUI.prop.MORE, {
        x: 20,
        y: 318,
        w: 152,
        h: 48,
        radius: 24,
        normal_color: normalColor,
        press_color: pressColor,
        text: text,
        color: 0xffffff,
        text_size: 16,
      });
    } catch (e) {
      console.log('[FocusPulse Main] Error updating play/pause button:', e);
    }
  },

  applyStopWidgetUpdate() {
    const target = widgets.btnStopWidget || this.btnStopWidget;
    if (!target) return;
    try {
      target.setProperty(hmUI.prop.MORE, {
        x: 26,
        y: 376,
        w: 140,
        h: 42,
        radius: 21,
        normal_color: 0x1c1c1e,
        press_color: 0x2c2c2e,
        text: '⏹ Stop',
        color: 0xff453a,
        text_size: 15,
      });
    } catch (e) {
      console.log('[FocusPulse Main] Error updating stop button:', e);
    }
  },

  applyTimerWidgetsUpdate() {
    const timerTarget = widgets.timerTextWidget || this.timerTextWidget;
    if (timerTarget) {
      updateWidgetText(timerTarget, this.formatTime(this.state.secondsRemaining));
    }
    const subTarget = widgets.subStatusWidget || this.subStatusWidget;
    if (subTarget) {
      updateWidgetText(subTarget, this.computeStatusText());
    }
    this.updateArcDisplay();
  },

  togglePlayPause() {
    if (this.state.timerRunning) {
      this.pauseTimer();
    } else {
      this.startTimer();
    }
  },

  startTimer() {
    if (this.state.pendingTransitionTimer) {
      stopSafeTimer(this.state.pendingTransitionTimer);
      this.state.pendingTransitionTimer = null;
      if (this.state.currentMode === 'WORK') {
        this.state.currentMode = 'REST';
      } else {
        this.state.currentMode = 'WORK';
      }
    }
    const totalSecs = (this.state.currentMode === 'WORK' ? this.state.workDuration : this.state.restDuration) * 60;
    if (!this.state.secondsRemaining || this.state.secondsRemaining <= 0) {
      this.state.secondsRemaining = totalSecs;
    }
    this.state.timerRunning = true;
    this.state.isPaused = false;
    this.state.lastTickTimestamp = new Date().getTime();
    setScreenKeepState(true);
    this.applyPlayPauseWidgetUpdate();
    this.applyTimerWidgetsUpdate();
    this.syncToGlobal();
    this.startTimerInterval();
  },

  pauseTimer() {
    this.state.timerRunning = false;
    this.state.isPaused = true;
    this.state.lastTickTimestamp = 0;
    setScreenKeepState(false);
    this.clearInterval();
    this.applyPlayPauseWidgetUpdate();
    this.applyTimerWidgetsUpdate();
    this.syncToGlobal();
  },

  stopTimer() {
    this.clearInterval();
    if (this.state.pendingTransitionTimer) {
      stopSafeTimer(this.state.pendingTransitionTimer);
      this.state.pendingTransitionTimer = null;
      if (this.state.currentMode === 'WORK') {
        this.state.currentMode = 'REST';
      } else {
        this.state.currentMode = 'WORK';
      }
    }
    const totalSecs = (this.state.currentMode === 'WORK' ? this.state.workDuration : this.state.restDuration) * 60;
    this.state.secondsRemaining = totalSecs;
    this.state.timerRunning = false;
    this.state.isPaused = false;
    this.state.lastTickTimestamp = 0;
    setScreenKeepState(false);

    this.state.lastRenderedAngle = -999;
    this.applyPlayPauseWidgetUpdate();
    this.applyStopWidgetUpdate();
    this.applyTimerWidgetsUpdate();
    this.syncToGlobal();
  },

  startTimerInterval() {
    this.clearInterval();
    if (!this.state.lastTickTimestamp || this.state.lastTickTimestamp <= 0) {
      this.state.lastTickTimestamp = new Date().getTime();
    }
    this.state.timerHandle = createSafeTimer(1000, 1000, () => {
      this.tick();
    });
  },

  clearInterval() {
    if (this.state.timerHandle) {
      stopSafeTimer(this.state.timerHandle);
      this.state.timerHandle = null;
    }
  },

  tick() {
    if (!this.state.timerRunning) return;

    const now = new Date().getTime();
    if (!this.state.lastTickTimestamp || this.state.lastTickTimestamp <= 0) {
      this.state.lastTickTimestamp = now;
      return;
    }

    const elapsedMs = now - this.state.lastTickTimestamp;
    if (elapsedMs < 1000) {
      return;
    }

    const elapsedSec = Math.floor(elapsedMs / 1000);
    if (now < this.state.lastTickTimestamp || elapsedMs > 86400000) {
      this.state.lastTickTimestamp = now;
    } else {
      this.state.lastTickTimestamp += elapsedSec * 1000;
    }
    this.tickCount = (this.tickCount || 0) + elapsedSec;

    if (this.state.secondsRemaining > 0) {
      this.state.secondsRemaining = Math.max(0, this.state.secondsRemaining - elapsedSec);
    }

    // Direct fast property update for timer display (uses hmUI.prop.MORE on Zepp OS 1.0)
    const timerTarget = widgets.timerTextWidget || this.timerTextWidget;
    if (timerTarget) {
      updateWidgetText(timerTarget, this.formatTime(this.state.secondsRemaining));
    }

    // Efficient ARC progress update (only redraws on degree change)
    this.updateArcDisplay();

    // Sample real PPG hardware heart rate sensor every 3 seconds to guarantee live skin detection
    if (this.tickCount % 3 === 0) {
      this.readHeartRateSensor(false);
    }

    // Low-frequency BLE sanity check (every 10 seconds) without stalling the 1-second tick bus
    if (this.tickCount % 10 === 0 && typeof hmBle !== 'undefined' && typeof hmBle.connectStatus === 'function') {
      try {
        const isConnected = hmBle.connectStatus();
        if (isConnected !== this.state.bleConnected) {
          this.state.bleConnected = isConnected;
          this.updateConnectionDisplay();
        }
      } catch (e) {}
    }

    this.syncToGlobal();

    // Check timer completion (00:00 reached)
    if (this.state.secondsRemaining <= 0) {
      this.onTimerComplete();
    }
  },

  onTimerComplete() {
    this.clearInterval();
    this.state.timerRunning = false;
    this.state.isPaused = false;
    this.state.secondsRemaining = 0;
    this.state.lastTickTimestamp = 0;
    setScreenKeepState(false);

    // Trigger vibration on countdown completion
    this.triggerVibration(24);

    const timerTarget = widgets.timerTextWidget || this.timerTextWidget;
    if (timerTarget) {
      updateWidgetText(timerTarget, '00:00');
    }
    const subTarget = widgets.subStatusWidget || this.subStatusWidget;
    if (subTarget) {
      updateWidgetText(
        subTarget,
        this.state.currentMode === 'WORK' ? 'DONE! TAKE A BREAK' : 'BREAK OVER! TIME TO FOCUS'
      );
    }

    this.applyPlayPauseWidgetUpdate();

    const globalData = getGlobalData();

    if (this.state.currentMode === 'WORK') {
      globalData.completedSessions = (globalData.completedSessions !== undefined ? globalData.completedSessions : 4) + 1;
      globalData.totalFocusSeconds = (globalData.totalFocusSeconds !== undefined ? globalData.totalFocusSeconds : (135 * 60)) + (this.state.workDuration * 60);
    }

    // Delay mode UI switch by 1.2s using safe native timer
    this.state.pendingTransitionTimer = createSafeTimer(1200, 0, () => {
      this.state.pendingTransitionTimer = null;
      if (this.state.currentMode === 'WORK') {
        this.state.currentMode = 'REST';
        globalData.currentMode = 'REST';
        this.state.secondsRemaining = this.state.restDuration * 60;
        globalData.secondsRemaining = this.state.secondsRemaining;
      } else {
        this.state.currentMode = 'WORK';
        globalData.currentMode = 'WORK';
        this.state.secondsRemaining = this.state.workDuration * 60;
        globalData.secondsRemaining = this.state.secondsRemaining;
      }

      this.applyModeTheme();
      this.applyPlayPauseWidgetUpdate();
      this.applyTimerWidgetsUpdate();

      const streakTarget = widgets.streakWidget || this.streakWidget;
      if (streakTarget) {
        const completed = globalData.completedSessions !== undefined ? globalData.completedSessions : 4;
        updateWidgetText(streakTarget, `🔥 Session ${(completed % 4) + 1} of 4`);
      }
      this.syncToGlobal();
    });
  },

  applyModeTheme() {
    const isWork = this.state.currentMode === 'WORK';
    const color = isWork ? 0x0a84ff : 0x30d158;
    const label = isWork ? 'FOCUS' : 'REST';

    const headerTarget = widgets.headerModeWidget || this.headerModeWidget;
    if (headerTarget) {
      try {
        if (typeof hmUI !== 'undefined' && hmUI.prop && hmUI.prop.MORE !== undefined) {
          headerTarget.setProperty(hmUI.prop.MORE, {
            text: label,
            color: color,
          });
        } else {
          updateWidgetText(headerTarget, label, color);
        }
      } catch (e) {
        updateWidgetText(headerTarget, label, color);
      }
    }

    this.state.lastRenderedAngle = -999;
    this.updateArcDisplay();

    const timerTarget = widgets.timerTextWidget || this.timerTextWidget;
    if (timerTarget) {
      updateWidgetText(timerTarget, this.formatTime(this.state.secondsRemaining));
    }
  },

  updateControlsDisplay() {
    this.applyPlayPauseWidgetUpdate();
    const subTarget = widgets.subStatusWidget || this.subStatusWidget;
    if (subTarget) {
      updateWidgetText(subTarget, this.computeStatusText());
    }
  },

  syncToGlobal() {
    const globalData = getGlobalData();
    globalData.timerRunning = this.state.timerRunning;
    globalData.isPaused = this.state.isPaused;
    globalData.secondsRemaining = this.state.secondsRemaining;
    globalData.currentMode = this.state.currentMode;
    globalData.lastBpm = this.state.bpm;
    globalData.isLiveHeartRate = this.state.isLiveHeartRate;
    globalData.bleConnected = this.state.bleConnected;
    globalData.workDuration = this.state.workDuration;
    globalData.restDuration = this.state.restDuration;
    const now = Date.now();
    globalData.lastTimestamp = now;
    globalData.lastActiveTimestamp = now;
  },

  triggerVibration(scene) {
    if (this.vibrator) {
      try {
        this.vibrator.stop();
        this.vibrator.scene = scene;
        this.vibrator.start();
      } catch (e) {
        console.log('[FocusPulse Main] Vibration error:', e);
      }
    }
  },

  formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${pad(mins)}:${pad(secs)}`;
  },

  onDestroy() {
    console.log('[FocusPulse Main] Destroying Main page');
    setScreenKeepState(false);
    this.clearInterval();
    if (this.telemetryInterval) {
      try {
        clearInterval(this.telemetryInterval);
      } catch (e) {
        console.log('[FocusPulse Main] Error clearing telemetry interval:', e);
      }
      this.telemetryInterval = null;
    }
    if (this.state.pendingTransitionTimer) {
      stopSafeTimer(this.state.pendingTransitionTimer);
      this.state.pendingTransitionTimer = null;
      if (this.state.currentMode === 'WORK') {
        this.state.currentMode = 'REST';
        this.state.secondsRemaining = this.state.restDuration * 60;
      } else {
        this.state.currentMode = 'WORK';
        this.state.secondsRemaining = this.state.workDuration * 60;
      }
    }
    this.syncToGlobal();

    // Clean up BLE listener
    if (typeof hmBle !== 'undefined' && typeof hmBle.removeListener === 'function') {
      try {
        hmBle.removeListener();
      } catch (e) {}
    }

    // Clean up peerSocket listener
    if (typeof messaging !== 'undefined' && messaging.peerSocket && this.peerSocketCallback) {
      try {
        if (typeof messaging.peerSocket.removeListener === 'function') {
          messaging.peerSocket.removeListener('message', this.peerSocketCallback);
        } else if (typeof messaging.peerSocket.off === 'function') {
          messaging.peerSocket.off('message', this.peerSocketCallback);
        }
      } catch (e) {}
      this.peerSocketCallback = null;
    }

    // Clean up heart rate sensor and event listeners to prevent memory leaks
    if (this.heartSensor) {
      try {
        if (typeof this.heartSensor.removeEventListener === 'function' && this.heartSensorCallback) {
          const eventType = (hmSensor.event && hmSensor.event.CHANGE !== undefined) ? hmSensor.event.CHANGE : 0;
          this.heartSensor.removeEventListener(eventType, this.heartSensorCallback);
        }
        if (typeof this.heartSensor.offCurrentChange === 'function' && this.heartSensorCallback) {
          this.heartSensor.offCurrentChange(this.heartSensorCallback);
        }
        if (typeof hmSensor !== 'undefined' && typeof hmSensor.deleteSensor === 'function') {
          hmSensor.deleteSensor(this.heartSensor);
        }
      } catch (e) {
        console.log('[FocusPulse Main] Heart sensor cleanup error:', e);
      }
      this.heartSensor = null;
      this.heartSensorCallback = null;
    }

    // Clean up vibrator instance
    if (this.vibrator) {
      try {
        this.vibrator.stop();
        if (typeof hmSensor !== 'undefined' && typeof hmSensor.deleteSensor === 'function') {
          hmSensor.deleteSensor(this.vibrator);
        }
      } catch (e) {}
      this.vibrator = null;
    }

    // Reset widget registry references to prevent dangling pointer access
    widgets.headerModeWidget = null;
    widgets.bpmWidget = null;
    widgets.connWidget = null;
    widgets.trackArcWidget = null;
    widgets.progressArcWidget = null;
    widgets.timerTextWidget = null;
    widgets.subStatusWidget = null;
    widgets.streakWidget = null;
    widgets.btnPlayPauseWidget = null;
    widgets.btnStopWidget = null;
    widgets.btnSettingsWidget = null;
    widgets.btnStatsWidget = null;
  },
});

