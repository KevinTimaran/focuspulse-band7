/**
 * FocusPulse Smartwatch App - Zepp OS 1.0 (Xiaomi Smart Band 7)
 * Page: Stats (page/stats.js)
 * Screen: 192 x 490 pixels (Pure OLED Black)
 */

// Global reference to messaging.peerSocket listener callback to prevent QuickJS memory leaks on Xiaomi Smart Band 7
let peerSocketCallback = null;
globalThis.__STATS_PEERSOCKET_CB__ = null;

function getGlobalData() {
  let app = null;
  try {
    if (typeof getApp === 'function') {
      app = getApp();
    }
  } catch (e) {
    console.log('[FocusPulse Stats] getApp error:', e);
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

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

Page({
  state: {
    completedSessions: 4,
    totalFocusSeconds: 135 * 60,
    aiMessage: 'AI: Heart rate spiked 20%.\nTake a 10 min break.',
  },

  vibrator: null,

  build() {
    console.log('[FocusPulse Stats] Building Stats & AI Page');
    this._isDestroyed = false;

    // 1. Read global state
    const globalData = getGlobalData();
    this.state.completedSessions = globalData.completedSessions !== undefined ? globalData.completedSessions : 4;
    this.state.totalFocusSeconds = globalData.totalFocusSeconds !== undefined ? globalData.totalFocusSeconds : (135 * 60);
    if (globalData.aiRecommendation) {
      this.state.aiMessage = globalData.aiRecommendation;
    }

    // 2. Initialize Vibrate sensor
    try {
      if (typeof hmSensor !== 'undefined' && hmSensor.id && hmSensor.id.VIBRATE) {
        this.vibrator = hmSensor.createSensor(hmSensor.id.VIBRATE);
      }
    } catch (e) {
      console.log('[FocusPulse Stats] Error creating vibrator:', e);
    }

    // 3. Header Title (fitted within capsule curvature at y: 30)
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 28,
      y: 30,
      w: 136,
      h: 26,
      color: 0x8e8e93,
      text_size: 16,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: 'STATISTICS',
    });

    // 4. Daily Streak Card
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 16,
      y: 60,
      w: 160,
      h: 20,
      color: 0x8e8e93,
      text_size: 13,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: 'Daily Streak',
    });

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 16,
      y: 82,
      w: 160,
      h: 30,
      color: 0xff9f0a,
      text_size: 19,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: `🔥 ${this.state.completedSessions} Sessions`,
    });

    // 5. Total Time Card
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: 120,
      w: 192,
      h: 20,
      color: 0x8e8e93,
      text_size: 13,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: 'Total Focus Time',
    });

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: 142,
      w: 192,
      h: 30,
      color: 0x64d2ff,
      text_size: 19,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: `⏱️ ${formatDuration(this.state.totalFocusSeconds)}`,
    });

    // 6. AI Verdict Card
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: 188,
      w: 192,
      h: 22,
      color: 0xbf5af2,
      text_size: 13,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: '⚡ AI PULSE VERDICT',
    });

    // Multi-line AI response block
    this.aiTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 12,
      y: 216,
      w: 168,
      h: 88,
      color: 0xffffff,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: (hmUI.text_style && hmUI.text_style.WRAP) || hmUI.text_style.NONE,
      text: this.state.aiMessage,
    });

    // Initialize real-time AI verdict receiver from companion
    this.initMessaging();

    // 7. Biometric & Phone Link Status
    const isConn = !!globalData.bleConnected;
    const isLiveHr = !!globalData.isLiveHeartRate;
    const syncStatusText = `📱 iPhone: ${isConn ? 'OK' : '--'} • HR: ${isLiveHr ? 'LIVE' : 'SIM'}`;
    const syncColor = isConn ? 0x30d158 : 0x8e8e93;

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: 316,
      w: 192,
      h: 20,
      color: syncColor,
      text_size: 11,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: syncStatusText,
    });

    // 8. Back Button at bottom (positioned safely within curvature)
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 24,
      y: 368,
      w: 144,
      h: 48,
      radius: 24,
      normal_color: 0x0a84ff,
      press_color: 0x0055b3,
      text: '⬅ Back',
      color: 0xffffff,
      text_size: 16,
      click_func: () => {
        this.triggerVibration(23);
        this.navigateBack();
      },
    });
  },

  navigateBack() {
    try {
      if (typeof hmApp !== 'undefined' && typeof hmApp.goBack === 'function') {
        hmApp.goBack();
      } else {
        hmApp.gotoPage({ url: 'page/index', file: 'page/index' });
      }
    } catch (e) {
      console.log('[FocusPulse Stats] goBack failed, falling back to gotoPage:', e);
      try {
        hmApp.gotoPage({ url: 'page/index', file: 'page/index' });
      } catch (err) {}
    }
  },

  triggerVibration(scene) {
    if (this.vibrator) {
      try {
        this.vibrator.stop();
        this.vibrator.scene = scene;
        this.vibrator.start();
      } catch (e) {
        console.log('[FocusPulse Stats] Vibration error:', e);
      }
    }
  },

  initMessaging() {
    try {
      if (typeof messaging !== 'undefined' && messaging.peerSocket) {
        // Remove existing listener before re-registering to prevent duplicate listeners
        const existingCb = peerSocketCallback || globalThis.__STATS_PEERSOCKET_CB__;
        if (existingCb) {
          try {
            if (typeof messaging.peerSocket.removeListener === 'function') {
              messaging.peerSocket.removeListener('message', existingCb);
            } else if (typeof messaging.peerSocket.off === 'function') {
              messaging.peerSocket.off('message', existingCb);
            } else if (typeof messaging.peerSocket.removeEventListener === 'function') {
              messaging.peerSocket.removeEventListener('message', existingCb);
            }
          } catch (e) {}
        }
        if (typeof messaging.peerSocket.addListener === 'function') {
          const self = this;
          peerSocketCallback = (payload) => {
            if (self._isDestroyed || !self.aiTextWidget) return;
            try {
              let data = payload;
              if (typeof payload === 'string') {
                try {
                  data = JSON.parse(payload);
                } catch (e) {
                  data = null;
                }
              }
              if (data && data.type === 'AI_VERDICT' && data.verdict) {
                const newText = String(data.verdict);
                self.state.aiMessage = newText;
                const gd = getGlobalData();
                gd.aiRecommendation = newText;
                if (self.aiTextWidget && typeof self.aiTextWidget.setProperty === 'function') {
                  self.aiTextWidget.setProperty(hmUI.prop.MORE, { text: newText });
                }
                console.log('[FocusPulse Stats] Live AI verdict displayed on screen:', newText);
              }
            } catch (err) {}
          };
          globalThis.__STATS_PEERSOCKET_CB__ = peerSocketCallback;
          this.messageCallback = peerSocketCallback;
          messaging.peerSocket.addListener('message', peerSocketCallback);
        }
      }
    } catch (e) {
      console.log('[FocusPulse Stats] Messaging init error:', e);
    }
  },

  onDestroy() {
    console.log('[FocusPulse Stats] Page destroyed');
    this._isDestroyed = true;

    // Explicitly remove messaging.peerSocket listener to prevent QuickJS memory crashes on Xiaomi Smart Band 7
    const cb = peerSocketCallback || globalThis.__STATS_PEERSOCKET_CB__;
    if (typeof messaging !== 'undefined' && messaging.peerSocket && cb) {
      try {
        if (typeof messaging.peerSocket.removeListener === 'function') {
          messaging.peerSocket.removeListener('message', cb);
        } else if (typeof messaging.peerSocket.off === 'function') {
          messaging.peerSocket.off('message', cb);
        } else if (typeof messaging.peerSocket.removeEventListener === 'function') {
          messaging.peerSocket.removeEventListener('message', cb);
        }
      } catch (e) {
        console.log('[FocusPulse Stats] Error removing peerSocket listener:', e);
      }
      peerSocketCallback = null;
      globalThis.__STATS_PEERSOCKET_CB__ = null;
      this.messageCallback = null;
    }

    this.aiTextWidget = null;

    if (this.vibrator) {
      try {
        this.vibrator.stop();
        if (typeof hmSensor !== 'undefined' && typeof hmSensor.deleteSensor === 'function') {
          hmSensor.deleteSensor(this.vibrator);
        }
      } catch (e) {}
      this.vibrator = null;
    }
  },
});
