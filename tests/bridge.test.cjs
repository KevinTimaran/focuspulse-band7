const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function moduleAt(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const now = 1700000000000;
function setup(failPatch = false) {
  const calls = [], sent = [];
  const values = {databaseUrl:'https://focuspulse-default-rtdb.firebaseio.com',apiKey:'public-test-key',email:'test@example.com',password:'test'};
  const request = async (options) => {
    calls.push(options);
    if (options.url.includes('signInWithPassword')) return {status:200,body:JSON.stringify({idToken:'test-token',localId:'user-1',expiresIn:'3600'})};
    if (options.method === 'PATCH') return failPatch ? {status:403,body:{error:'denied'}} : {status:200,body:{}};
    return {status:200,body:{id:'advice-1',verdict:'Haz una pausa breve.',createdAt:now}};
  };
  return {calls,sent, options:{request,storage:{getItem:key=>values[key]},send:message=>{sent.push(message);return true;},now:()=>now}};
}
const telemetry = {type:'TELEMETRY_PING',bpm:72,isLiveHeartRate:true,measuredAt:now,workDuration:25,restDuration:5,secondsRemaining:1500};
test('wire encoding round-trips Spanish and rejects corruption/oversize',async()=>{
  const wire = await moduleAt('shared/transport.js');
  const message = {type:'AI_VERDICT',verdict:'Respira y descansa: concentración. 🫀'};
  assert.deepEqual(wire.decodeMessage(wire.encodeMessage(message)),message);
  const broken = new Uint8Array(wire.encodeMessage(message)); broken[25]=0;
  assert.throws(()=>wire.decodeMessage(broken));
  assert.throws(()=>wire.encodeMessage({text:'x'.repeat(4000)}));
});
test('device waits for handshake; wraps binary payload and receives routed advice',async()=>{
  const wire = await moduleAt('shared/transport.js');
  let callback; const sent=[], received=[];
  global.hmBle={createConnect:cb=>{callback=cb;},send:buf=>{sent.push(buf);return true;},connectStatus:()=>true,disConnect:()=>{}};
  assert.equal(wire.startDeviceTransport(m=>received.push(m)),true);
  assert.equal(wire.sendDeviceMessage(telemetry),false);
  const shake = new Uint8Array(sent[0].slice(0));
  new DataView(shake.buffer).setUint16(6,42,true);
  callback(0,shake.buffer,shake.length);
  assert.equal(wire.sendDeviceMessage(telemetry),true);
  assert.deepEqual(wire.decodeMessage(new Uint8Array(sent[1]).subarray(16)),telemetry);
  callback(0,sent[1],sent[1].byteLength);
  assert.deepEqual(received,[telemetry]);
  wire.stopDeviceTransport(); delete global.hmBle;
});
test('cloud ACK happens after successful write, history only once per measurement',async()=>{
  const {createCloudBridge}=await moduleAt('app-side/cloud.js');
  const env=setup(), bridge=createCloudBridge(env.options);
  await bridge.receive(telemetry);
  await bridge.receive(telemetry);
  const patches=env.calls.filter(c=>c.method==='PATCH').map(c=>JSON.parse(c.body));
  assert.ok(patches[0]['readings/'+now]);
  assert.equal(patches[1]['readings/'+now],undefined);
  assert.equal(patches[0].session.isLive,true);
  assert.deepEqual(patches[0].session.updatedAt,{'.sv':'timestamp'});
  assert.equal(env.sent[0].cloudSynced,true);
  assert.equal(env.calls.filter(c=>c.url.includes('signInWithPassword')).length,1);
});
test('failed Firebase write is never acknowledged as cloud-synced',async()=>{
  const {createCloudBridge}=await moduleAt('app-side/cloud.js');
  const env=setup(true); await createCloudBridge(env.options).receive(telemetry);
  assert.equal(env.sent[0].cloudSynced,false);
});
test('cached, missing, simulated and future BPM become null and do not enter history',async()=>{
  const {createCloudBridge}=await moduleAt('app-side/cloud.js');
  for(const extra of [{isLiveHeartRate:false},{bpm:null},{measuredAt:now-31000},{measuredAt:now+6000},{bpm:NaN}]) {
    const env=setup(); await createCloudBridge(env.options).receive({...telemetry,...extra});
    const patch=JSON.parse(env.calls.find(c=>c.method==='PATCH').body);
    assert.equal(patch.session.bpm,null);assert.equal(patch.session.isLive,false);
    assert.deepEqual(Object.keys(patch),['session']);
  }
});
test('AI advice retries until watch acknowledges its id',async()=>{
  const {createCloudBridge}=await moduleAt('app-side/cloud.js');
  const env=setup(), bridge=createCloudBridge(env.options);
  await bridge.poll(); await bridge.poll();
  assert.equal(env.sent.length,2);
  bridge.receive({type:'AI_ACK',id:'advice-1'}); await bridge.poll();
  assert.equal(env.sent.length,2);
  bridge.destroy(); await bridge.poll();assert.equal(env.sent.length,2);
});
test('cloudBridge handles object wrapped and JSON serialized storage values',async()=>{
  const {createCloudBridge}=await moduleAt('app-side/cloud.js');
  const values = {
    databaseUrl: JSON.stringify('https://focuspulse-default-rtdb.firebaseio.com/'),
    apiKey: { value: 'public-test-key' },
    email: ' test@example.com ',
    password: { value: 'secretPass' }
  };
  const calls = [];
  const request = async (options) => {
    calls.push(options);
    if (options.url.includes('signInWithPassword')) return {status:200,body:JSON.stringify({idToken:'tok',localId:'uid1',expiresIn:'3600'})};
    return {status:200,body:{}};
  };
  const bridge = createCloudBridge({
    request,
    storage: { getItem: (k) => values[k] },
    send: () => true,
    now: () => now
  });
  await bridge.receive(telemetry);
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
});
test('transport marks bleConnected on incoming data packets',async()=>{
  const wire = await moduleAt('shared/transport.js');
  let callback; const sent = [], received = [];
  const state = { bleConnected: false, cloudSynced: false };
  global.getApp = () => ({ _options: { globalData: state } });
  let notified = false;
  global.__FOCUSPULSE_CONNECTION__ = () => { notified = true; };
  global.hmBle = {
    createConnect: cb => { callback = cb; },
    send: buf => { sent.push(buf); return true; },
    connectStatus: () => true,
    disConnect: () => {}
  };
  assert.equal(wire.startDeviceTransport(m => received.push(m)), true);
  // Handshake
  const shake = new Uint8Array(sent[0].slice(0));
  new DataView(shake.buffer).setUint16(6, 42, true);
  callback(0, shake.buffer, shake.length);
  assert.equal(state.bleConnected, true);

  // Simulate disconnected state in global data
  state.bleConnected = false;
  notified = false;

  // Incoming data packet (type 4) should restore bleConnected to true
  const dataPacket = sent[0].slice(0);
  const dv = new DataView(dataPacket);
  dv.setUint16(2, 4, true); // type = 4
  dv.setUint16(4, 42, true); // src port
  dv.setUint16(6, 20, true); // dst port
  const payloadMsg = wire.encodeMessage({ type: 'PONG', cloudSynced: true, timestamp: now });
  const fullPacket = new Uint8Array(16 + payloadMsg.byteLength);
  fullPacket.set(new Uint8Array(dataPacket.slice(0, 16)), 0);
  fullPacket.set(new Uint8Array(payloadMsg), 16);
  callback(0, fullPacket.buffer, fullPacket.byteLength);

  assert.equal(state.bleConnected, true);
  assert.equal(notified, true);
  wire.stopDeviceTransport();
  delete global.hmBle;
  delete global.getApp;
  delete global.__FOCUSPULSE_CONNECTION__;
});
test('cloudBridge detects signInWithPassword HTTP 400 as AUTH error and signals AUTH to watch',async()=>{
  const {createCloudBridge}=await moduleAt('app-side/cloud.js');
  const sent = [], calls = [];
  const request = async (options) => {
    calls.push(options);
    if (options.url.includes('signInWithPassword')) {
      return { status: 400, body: JSON.stringify({ error: { code: 400, message: 'INVALID_PASSWORD' } }) };
    }
    return { status: 200, body: {} };
  };
  const bridge = createCloudBridge({
    request,
    storage: { getItem: k => ({ databaseUrl: 'https://focuspulse-default-rtdb.firebaseio.com', apiKey: 'key', email: 'test@example.com', password: 'wrong' }[k]) },
    send: msg => { sent.push(msg); return true; },
    now: () => now,
  });
  await bridge.receive(telemetry);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cloudSynced, false);
  assert.equal(sent[0].error, 'AUTH');
});
test('cloudBridge queues pending telemetry while busy and flushes latest state without dropping updates',async()=>{
  const {createCloudBridge}=await moduleAt('app-side/cloud.js');
  const patches = [], sent = [];
  let resolveFirst;
  const firstPromise = new Promise(r => { resolveFirst = r; });
  let patchCount = 0;
  const request = async (options) => {
    if (options.url.includes('signInWithPassword')) return { status: 200, body: JSON.stringify({ idToken: 'tok', localId: 'uid1', expiresIn: '3600' }) };
    if (options.method === 'PATCH') {
      patchCount++;
      if (patchCount === 1) await firstPromise;
      patches.push(JSON.parse(options.body));
      return { status: 200, body: {} };
    }
    return { status: 200, body: {} };
  };
  const bridge = createCloudBridge({
    request,
    storage: { getItem: k => ({ databaseUrl: 'https://focuspulse-default-rtdb.firebaseio.com', apiKey: 'key', email: 'test@example.com', password: 'pass' }[k]) },
    send: msg => { sent.push(msg); return true; },
    now: () => now,
  });

  // First telemetry starts (is blocked on firstPromise)
  const p1 = bridge.receive({ ...telemetry, timerRunning: false });
  // Second telemetry arrives while first is in-flight
  const p2 = bridge.receive({ ...telemetry, timerRunning: true, secondsRemaining: 1400 });

  // Unblock first write
  resolveFirst();
  await Promise.all([p1, p2]);

  assert.equal(patches.length, 2, 'both writes completed');
  assert.equal(patches[0].session.timerRunning, false);
  assert.equal(patches[1].session.timerRunning, true);
  assert.equal(patches[1].session.secondsRemaining, 1400);
});
test('transport handshake force bypasses cooldown on BLE connection event',async()=>{
  const wire = await moduleAt('shared/transport.js');
  let addListenerCb; const sent = [];
  global.hmBle = {
    createConnect: () => {},
    send: buf => { sent.push(buf); return true; },
    addListener: cb => { addListenerCb = cb; },
    connectStatus: () => true,
    disConnect: () => {}
  };
  wire.startDeviceTransport(() => {});
  const countAfterStart = sent.length; // 1 (initial handshake)
  assert.ok(countAfterStart >= 1);

  // Immediate connection event (t < 2000ms)
  addListenerCb(1);
  assert.equal(sent.length, countAfterStart + 1, 'handshake was dispatched on connect event without cooldown rejection');

  wire.stopDeviceTransport();
  delete global.hmBle;
});
test('encodePeerPacket formats 16-byte routing header with APP_ID for companion transmission',async()=>{
  const wire = await moduleAt('shared/transport.js');
  const message = { type: 'PONG', cloudSynced: true, timestamp: now };
  const packet = wire.encodePeerPacket(message);
  assert.ok(packet instanceof ArrayBuffer);
  const view = new DataView(packet);
  const data = new Uint8Array(packet);
  assert.equal(data[0], 1, 'flag is 1');
  assert.equal(data[1], 1, 'version is 1');
  assert.equal(view.getUint16(2, true), 4, 'type is Data (4)');
  assert.equal(view.getUint32(8, true), 1000005, 'appId is 1000005');
  assert.deepEqual(wire.decodeMessage(packet), message, 'decodeMessage unwraps the 16-byte framed packet');
});
test('decodeMessage handles 16-byte-framed buffer, unwrapped buffer, and parsed objects transparently',async()=>{
  const wire = await moduleAt('shared/transport.js');
  const message = { type: 'AI_VERDICT', verdict: 'Tómate un respiro', timestamp: now };
  const rawEnvelope = wire.encodeMessage(message);
  const framedPacket = wire.encodePeerPacket(message);

  // Unwrapped 66-byte buffer
  assert.deepEqual(wire.decodeMessage(rawEnvelope), message);
  // Framed 16-byte + 66-byte buffer
  assert.deepEqual(wire.decodeMessage(framedPacket), message);
  // Pre-parsed object
  assert.deepEqual(wire.decodeMessage(message), message);
  // Wrapped inside { data: message }
  assert.deepEqual(wire.decodeMessage({ data: message }), message);
});
test('cloudBridge rejects unrecognized object storage values and falls back cleanly without [object Object]',async()=>{
  const {createCloudBridge}=await moduleAt('app-side/cloud.js');
  const sent = [];
  const bridge = createCloudBridge({
    request: async () => ({ status: 200, body: {} }),
    storage: { getItem: () => ({}) }, // empty object without .value or .name
    send: msg => { sent.push(msg); return true; },
    now: () => now,
  });
  await bridge.receive(telemetry);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cloudSynced, false);
  assert.equal(sent[0].error, 'CONFIG');
});


