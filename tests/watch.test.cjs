const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../page/index.js'),'utf8')
  .replace(/^import .*;\s*$/m,'');
function harness(wearValue=1){
  let page;const widgets=[],vibrations=[],sent=[];
  const state={workDuration:25,restDuration:5,completedSessions:0,totalFocusSeconds:0,
    currentMode:'WORK',timerRunning:false,isPaused:false,secondsRemaining:1500,
    lastBpm:null,isLiveHeartRate:false,measuredAt:0,bleConnected:false,cloudSynced:false,aiRecommendation:''};
  const heart={current:0,event:{CURRENT:7},addEventListener(_event,cb){this.cb=cb;},removeEventListener(){}};
  const wear={current:wearValue};
  const vibrator={stop(){},start(){vibrations.push(this.scene);}};
  const context={
    Page(value){page=value;},getApp(){return {globalData:state}},
    hmSensor:{id:{HEART:1,WEAR:2,VIBRATE:3},createSensor(id){return id===1?heart:id===2?wear:vibrator;},deleteSensor(){}},
    hmUI:{widget:{TEXT:1,ARC:2,BUTTON:3},align:{CENTER_H:0,CENTER_V:0},text_style:{NONE:0},prop:{MORE:4},
      createWidget(kind,props){const widget={kind,props:{...props},setProperty(_key,newProps){Object.assign(this.props,newProps);}};widgets.push(widget);return widget;}},
    hmApp:{gotoPage(){},goBack(){}},sendDeviceMessage(message){sent.push(message);return true;},
    timer:{createTimer(){return 1;},stopTimer(){}},globalThis:{},Date,Math,Number,String,isFinite,
  };
  vm.runInNewContext(source,context);
  page.build();
  return {page,state,heart,wear,widgets,vibrations,sent};
}
test('watch starts with no BPM; physical CURRENT event alone marks it live',()=>{
  const h=harness();
  assert.equal(h.state.lastBpm,null);
  assert.match(h.widgets.find(w=>w.props.text==='Buscando señal…').props.text,/Buscando señal/);
  assert.equal(typeof h.heart.cb,'function');
  assert.equal(h.sent[0].bpm,null);
  h.heart.current=79;h.heart.cb();
  assert.equal(h.state.lastBpm,79);
  assert.equal(h.state.isLiveHeartRate,true);
  assert.equal(h.widgets.find(w=>w.props.text==='79 BPM').props.text,'79 BPM');
  assert.equal(h.widgets.find(w=>w.props.text==='25:00').props.text,'25:00');
  h.widgets.find(w=>w.props.text==='25:00').props.click_func();
  assert.equal(h.state.timerRunning,true,'tapping the displayed timer starts it');
  h.page.toggleTimer();
  h.page.sendTelemetry();assert.equal(h.sent.at(-1).bpm,79);
  h.wear.current=0;h.page.tick();h.page.sendTelemetry();
  assert.equal(h.sent.at(-1).bpm,null);
  assert.equal(h.state.lastBpm,null);
  h.page.onDestroy();
});
test('invalid reading never becomes live; all main actions provide haptic feedback',()=>{
  const h=harness();h.heart.current=0;h.heart.cb();assert.equal(h.state.lastBpm,null);
  h.heart.current=500;h.heart.cb();assert.equal(h.state.lastBpm,null);
  const action=h.widgets.find(w=>w.props.text==='Iniciar');action.props.click_func();
  assert.equal(h.state.timerRunning,true);assert.equal(h.vibrations.at(-1),23);
  assert.equal(action.props.text,'Pausar sesión');
  action.props.click_func();assert.equal(h.state.isPaused,true);
  assert.equal(action.props.text,'Reanudar');
  h.page.onDestroy();
});
test('touch controls remain inside 192x490 with at least 46px height',()=>{
  const h=harness();
  for(const w of h.widgets.filter(w=>w.kind===3)){
    assert.ok(w.props.x>=0&&w.props.y>=0&&w.props.x+w.props.w<=192&&w.props.y+w.props.h<=490);
    assert.ok(w.props.w>=46&&w.props.h>=46);
  }
  h.page.onDestroy();
});
test('settings needs a second tap to reset the cycle without erasing completed work',()=>{
  const settings=fs.readFileSync(path.join(__dirname,'../page/settings.js'),'utf8');
  let page;const widgets=[];
  const state={workDuration:25,restDuration:5,currentMode:'REST',secondsRemaining:100,
    timerRunning:true,isPaused:false,completedSessions:4,totalFocusSeconds:6000};
  vm.runInNewContext(settings,{Page:p=>page=p,getApp:()=>({globalData:state}),Date,
    hmSensor:{id:{VIBRATE:1},createSensor:()=>({stop(){},start(){}}),deleteSensor(){}},
    hmUI:{widget:{TEXT:1,BUTTON:2},align:{CENTER_H:0,CENTER_V:0},text_style:{NONE:0},prop:{MORE:4},
      createWidget(kind,props){const w={kind,props,setProperty(_key,value){Object.assign(props,value);}};widgets.push(w);return w;}},
    hmApp:{goBack(){},gotoPage(){}}});
  page.build();
  const work=widgets.find(w=>w.props.text==='25 min');
  assert.ok(work,'work duration is visible on first render');
  work.props.click_func();assert.equal(state.workDuration,30);
  assert.equal(work.props.text,'30 min','tapping the value adjusts it');
  const reset=widgets.find(w=>w.props.text==='Reiniciar ciclo');
  reset.props.click_func();assert.equal(state.currentMode,'REST');assert.equal(state.timerRunning,true);
  reset.props.click_func();assert.equal(state.currentMode,'WORK');assert.equal(state.timerRunning,false);
  assert.equal(state.secondsRemaining,1800);assert.equal(state.completedSessions,4);
  assert.equal(state.totalFocusSeconds,6000);page.onDestroy();
});
test('transient send failure does not wipe bleConnected; consecutive failures mark disconnected and recovery restores link',()=>{
  let sendResult = true;
  let page;const widgets=[],sent=[];
  const state={workDuration:25,restDuration:5,completedSessions:0,totalFocusSeconds:0,
    currentMode:'WORK',timerRunning:false,isPaused:false,secondsRemaining:1500,
    lastBpm:75,isLiveHeartRate:true,measuredAt:Date.now(),bleConnected:true,cloudSynced:false,aiRecommendation:''};
  const heart={current:75,event:{CURRENT:7},addEventListener(_event,cb){this.cb=cb;},removeEventListener(){}};
  const wear={current:1};
  const vibrator={stop(){},start(){}};
  const context={
    Page(value){page=value;},getApp(){return {globalData:state}},
    hmSensor:{id:{HEART:1,WEAR:2,VIBRATE:3},createSensor(id){return id===1?heart:id===2?wear:vibrator;},deleteSensor(){}},
    hmUI:{widget:{TEXT:1,ARC:2,BUTTON:3},align:{CENTER_H:0,CENTER_V:0},text_style:{NONE:0},prop:{MORE:4},
      createWidget(kind,props){const widget={kind,props:{...props},setProperty(_key,newProps){Object.assign(this.props,newProps);}};widgets.push(widget);return widget;}},
    hmApp:{gotoPage(){},goBack(){}},sendDeviceMessage(message){sent.push(message);return sendResult;},
    timer:{createTimer(){return 1;},stopTimer(){}},globalThis:{},Date,Math,Number,String,isFinite,
  };
  vm.runInNewContext(source,context);
  page.build();
  assert.equal(state.bleConnected, true);
  const linkWidget = widgets.find(w => w.props.y === 190);
  assert.equal(linkWidget.props.text, 'Zepp conectado · sincronizando');

  // 1 transient failure should not immediately disconnect bleConnected
  sendResult = false;
  page.sendTelemetry();
  assert.equal(state.bleConnected, true);
  assert.equal(linkWidget.props.text, 'Zepp conectado · sincronizando');

  // Next successful send keeps it connected
  sendResult = true;
  page.sendTelemetry();
  assert.equal(state.bleConnected, true);
  assert.equal(linkWidget.props.text, 'Zepp conectado · sincronizando');

  // 3 consecutive failures transitions to disconnected
  sendResult = false;
  page.sendTelemetry(); // 1
  assert.equal(state.bleConnected, true);
  page.sendTelemetry(); // 2
  assert.equal(state.bleConnected, true);
  page.sendTelemetry(); // 3
  assert.equal(state.bleConnected, false);
  assert.equal(linkWidget.props.text, 'Sin enlace con Zepp');

  // Recovery: when a send succeeds again, bleConnected recovers
  sendResult = true;
  page.sendTelemetry();
  assert.equal(state.bleConnected, true);
  assert.equal(linkWidget.props.text, 'Zepp conectado · sincronizando');
  page.onDestroy();
});
test('auth and config errors display "Configura cuenta en Zepp" on linkWidget',()=>{
  const h = harness();
  h.state.bleConnected = true;
  const linkWidget = h.widgets.find(w => w.props.y === 190);

  // CONFIG error
  h.state.syncError = 'CONFIG';
  h.page.tick(false);
  assert.equal(linkWidget.props.text, 'Configura cuenta en Zepp');
  assert.equal(linkWidget.props.color, 0xffc857, 'amber color on configuration error');

  // AUTH error
  h.state.syncError = 'AUTH';
  h.page.tick(false);
  assert.equal(linkWidget.props.text, 'Configura cuenta en Zepp');
  assert.equal(linkWidget.props.color, 0xffc857, 'amber color on authentication error');

  // Cleared / synced
  h.state.syncError = '';
  h.state.cloudSynced = true;
  h.state.lastAckAt = Date.now();
  h.page.tick(false);
  assert.equal(linkWidget.props.text, 'Zepp + nube conectados');
  assert.equal(linkWidget.props.color, 0x44e4aa, 'green color on cloud sync');

  h.page.onDestroy();
});


