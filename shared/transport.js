// Bounded single-packet subset of Zepp's official MessageBuilder wire protocol.
// Reference: zepp-health/zeppos-samples/application/1.0/todo-list/shared/message.js
// Zepp adds/removes the 16-byte routing header at the phone boundary.
const APP_ID = 1000005;
const LIMIT = 3400;
let port = 0;
let sequence = 1;
let active = false;
let receive = null;
let lastShake = 0;
function bytes(value, size) {
  if (!value) return new Uint8Array(0);
  const buf = value.data || value;
  const view = buf instanceof ArrayBuffer ? new Uint8Array(buf) :
    (buf.buffer ? new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength) : new Uint8Array(buf));
  return size === undefined ? view : view.subarray(0, size);
}
export function encodeMessage(message) {
  // ASCII JSON escapes avoid a TextEncoder/Buffer polyfill on the watch.
  const json = JSON.stringify(message).replace(/[\u007f-\uffff]/g, function (ch) {
    return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
  });
  if (json.length > LIMIT) throw new Error('Message too large');
  const result = new Uint8Array(66 + json.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, sequence++, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, json.length, true);
  view.setUint32(20, json.length, true);
  view.setUint8(24, 3); // Notify
  view.setUint8(25, 1); // Finished
  view.setUint32(26, Date.now() % 10000000, true);
  view.setUint8(54, 2); // JSON
  for (let i = 0; i < json.length; i++) result[66 + i] = json.charCodeAt(i);
  return result.buffer;
}
export function encodePeerPacket(message, peerPort = 20) {
  const payload = encodeMessage(message);
  const data = bytes(payload);
  const result = new Uint8Array(16 + data.length);
  const view = new DataView(result.buffer);
  result[0] = 1;
  result[1] = 1;
  view.setUint16(2, 4, true); // type = Data (4)
  view.setUint16(4, 20, true);
  view.setUint16(6, peerPort || 20, true);
  view.setUint32(8, APP_ID, true);
  result.set(data, 16);
  return result.buffer;
}
export function decodeMessage(value) {
  if (value && typeof value === 'object' && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
    if (value.type) return value;
    if (value.data && typeof value.data === 'object' && value.data.type) return value.data;
  }
  let data = bytes(value);
  if (data.length >= 82 && data[0] === 1 && data[1] === 1) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (dv.getUint32(8, true) === APP_ID) {
      data = data.subarray(16);
    }
  }
  if (data.length < 66 || data.length > LIMIT + 66) throw new Error('Invalid packet');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = data.length - 66;
  if (view.getUint32(12, true) !== 1 || view.getUint32(16, true) !== length ||
      view.getUint32(20, true) !== length || data[24] !== 3 || data[25] !== 1 || data[54] !== 2) {
    throw new Error('Invalid message envelope');
  }
  let text = '';
  if (typeof TextDecoder !== 'undefined') {
    text = new TextDecoder('utf-8').decode(data.subarray(66));
  } else {
    for (let i = 66; i < data.length; i++) text += String.fromCharCode(data[i]);
  }
  return JSON.parse(text);
}
function frame(type, payload) {
  const data = bytes(payload);
  const result = new Uint8Array(16 + data.length);
  const view = new DataView(result.buffer);
  result[0] = 1;
  result[1] = 1;
  view.setUint16(2, type, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, port, true);
  view.setUint32(8, APP_ID, true);
  result.set(data, 16);
  return result.buffer;
}
function sendFrame(type, payload) {
  const packet = frame(type, payload);
  return hmBle.send(packet, packet.byteLength) !== false;
}
function handshake(force) {
  if (!force && Date.now() - lastShake < 2000) return;
  lastShake = Date.now();
  sendFrame(1, new Uint8Array([APP_ID & 255]).buffer);
}
export function startDeviceTransport(onMessage) {
  stopDeviceTransport();
  receive = onMessage;
  if (typeof hmBle === 'undefined' || typeof hmBle.createConnect !== 'function') return false;
  try {
    if (typeof hmBle.addListener === 'function') {
      try {
        hmBle.addListener(function (status) {
          if (status === false || status === 0) {
            port = 0;
            lastShake = 0;
            const state = (typeof getApp === 'function' && getApp()._options && getApp()._options.globalData) || globalThis.__FOCUSPULSE_GLOBAL__;
            if (state) {
              state.bleConnected = false;
              state.cloudSynced = false;
              if (typeof globalThis.__FOCUSPULSE_CONNECTION__ === 'function') globalThis.__FOCUSPULSE_CONNECTION__();
            }
          } else if (status === true || status === 1) {
            handshake(true);
          }
        });
      } catch (_e) {}
    }
    hmBle.createConnect(function (_index, value, size) {
      try {
        const data = bytes(value, size);
        if (data.length < 16) return;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (data[0] === 1 && data[1] === 1 && view.getUint32(8, true) === APP_ID) {
          const type = view.getUint16(2, true);
          if (type === 1) {
            const p = (view.getUint16(6, true) && view.getUint16(6, true) !== 20 ? view.getUint16(6, true) : view.getUint16(4, true)) || view.getUint16(6, true) || 1;
            if (p) port = p;
            const state = (typeof getApp === 'function' && getApp() && getApp()._options && getApp()._options.globalData) || globalThis.__FOCUSPULSE_GLOBAL__;
            if (state) {
              state.bleConnected = true;
              if (typeof globalThis.__FOCUSPULSE_CONNECTION__ === 'function') globalThis.__FOCUSPULSE_CONNECTION__();
            }
            if (typeof globalThis.__FOCUSPULSE_SEND_TELEMETRY__ === 'function') {
              try { globalThis.__FOCUSPULSE_SEND_TELEMETRY__(); } catch (_e) {}
            }
          } else if (type === 4 || type === 5) {
            const incomingPort = (view.getUint16(6, true) && view.getUint16(6, true) !== 20 ? view.getUint16(6, true) : view.getUint16(4, true)) || view.getUint16(6, true);
            if (incomingPort) port = incomingPort;
            else if (!port) port = 1;
            const state = (typeof getApp === 'function' && getApp() && getApp()._options && getApp()._options.globalData) || globalThis.__FOCUSPULSE_GLOBAL__;
            if (state && !state.bleConnected) {
              state.bleConnected = true;
              if (typeof globalThis.__FOCUSPULSE_CONNECTION__ === 'function') globalThis.__FOCUSPULSE_CONNECTION__();
            }
            if (receive) receive(decodeMessage(data.subarray(16)));
          }
        } else if (data.length >= 66) {
          try {
            const msg = decodeMessage(data);
            const state = (typeof getApp === 'function' && getApp() && getApp()._options && getApp()._options.globalData) || globalThis.__FOCUSPULSE_GLOBAL__;
            if (state && !state.bleConnected) {
              state.bleConnected = true;
              if (typeof globalThis.__FOCUSPULSE_CONNECTION__ === 'function') globalThis.__FOCUSPULSE_CONNECTION__();
            }
            if (!port) port = 1;
            if (receive) receive(msg);
          } catch (_e) {}
        }
      } catch (_error) {}
    });
    active = true;
    handshake(true);
    return true;
  } catch (_error) { active = false; return false; }
}
export function sendDeviceMessage(message) {
  if (!active) return false;
  try {
    if (typeof hmBle.connectStatus === 'function') {
      const s = hmBle.connectStatus();
      if (s === false || s === 0) {
        port = 0;
        lastShake = 0;
        const state = (typeof getApp === 'function' && getApp()._options && getApp()._options.globalData) || globalThis.__FOCUSPULSE_GLOBAL__;
        if (state) {
          state.bleConnected = false;
          state.cloudSynced = false;
          if (typeof globalThis.__FOCUSPULSE_CONNECTION__ === 'function') globalThis.__FOCUSPULSE_CONNECTION__();
        }
        return false;
      }
    }
    if (!port) { handshake(); return false; }
    return sendFrame(4, encodeMessage(message));
  } catch (_error) { return false; }
}
export function stopDeviceTransport() {
  if (active && typeof hmBle !== 'undefined') {
    try { if (port) sendFrame(2, new Uint8Array([APP_ID & 255]).buffer); } catch (_e) {}
    try { hmBle.disConnect(); } catch (_e) {}
  }
  active = false;
  port = 0;
  lastShake = 0;
  receive = null;
}
