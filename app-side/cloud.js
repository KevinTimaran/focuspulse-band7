// Zepp fetch accepts one options object and returns {status, body}.
// Never log passwords, tokens, authenticated URLs or raw telemetry.
const DEFAULT_DB_URL = 'https://focuspulse-dd0f9-default-rtdb.firebaseio.com';
const DEFAULT_API_KEY = 'AIzaSyBGSGy0jdUBmNcjokNOa3UpcEkK_qU-6rQ';
export function createCloudBridge({ request, storage, send, now = () => Date.now() }) {
  let auth = null, authTask = null, busy = false, polling = false;
  let generation = 0, destroyed = false, lastSample = 0, acknowledgedId = '';
  let pendingTelemetry = null;
  function get(key) {
    if (!storage || typeof storage.getItem !== 'function') return '';
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined || raw === '') return '';
    if (typeof raw === 'object' && raw !== null) {
      const inner = raw.value !== undefined ? raw.value : raw.name;
      if (inner !== undefined) return key === 'password' ? String(inner) : String(inner).trim();
      return '';
    }
    if (typeof raw === 'string') {
      try {
        const value = JSON.parse(raw);
        if (typeof value === 'string') return key === 'password' ? value : value.trim();
        if (typeof value === 'number') return String(value);
        if (typeof value === 'object' && value !== null) {
          const inner = value.value !== undefined ? value.value : value.name;
          if (inner !== undefined) return key === 'password' ? String(inner) : String(inner).trim();
          return '';
        }
      } catch (_e) {}
      return key === 'password' ? raw : raw.trim();
    }
    return '';
  }
  function config() {
    let rawUrl = (get('databaseUrl') || '').replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.(?:firebaseio\.com|(?:[a-z0-9-]+\.)?firebasedatabase\.app)$/.test(rawUrl)) {
      rawUrl = DEFAULT_DB_URL;
    }
    const url = rawUrl;
    let apiKey = get('apiKey') || DEFAULT_API_KEY;
    if (apiKey === '[object Object]' || apiKey.trim().length === 0) apiKey = DEFAULT_API_KEY;
    const email = get('email'), password = get('password');
    if (!apiKey || !email || !password || email === '[object Object]' || password === '[object Object]') throw new Error('CONFIG');
    return { url, apiKey, email, password };
  }
  async function rest(url, method, data) {
    let timeoutHandle;
    const timeout = new Promise((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('NETWORK')), 12000);
    });
    let response;
    try {
      response = await Promise.race([request({url, method, headers: {'Content-Type': 'application/json'},
        ...(data === undefined ? {} : {body: JSON.stringify(data)})}), timeout]);
    } finally { clearTimeout(timeoutHandle); }
    if (!response || typeof response !== 'object') throw new Error('NETWORK');
    let body;
    try {
      body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    } catch (_e) {
      body = response.body;
    }
    const status = response.status || response.statusCode;
    if ((status && (status < 200 || status >= 300)) || (body && body.error)) {
      const isAuthError = status === 401 || status === 403 ||
        url.includes('identitytoolkit.googleapis.com') ||
        (body && body.error && (typeof body.error === 'string' ? body.error.includes('denied') || body.error.includes('auth') :
          body.error.message === 'INVALID_PASSWORD' || body.error.message === 'EMAIL_NOT_FOUND' || body.error.message === 'INVALID_LOGIN_CREDENTIALS'));
      throw new Error(isAuthError ? 'AUTH' : 'NETWORK');
    }
    return body;
  }
  async function login(cfg) {
    if (auth && auth.expiresAt > now() + 60000) return auth;
    if (authTask) return authTask;
    const version = generation;
    authTask = rest('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' +
      encodeURIComponent(cfg.apiKey), 'POST', {email:cfg.email,password:cfg.password,returnSecureToken:true})
      .then((result) => {
        if (version !== generation || destroyed) throw new Error('CANCELLED');
        if (!result.idToken || !result.localId) throw new Error('AUTH');
        auth = {token:result.idToken,uid:result.localId,expiresAt:now()+Number(result.expiresIn || 3600)*1000};
        return auth;
      }).finally(() => { if (version === generation) authTask = null; });
    return authTask;
  }
  async function endpoint() {
    const cfg = config(), session = await login(cfg);
    return {base:cfg.url+'/users/'+encodeURIComponent(session.uid)+'/devices/band7',
      query:'.json?auth='+encodeURIComponent(session.token)};
  }
  function validSample(data) {
    return data.isLiveHeartRate === true && typeof data.bpm === 'number' &&
      Number.isInteger(data.bpm) && data.bpm >= 25 && data.bpm <= 240 &&
      typeof data.measuredAt === 'number' && now()-data.measuredAt >= -5000 && now()-data.measuredAt <= 30000;
  }
  function integer(value, fallback, min = 0, max = Infinity) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
  async function telemetry(data) {
    if (destroyed) return;
    if (busy) {
      pendingTelemetry = data;
      return;
    }
    busy = true;
    const version = generation;
    try {
      const link = await endpoint();
      if (version !== generation || destroyed) return;
      const live = validSample(data), sampleTime = live ? data.measuredAt : 0;
      const session = {
        bpm:live ? data.bpm : null,isLive:live,measuredAt:sampleTime,updatedAt:{'.sv':'timestamp'},bleConnected:true,
        timerRunning:!!data.timerRunning,isPaused:!!data.isPaused,
        secondsRemaining:integer(data.secondsRemaining,0,0,3600),currentMode:data.currentMode === 'REST' ? 'REST' : 'WORK',
        workDuration:integer(data.workDuration,25,1,60),restDuration:integer(data.restDuration,5,1,30),
        completedSessions:integer(data.completedSessions,0,0,1000000),totalFocusSeconds:integer(data.totalFocusSeconds,0,0,1000000000),
      };
      const patch = {session};
      if (live && sampleTime !== lastSample) patch['readings/'+sampleTime] = {bpm:data.bpm,measuredAt:sampleTime,isLive:true};
      await rest(link.base+link.query,'PATCH',patch);
      if (version !== generation || destroyed) return;
      if (live) lastSample = sampleTime;
      send({type:'PONG',cloudSynced:true,timestamp:now()});
    } catch (error) {
      if (version !== generation || destroyed) return;
      if (error.message === 'AUTH') auth = null;
      send({type:'PONG',cloudSynced:false,error:error.message === 'CONFIG' || error.message === 'AUTH' ? error.message : 'SYNC',timestamp:now()});
    } finally {
      if (version === generation) {
        busy = false;
        if (pendingTelemetry && !destroyed) {
          const next = pendingTelemetry;
          pendingTelemetry = null;
          telemetry(next);
        }
      }
    }
  }
  async function poll() {
    if (polling || destroyed) return;
    polling = true;
    const version = generation;
    try {
      const link = await endpoint();
      if (version !== generation || destroyed) return;
      const verdict = await rest(link.base+'/aiVerdict'+link.query,'GET');
      if (version !== generation || destroyed) return;
      if (verdict && typeof verdict.id === 'string' && verdict.id !== acknowledgedId &&
        typeof verdict.verdict === 'string' && verdict.verdict.length > 0 && verdict.verdict.length <= 160 &&
        typeof verdict.createdAt === 'number' && now()-verdict.createdAt >= -5000 && now()-verdict.createdAt <= 300000) {
        send({type:'AI_VERDICT',id:verdict.id,verdict:verdict.verdict,timestamp:verdict.createdAt});
      }
    } catch (error) { if (error.message === 'AUTH' && version === generation) auth = null; }
    finally { if (version === generation) polling = false; }
  }
  function reset() { generation++; auth=null;authTask=null;busy=false;polling=false;lastSample=0;acknowledgedId='';pendingTelemetry=null; }
  return {
    receive(data) {
      if (!data || destroyed) return;
      if (data.type === 'TELEMETRY_PING') return telemetry(data);
      if (data.type === 'AI_ACK' && typeof data.id === 'string') acknowledgedId = data.id;
    },
    poll, reset,
    destroy() { destroyed=true;reset(); },
  };
}
