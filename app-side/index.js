import { gettext } from 'i18n'

/**
 * ============================================================================
 * FocusPulse Cloud Bridge - Zepp OS Companion Service (iOS / Android)
 * ============================================================================
 * Bypasses iOS sandbox limitations by synchronizing Xiaomi Smart Band 7
 * biometrics and timer telemetry with Firebase Realtime Database over HTTPS REST.
 *
 * User Configuration:
 * Replace FIREBASE_DATABASE_URL with your Firebase project Realtime Database URL:
 * e.g. 'https://<YOUR-PROJECT-ID>-default-rtdb.firebaseio.com'
 */
const FIREBASE_DATABASE_URL = 'https://focuspulse-default-rtdb.firebaseio.com';

let lastSentVerdict = '';
let aiPollTimer = null;

/**
 * Safe REST dispatcher compatible with both WHATWG fetch and Zepp OS options object
 */
function sendFirebaseRest(url, method, data) {
  if (typeof fetch === 'undefined') {
    return Promise.reject(new Error('fetch API not available in companion runtime'));
  }

  const options = {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };

  if (data !== undefined && data !== null && method !== 'GET') {
    options.body = typeof data === 'string' ? data : JSON.stringify(data);
  }

  // 1. Standard WHATWG fetch(url, options)
  try {
    const res = fetch(url, options);
    if (res && typeof res.then === 'function') {
      return res.then((r) => {
        if (r && typeof r.json === 'function') return r.json();
        if (r && typeof r.text === 'function') return r.text();
        return r;
      });
    }
  } catch (e) {
    // 2. Zepp OS proprietary object parameter style: fetch({ url, method, headers, body })
    try {
      const zeppOptions = Object.assign({ url: url }, options);
      const res2 = fetch(zeppOptions);
      if (res2 && typeof res2.then === 'function') {
        return res2.then((r) => {
          if (r && typeof r.json === 'function') return r.json();
          if (r && typeof r.text === 'function') return r.text();
          return r;
        });
      }
    } catch (e2) {
      console.log('[FocusPulse SideService] REST fetch failed:', e2);
      return Promise.reject(e2);
    }
  }
  return Promise.resolve(null);
}

/**
 * Sends a message object to the Smart Band 7 via peerSocket
 */
function sendToBand(messageObj) {
  try {
    if (typeof messaging !== 'undefined' && messaging.peerSocket) {
      if (messaging.peerSocket.readyState === 1 && typeof messaging.peerSocket.send === 'function') {
        const payloadStr = JSON.stringify(messageObj);
        messaging.peerSocket.send(payloadStr);
        return true;
      }
    }
  } catch (err) {
    console.log('[FocusPulse SideService] Error sending to Band 7:', err);
  }
  return false;
}

/**
 * Polls Firebase Realtime Database for new AI Focus Coach recommendations
 */
function pollAiVerdict() {
  if (!FIREBASE_DATABASE_URL || FIREBASE_DATABASE_URL.includes('placeholder')) {
    return;
  }
  const endpoint = `${FIREBASE_DATABASE_URL}/session/aiVerdict.json`;
  sendFirebaseRest(endpoint, 'GET')
    .then((verdict) => {
      if (typeof verdict === 'string' && verdict.trim().length > 0 && verdict !== lastSentVerdict) {
        lastSentVerdict = verdict;
        console.log('[FocusPulse SideService] New AI verdict fetched from cloud:', verdict);
        sendToBand({
          type: 'AI_VERDICT',
          verdict: verdict,
          timestamp: Date.now(),
        });
      }
    })
    .catch((err) => {
      // Quietly ignore background poll network errors
    });
}

AppSideService({
  onInit() {
    console.log('[FocusPulse SideService] Initialized companion bridge service');
    try {
      if (typeof messaging !== 'undefined' && messaging.peerSocket) {
        messaging.peerSocket.addListener('message', (payload) => {
          try {
            let data = payload;
            if (typeof payload === 'string') {
              try {
                data = JSON.parse(payload);
              } catch (e) {
                data = { raw: payload };
              }
            } else if (payload && payload.toString) {
              try {
                data = JSON.parse(payload.toString('utf-8'));
              } catch (e) {}
            }

            console.log('[FocusPulse SideService] Received message from Band 7:', JSON.stringify(data));

            // Handle incoming telemetry from Smart Band 7
            if (data && (data.type === 'TELEMETRY_PING' || data.bpm !== undefined)) {
              // 1. Forward biometrics to Firebase Realtime Database
              if (FIREBASE_DATABASE_URL && !FIREBASE_DATABASE_URL.includes('placeholder')) {
                const patchUrl = `${FIREBASE_DATABASE_URL}/session.json`;
                const cloudTelemetry = {
                  bpm: data.bpm || 0,
                  isLive: !!data.isLiveHeartRate,
                  bleConnected: true,
                  timerRunning: !!data.timerRunning,
                  secondsRemaining: data.secondsRemaining !== undefined ? data.secondsRemaining : 0,
                  currentMode: data.currentMode || 'WORK',
                  updatedAt: Date.now(),
                };

                sendFirebaseRest(patchUrl, 'PATCH', cloudTelemetry)
                  .then(() => {
                    console.log('[FocusPulse SideService] Patched telemetry to Firebase RTDB');
                  })
                  .catch((err) => {
                    console.log('[FocusPulse SideService] Firebase patch warning:', err);
                  });
              }

              // 2. Reply ACK to watch
              sendToBand({
                type: 'PONG',
                device: 'iPhone Companion',
                cloudSynced: true,
                timestamp: Date.now(),
              });
            }
          } catch (err) {
            console.log('[FocusPulse SideService] Error handling incoming message:', err);
          }
        });
      }
    } catch (e) {
      console.log('[FocusPulse SideService] Messaging listener init error:', e);
    }

    // Start 10-second polling interval for AI verdicts from Cloud Bridge
    try {
      if (typeof setInterval === 'function') {
        aiPollTimer = setInterval(pollAiVerdict, 10000);
      }
    } catch (e) {
      console.log('[FocusPulse SideService] Polling interval setup error:', e);
    }
  },

  onRun() {
    console.log('[FocusPulse SideService] Companion service running');
    // Immediate initial poll on run
    pollAiVerdict();
  },

  onDestroy() {
    console.log('[FocusPulse SideService] Companion service destroyed');
    if (aiPollTimer) {
      try {
        clearInterval(aiPollTimer);
      } catch (e) {}
      aiPollTimer = null;
    }
  },
});
