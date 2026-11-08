import {expect,test} from 'vitest';
import {createTennisAim} from '../shared/tennisAim.js';
import {normalizeNativeGyroscope,normalizeWebMotion,DEG_TO_RAD} from '../shared/motion.js';
import {isSwing,isGameCommand,isGameOptions,isStrokeResult} from '../shared/protocol.js';
import {checkpoint} from './profiles/validation.js';

function trace(controller,adapter=normalizeNativeGyroscope) {
  let index=0;
  return (rate,count=1,extra={})=>{
    let result;
    for(let i=0;i<count;i++) {
      const timeSeconds=index++/60;
      const reading=adapter===normalizeWebMotion ? {rotationRate:{alpha:rate.x/DEG_TO_RAD,beta:rate.y/DEG_TO_RAD,gamma:rate.z/DEG_TO_RAD}} : rate;
      result=controller.push(adapter(reading,{timeSeconds,sequence:index,...extra}));
    }
    return result;
  };
}

test('tennis freezes deliberate pointing before a fast swing through recognition and follow-through',()=>{
  const aim=createTennisAim(),push=trace(aim);
  push({x:0,y:0,z:0});
  const pointed=push({x:-.25,y:.45,z:0},40);
  expect(pointed.aim).toBeGreaterThan(.25);expect(pointed.depth).toBeGreaterThan(.12);
  push({x:1,y:-5,z:.5},16);
  expect(aim.capture()).toEqual(pointed);
  push({x:0,y:0,z:0},10);
  expect(aim.capture()).toEqual(pointed,'late recognition cannot pick up the follow-through');
  const next=push({x:.2,y:-.3,z:0},20);
  push({x:0,y:4,z:0});
  expect(aim.capture()).toEqual(next);
  expect(aim.capture().aim).toBeLessThan(pointed.aim);
});

test('equivalent web/native gyro traces capture identical bounded tennis placement',()=>{
  const native=createTennisAim(),web=createTennisAim();
  const app=trace(native),browser=trace(web,normalizeWebMotion);
  for(const [rate,count] of [[{x:0,y:0,z:0},1],[{x:.3,y:-.5,z:.05},100],[{x:2,y:4,z:0},8],[{x:0,y:0,z:0},5]]) {
    app(rate,count);browser(rate,count);
  }
  expect(native.capture().aim).toBeCloseTo(web.capture().aim,10);
  expect(native.capture().depth).toBeCloseTo(web.capture().depth,10);
  expect(Math.abs(native.capture().aim)).toBeLessThanOrEqual(1);
  expect(Math.abs(native.capture().depth)).toBeLessThanOrEqual(1);
});

test('aim sensitivity never postpones capture until the fast stroke has moved the target',()=>{
  for(const sensitivity of [.25,1,2]) {
    const aim=createTennisAim({sensitivity}),push=trace(aim);
    push({x:0,y:0,z:0});const pointed=push({x:0,y:.4,z:0},40);
    // Below the 200 deg/s recognizer onset, but already above the aim lock.
    push({x:0,y:1.2,z:0},5);push({x:0,y:5,z:0},5);
    expect(aim.capture()).toEqual(pointed);
  }
});

test('gaps, calibration changes, rotations and invalid samples clear stale placement',()=>{
  for(const discontinuity of ['gap','revision','rotation','invalid']) {
    const aim=createTennisAim(),push=trace(aim);
    push({x:0,y:0,z:0});push({x:0,y:.5,z:0},40);push({x:0,y:4,z:0});
    expect(aim.capture().aim).toBeGreaterThan(.25);
    if(discontinuity==='invalid') aim.push(null);
    else aim.push(normalizeNativeGyroscope({x:0,y:0,z:0},{timeSeconds:discontinuity==='gap' ? 2 : .71,sequence:43,
      calibrationRevision:discontinuity==='revision' ? 1 : 0,screenAngle:discontinuity==='rotation' ? 90 : 0}));
    expect(aim.capture()).toEqual({aim:0,depth:0});
  }
});

test('tennis placement is optional for legacy/touch but rejects malformed coordinates',()=>{
  const swing={type:'swing',id:'stroke',label:'Forehand',hand:'Right'};
  expect(isSwing(swing)).toBe(true);
  expect(isSwing({...swing,aim:-1,depth:1})).toBe(true);
  for(const value of [NaN,Infinity,-1.01,1.01,'0',null]) {
    expect(isSwing({...swing,aim:value})).toBe(false);
    expect(isSwing({...swing,depth:value})).toBe(false);
  }
});

test('table-tennis opponent options validate both new and existing checkpoint versions',()=>{
  const command={id:'option',gameId:'game-a',action:'configure',settings:{botStyle:'rally'}};
  expect(isGameCommand(command,'table-tennis')).toBe(true);
  expect(isGameCommand({...command,settings:{botStyle:'challenge'}},'table-tennis')).toBe(true);
  expect(isGameCommand({...command,settings:{botStyle:'invalid'}},'table-tennis')).toBe(false);
  const state={version:1,boundary:'point',rules:{firstServer:1,score:{1:0,2:0},pointId:1,phase:'ready',winner:null,targetPoints:12},
    settings:{assistance:'friendly',sensitivity:1},seed:1,mode:'bot',practiceReturns:0};
  for(const botStyle of [undefined,'rally','challenge']) {
    const settings={...state.settings,...(botStyle ? {botStyle} : {})};
    expect(isGameOptions({gameId:'game-a',sport:'table-tennis',settings,practice:{active:false}},'table-tennis')).toBe(true);
    expect(()=>checkpoint('table-tennis',{...state,settings})).not.toThrow();
  }
  expect(()=>checkpoint('table-tennis',{...state,settings:{...state.settings,botStyle:'bad'}})).toThrow();
});

test('preparation diagnostics accept a local duration for misses without inventing contact time',()=>{
  const result={id:'stroke',gameId:'game-a',player:1,result:'miss',reason:'late',receivedToPreparationMs:12};
  expect(isStrokeResult(result)).toBe(true);
  expect(isStrokeResult({...result,receivedToPreparationMs:-1})).toBe(false);
  expect(isStrokeResult({...result,receivedToContactMs:24})).toBe(false);
});
