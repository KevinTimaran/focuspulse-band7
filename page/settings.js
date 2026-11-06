/**
 * FocusPulse Smartwatch App - Zepp OS 1.0 (Xiaomi Smart Band 7)
 * Page: Settings (page/settings.js)
 * Screen: 192 x 490 pixels (Pure OLED Black)
 */

function getGlobalData() {
  let app = null;
  try {
    if (typeof getApp === 'function') {
      app = getApp();
    }
  } catch (e) {
    console.log('[FocusPulse Settings] getApp error:', e);
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
  },

  vibrator: null,
  workValueWidget: null,
  restValueWidget: null,
  summaryWidget: null,

  build() {
    console.log('[FocusPulse Settings] Building Settings Page');

    // 1. Sync global state
    const globalData = getGlobalData();
    this.state.workDuration = globalData.workDuration || 25;
    this.state.restDuration = globalData.restDuration || 5;

    // 2. Initialize Vibrate sensor
    try {
      if (typeof hmSensor !== 'undefined' && hmSensor.id && hmSensor.id.VIBRATE) {
        this.vibrator = hmSensor.createSensor(hmSensor.id.VIBRATE);
      }
    } catch (e) {
      console.log('[FocusPulse Settings] Error creating vibrator:', e);
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
      text: 'SETTINGS',
    });

    // 4. Section 1: Work Time (5 to 60 mins in steps of 5)
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 16,
      y: 60,
      w: 160,
      h: 20,
      color: 0x0a84ff,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: '⚡ Work Time',
    });

    // Work Time Minus Button (-)
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 20,
      y: 84,
      w: 46,
      h: 46,
      radius: 23,
      normal_color: 0x1c1c1e,
      press_color: 0x2c2c2e,
      text: '-',
      color: 0xffffff,
      text_size: 26,
      click_func: () => {
        this.triggerVibration(23);
        this.changeWorkTime(-5);
      },
    });

    // Work Time Prominent Display
    this.workValueWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 68,
      y: 84,
      w: 56,
      h: 46,
      color: 0xffffff,
      text_size: 22,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: `${this.state.workDuration}m`,
    });

    // Work Time Plus Button (+)
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 126,
      y: 84,
      w: 46,
      h: 46,
      radius: 23,
      normal_color: 0x1c1c1e,
      press_color: 0x2c2c2e,
      text: '+',
      color: 0xffffff,
      text_size: 26,
      click_func: () => {
        this.triggerVibration(23);
        this.changeWorkTime(5);
      },
    });

    // 5. Section 2: Rest Time (1 to 30 mins in steps of 1)
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 16,
      y: 148,
      w: 160,
      h: 20,
      color: 0x30d158,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: '☕ Rest Time',
    });

    // Rest Time Minus Button (-)
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 20,
      y: 174,
      w: 46,
      h: 46,
      radius: 23,
      normal_color: 0x1c1c1e,
      press_color: 0x2c2c2e,
      text: '-',
      color: 0xffffff,
      text_size: 26,
      click_func: () => {
        this.triggerVibration(23);
        this.changeRestTime(-1);
      },
    });

    // Rest Time Prominent Display
    this.restValueWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 68,
      y: 174,
      w: 56,
      h: 46,
      color: 0xffffff,
      text_size: 22,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.NONE,
      text: `${this.state.restDuration}m`,
    });

    // Rest Time Plus Button (+)
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 126,
      y: 174,
      w: 46,
      h: 46,
      radius: 23,
      normal_color: 0x1c1c1e,
      press_color: 0x2c2c2e,
      text: '+',
      color: 0xffffff,
      text_size: 26,
      click_func: () => {
        this.triggerVibration(23);
        this.changeRestTime(1);
      },
    });

    // 6. Summary Card
    this.summaryWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 10,
      y: 236,
      w: 172,
      h: 44,
      color: 0x8e8e93,
      text_size: 13,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: (hmUI.text_style && hmUI.text_style.WRAP) || hmUI.text_style.NONE,
      text: `Cycle Plan:\n${this.state.workDuration} min work • ${this.state.restDuration} min rest`,
    });

    // 7. Preset Button (25m / 5m default)
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: 28,
      y: 296,
      w: 136,
      h: 36,
      radius: 18,
      normal_color: 0x1c1c1e,
      press_color: 0x2c2c2e,
      text: 'Default 25 / 5',
      color: 0x8e8e93,
      text_size: 13,
      click_func: () => {
        this.triggerVibration(23);
        this.state.workDuration = 25;
        this.state.restDuration = 5;
        this.updateDisplays();
        this.persistData();
      },
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
        this.persistData();
        this.navigateBack();
      },
    });
  },

  changeWorkTime(delta) {
    const next = Math.max(5, Math.min(60, this.state.workDuration + delta));
    this.state.workDuration = next;
    this.updateDisplays();
    this.persistData();
  },

  changeRestTime(delta) {
    const next = Math.max(1, Math.min(30, this.state.restDuration + delta));
    this.state.restDuration = next;
    this.updateDisplays();
    this.persistData();
  },

  updateDisplays() {
    if (this.workValueWidget) {
      this.workValueWidget.setProperty(hmUI.prop.MORE, {
        text: `${this.state.workDuration}m`,
      });
    }
    if (this.restValueWidget) {
      this.restValueWidget.setProperty(hmUI.prop.MORE, {
        text: `${this.state.restDuration}m`,
      });
    }
    if (this.summaryWidget) {
      this.summaryWidget.setProperty(hmUI.prop.MORE, {
        text: `Cycle Plan:\n${this.state.workDuration} min work • ${this.state.restDuration} min rest`,
      });
    }
  },

  persistData() {
    const globalData = getGlobalData();
    globalData.workDuration = this.state.workDuration;
    globalData.restDuration = this.state.restDuration;

    if (!globalData.timerRunning || globalData.isPaused) {
      if (globalData.currentMode === 'REST') {
        globalData.secondsRemaining = this.state.restDuration * 60;
      } else {
        globalData.secondsRemaining = this.state.workDuration * 60;
      }
    } else {
      // Deduct elapsed time since last active anchor if timer was running
      const anchor = globalData.lastActiveTimestamp || globalData.lastTimestamp;
      if (anchor && anchor > 0) {
        const elapsed = Math.floor((Date.now() - anchor) / 1000);
        if (elapsed > 0) {
          globalData.secondsRemaining = Math.max(0, globalData.secondsRemaining - elapsed);
        }
      }
      // If timer is running, ensure remaining time doesn't exceed new duration
      const maxSeconds = (globalData.currentMode === 'REST' ? this.state.restDuration : this.state.workDuration) * 60;
      if (globalData.secondsRemaining > maxSeconds) {
        globalData.secondsRemaining = maxSeconds;
      }
    }
    const now = Date.now();
    globalData.lastTimestamp = now;
    globalData.lastActiveTimestamp = now;
    console.log('[FocusPulse Settings] Persisted work:', globalData.workDuration, 'rest:', globalData.restDuration);
  },

  navigateBack() {
    try {
      if (typeof hmApp !== 'undefined' && typeof hmApp.goBack === 'function') {
        hmApp.goBack();
      } else {
        hmApp.gotoPage({ url: 'page/index', file: 'page/index' });
      }
    } catch (e) {
      console.log('[FocusPulse Settings] goBack failed, falling back to gotoPage:', e);
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
        console.log('[FocusPulse Settings] Vibration error:', e);
      }
    }
  },

  onDestroy() {
    console.log('[FocusPulse Settings] Page destroyed');
    this.persistData();
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
