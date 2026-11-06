/**
 * FocusPulse Smartwatch App - Zepp OS 1.0 (Xiaomi Smart Band 7)
 * App Entry Point: app.js
 */

const defaultGlobalData = {
  workDuration: 25, // default 25 minutes
  restDuration: 5,  // default 5 minutes
  completedSessions: 4, // initial streak placeholder
  totalFocusSeconds: 135 * 60, // initial total time: 2h 15m
  currentMode: 'WORK', // 'WORK' | 'REST'
  timerRunning: false,
  isPaused: false,
  secondsRemaining: 25 * 60,
  lastBpm: 75,
  isLiveHeartRate: false,
  bleConnected: false,
  aiRecommendation: 'AI: Heart rate spiked 20%.\nTake a 10 min break.',
  lastTimestamp: 0,
};

App({
  globalData: defaultGlobalData,

  onCreate(options) {
    console.log('[FocusPulse Band7] App initialized on Xiaomi Smart Band 7');
    if (!this._options) this._options = {};
    if (!this._options.globalData) {
      this._options.globalData = this.globalData || defaultGlobalData;
    }
    this.globalData = this._options.globalData;
    globalThis.__FOCUSPULSE_GLOBAL__ = this._options.globalData;

    // Check BLE Connection to iPhone / Companion App
    try {
      if (typeof hmBle !== 'undefined') {
        if (typeof hmBle.connectStatus === 'function') {
          this.globalData.bleConnected = hmBle.connectStatus();
          console.log('[FocusPulse BLE] Initial connection status:', this.globalData.bleConnected);
        }
        if (typeof hmBle.addListener === 'function') {
          hmBle.addListener((status) => {
            console.log('[FocusPulse BLE] Connection status changed:', status);
            this.globalData.bleConnected = !!status;
          });
        }
      }
    } catch (e) {
      console.log('[FocusPulse BLE] Error initializing hmBle:', e);
    }
  },

  onDestroy(options) {
    console.log('[FocusPulse Band7] App destroyed');
    try {
      if (typeof hmBle !== 'undefined' && typeof hmBle.removeListener === 'function') {
        hmBle.removeListener();
      }
    } catch (e) {}
  },
});