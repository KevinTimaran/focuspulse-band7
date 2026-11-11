import { startDeviceTransport, stopDeviceTransport, sendDeviceMessage } from './shared/transport';
const initial = {
  workDuration:25, restDuration:5, completedSessions:0, totalFocusSeconds:0,
  currentMode:'WORK',timerRunning:false,isPaused:false,secondsRemaining:1500,
  lastBpm:null,isLiveHeartRate:false,measuredAt:0,bleConnected:false,cloudSynced:false,
  syncError:'',aiRecommendation:'',lastVerdictId:'',lastTimestamp:0,lastAckAt:0,
};
App({
  globalData:initial,
  onCreate() {
    const gd=this.globalData || initial;
    this.globalData=gd;
    this._options=this._options || {};
    this._options.globalData=gd;
    globalThis.__FOCUSPULSE_GLOBAL__=gd;
    startDeviceTransport((data)=>{
      if (!data || typeof data !== 'object') return;
      gd.bleConnected=true;
      if (data.type==='PONG') {
        gd.bleConnected=true;
        gd.cloudSynced=data.cloudSynced === true;
        gd.syncError=data.error || '';
        gd.lastAckAt=Date.now();
      } else if (data.type==='AI_VERDICT' && typeof data.id === 'string' &&
          typeof data.verdict === 'string' && data.verdict.length>0 && data.verdict.length<=160 &&
          typeof data.timestamp === 'number' && Date.now()-data.timestamp >= -5000 &&
          Date.now()-data.timestamp <= 300000) {
        if (gd.lastVerdictId !== data.id) {
          gd.lastVerdictId=data.id;
          gd.aiRecommendation=data.verdict;
          if (typeof globalThis.__FOCUSPULSE_AI__ === 'function') globalThis.__FOCUSPULSE_AI__(data.verdict);
        }
        sendDeviceMessage({type:'AI_ACK',id:data.id,timestamp:Date.now()});
      }
      if (typeof globalThis.__FOCUSPULSE_CONNECTION__ === 'function') globalThis.__FOCUSPULSE_CONNECTION__();
    });
  },
  onDestroy() { stopDeviceTransport(); },
});
