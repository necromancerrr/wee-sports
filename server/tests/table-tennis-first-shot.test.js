import {expect, test} from 'vitest';
import {createPaddleIntentController, normalizeWebMotion, normalizeNativeGyroscope} from '@wee/shared/motion.js';
import {createStrokeIntentDetector} from '@wee/src/tabletennis/strokeIntent.js';
import {TableTennisGame} from '@wee/src/tabletennis/game.js';
import {shotIntent} from '@wee/src/tabletennis/shot.js';

function movement({native = false, hz = 60, direction = 1, hand = 'Right'} = {}) {
  const paddle = createPaddleIntentController(), poses = [];
  let index = 0;
  const add = (seconds, angularVelocity, phase) => {
    for (let i = 0; i < Math.round(seconds * hz); i++) {
      const sourceTime = 120 + index / hz;
      const options = {timeSeconds:sourceTime, sequence:index++};
      const sample = native ? normalizeNativeGyroscope(angularVelocity, options) : normalizeWebMotion({rotationRate:{
        alpha:angularVelocity.x * 180 / Math.PI, beta:angularVelocity.y * 180 / Math.PI, gamma:angularVelocity.z * 180 / Math.PI}}, options);
      poses.push({...paddle.push(sample), hand, sourceTime, phase});
    }
  };
  add(.15, {x:0,y:0,z:0}, 'rest');
  add(.3, {x:0,y:-direction,z:0}, 'old aim');
  add(.15, {x:0,y:0,z:0}, 'rest');
  add(.5, {x:0,y:direction * 1.4,z:0}, 'new aim');
  const aimed = poses.at(-1);
  add(.14, {x:4,y:0,z:0}, 'first hit');
  return {poses, aimed, hz};
}

test('moderate re-aim never consumes the first intended hit, on either adapter, hand or side', () => {
  for (const native of [false,true]) for (const hand of ['Right','Left']) for (const direction of [-1,1]) for (const hz of [30,60,100]) {
    const {poses, aimed} = movement({native,hand,direction,hz});
    const detector = createStrokeIntentDetector(), gestures = [];
    for (const pose of poses) {
      const gesture = detector.push(pose, pose.sourceTime);
      if (gesture) gestures.push({...gesture,phase:pose.phase});
    }
    expect(gestures).toHaveLength(1);
    expect(gestures[0]).toMatchObject({phase:'first hit',kind:'drive',hand});
    expect(gestures[0].aim.x).toBeCloseTo(aimed.reach.x, 8);
    expect(gestures[0].aim.x * direction).toBeGreaterThan(.3);
  }
});

test('smooth aiming ramps and short reposition-to-forward transitions do not steal the hit', () => {
  for (const hz of [30,60,100]) for (const direction of [-1,1]) for (const hold of [0,.4]) {
    const detector=createStrokeIntentDetector(), gestures=[];
    let now=0;
    detector.push({angularVelocity:{x:0,y:0,z:0},reach:{x:-direction*.7,y:0}},now);
    for (let i=1;i<=Math.round(hz*.1);i++) {
      now+=1/hz;
      const progress=i/Math.round(hz*.1);
      expect(detector.push({angularVelocity:{x:0,y:direction*1.4*progress,z:0},reach:{x:direction*(-.7+1.4*progress),y:0}},now)).toBeNull();
    }
    for (let i=0;i<Math.round(hz*hold);i++) {
      now+=1/hz;
      expect(detector.push({angularVelocity:{x:0,y:direction*1.4,z:0},reach:{x:direction*.7,y:0}},now)).toBeNull();
    }
    for(let i=0;i<Math.round(hz*.14);i++) {
      now+=1/hz;
      const gesture=detector.push({angularVelocity:{x:4,y:0,z:0},reach:{x:direction*.7,y:0}},now);
      if(gesture) gestures.push(gesture);
    }
    expect(gestures).toHaveLength(1);
    expect(gestures[0]).toMatchObject({kind:'drive',aim:{x:direction*.7,y:0}});
  }
});

test('the first actual return after re-aim uses the new target in both player views', () => {
  for (const native of [false,true]) for (const player of [1,2]) for (const direction of [-1,1]) {
    const {poses,aimed,hz} = movement({native,direction});
    let now = 1;
    const game = new TableTennisGame({now:()=>now}); game.startMatch({players:2}); game.nextFeed = Infinity;
    const sign = player === 1 ? 1 : -1, contacts = [];
    const collision = game.physics.onEvent;
    game.physics.onEvent = event => {contacts.push(event); collision(event);};
    let launched = false;
    for (const pose of poses) {
      now += 1 / hz;
      if (pose.phase === 'first hit' && !launched) {
        game.rules.beginPoint();
        Object.assign(game.rules,{phase:'rally',serving:false,lastHitter:3-player,bounces:1});
        game.lastBounceSide = player;
        game.physics.launch({x:0,y:1.1,z:.6*sign},{x:0,y:-.2,z:3*sign});
        launched = true;
      }
      game.setInput(pose, {player}); game.update(1 / hz);
    }
    const target = shotIntent(aimed, player).target;
    for (let i=0;i<100 && !contacts.some(event=>event.kind==='bounce' && event.side===3-player);i++) {
      now += 1 / hz;
      game.update(1 / hz);
    }
    const hits = contacts.filter(event=>event.kind==='hit' && event.player===player);
    expect(hits).toHaveLength(1);
    const landing = contacts.find(event=>event.kind==='bounce' && event.side===3-player);
    expect(landing).toBeDefined();
    expect(Math.abs(landing.position.x-target.x)).toBeLessThan(.03);
    expect(game.lastContact.target.x * direction * sign).toBeGreaterThan(.15);
  }
});

test('source intervals produce the same first stroke despite constant delay, batching or compressed callbacks', () => {
  const rates=[0,0,0,0,0,1,2,4,7,7,4,2,0,0,0,0];
  const outcomes=[];
  for (const delivery of ['normal','delayed','batches','compressed']) {
    let now=1;
    const game=new TableTennisGame({now:()=>now}); game.feed();
    game.physics.ball.position={x:0,y:1,z:.7};
    rates.forEach((rate,index)=>{
      now=delivery==='normal' ? 1+index/60 : delivery==='delayed' ? 1.08+index/60
        : delivery==='batches' ? 1+(Math.floor(index/5)+1)*5/60+(index%5)*.0001 : 1.4+index*.0001;
      game.setInput({orientation:[0,0,0,1],reach:{x:.45,y:0},angularVelocity:{x:rate,y:0,z:0},sourceTime:200+index/60});
    });
    expect(game.pendingStroke).not.toBeNull();
    outcomes.push({strength:game.pendingStroke.strength,intent:game.pendingStroke.intent});
    now += .6; game.update(.01);
    expect(game.pendingStroke).toBeNull();
    expect(game.playerStroke.phase).toBe('ready');
  }
  expect(outcomes.every(value=>JSON.stringify(value)===JSON.stringify(outcomes[0]))).toBe(true);
});

test('source clocks reject reordering, reset at interruption, and never replace receipt freshness', () => {
  let now=1;
  const game=new TableTennisGame({now:()=>now});
  const pose={orientation:[0,0,0,1],reach:{x:.4,y:0},angularVelocity:{x:0,y:0,z:0},calibrationRevision:1,sourceTime:500};
  expect(game.setInput(pose,{remote:true})).toBe(true);
  now+=.02;
  expect(game.setInput({...pose,sourceTime:499,reach:{x:-.8,y:0}},{remote:true})).toBe(false);
  expect(game.input.reach.x).toBe(.4);
  game.clearStrokeInput();
  expect(game.setInput({...pose,sourceTime:.1},{remote:true})).toBe(true);
  now+=.6; game.update(.01);
  expect(game.snapshot().stale).toBe(true);
  expect(game.physics.paddles[0].enabled).toBe(false);
});
