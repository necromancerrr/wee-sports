import {expect, test} from 'vitest';
import {TableTennisGame, predictInterception} from '../src/tabletennis/game.js';
import {TableTennisPhysics, v3, mix, FIXED_STEP} from '../src/tabletennis/physics.js';
import {shotIntent, planFriendlyReturn} from '../src/tabletennis/shot.js';

test('pre-swing pitch selects short/deep placement in both player views while neutral stays familiar', () => {
  for (const player of [1, 2]) {
    const sign = player === 1 ? -1 : 1;
    for (const [pitch, depth] of [[-1, .6], [0, .9], [1, 1.2]]) {
      const intent = shotIntent({reach: {x: .4, y: pitch}}, player);
      expect(intent.target.z).toBeCloseTo(sign * depth);
      expect(intent.target.x).toBeCloseTo(-sign * .22);
    }
  }
});

test('short and deep planned returns still make physical opponent-table bounces across power', () => {
  for (const player of [1, 2]) for (const depth of [-1, 1]) for (const power of [1.5, 9]) {
    const sign = player === 1 ? 1 : -1;
    const physics = new TableTennisPhysics(), events = [];
    for (const paddle of physics.paddles) paddle.enabled = false;
    physics.onEvent = event => events.push(event);
    const origin = v3(.2 * sign, 1.02, 1.2 * sign);
    const intent = shotIntent({reach: {x: -.5, y: depth}, angularVelocity: v3(0, 0, 3)}, player);
    const plan = planFriendlyReturn(origin, intent, power);
    physics.launch(origin, plan.velocity, plan.spin);
    for (let i = 0; i < 150 && !events.some(event => event.kind === 'bounce'); i++) physics.step();
    const bounce = events.find(event => event.kind === 'bounce');
    expect(events.some(event => event.kind === 'net')).toBe(false);
    expect(bounce?.side).toBe(player === 1 ? 2 : 1);
    expect(Math.hypot(bounce.position.x - intent.target.x, bounce.position.z - intent.target.z)).toBeLessThan(.02);
  }
});

test('receiving prediction includes the live drag, spin and frictional bounce', () => {
  for (const sign of [-1, 1]) for (const spin of [v3(), v3(80, 100, 0), v3(-80, -100, 0)]) {
    const ball = {active: true, position: v3(.4, 1.2, -.8 * sign), velocity: v3(-.3, .8, 4 * sign), spin};
    const physics = new TableTennisPhysics();
    for (const paddle of physics.paddles) paddle.enabled = false;
    physics.launch(ball.position, ball.velocity, ball.spin);
    let crossing;
    const z = .9 * sign;
    for (let i = 0; i < 120 && physics.ball.active; i++) {
      const before = {...physics.ball.position}; physics.step();
      if (before.z * sign < .9 && physics.ball.position.z * sign >= .9) {
        crossing = mix(before, physics.ball.position, (z - before.z) / (physics.ball.position.z - before.z)); break;
      }
    }
    expect(crossing).toBeDefined();
    const predicted = predictInterception(ball, z);
    expect(predicted.x).toBeCloseTo(crossing.x, 8);
    expect(predicted.y).toBeCloseTo(Math.min(1.4, Math.max(.81, crossing.y)), 8);
    expect(ball.position).toEqual(v3(.4, 1.2, -.8 * sign)); // Forecast cannot move live play.
  }
});

test('a stroke acknowledges the imminent receive promptly, without allowing idle or expired contact', () => {
  let now = 1;
  const events = [], game = new TableTennisGame({now: () => now, onEvent: event => events.push(event)});
  game.startMatch();
  game.physics.launch(v3(0, 1.1, .4), v3(0, 1, 3));
  const pose = rate => ({orientation: [0,0,0,1], reach: {x: 0, y: 0}, angularVelocity: v3(0, rate, 0)});
  for (const rate of [0, 2, 4, 7]) {now += .01;game.setInput(pose(rate));}
  expect(events.filter(event => event.type === 'stroke')).toHaveLength(1);
  expect(events.some(event => event.type === 'hit')).toBe(false);
  expect(game.pendingStroke.expiresAt - game.pendingStroke.receivedAt).toBeLessThanOrEqual(.45);
  now += .46; game.update(.01);
  expect(game.pendingStroke).toBeNull();
  expect(game.physics.paddles[0].enabled).toBe(false);
});

test('standard timing does not borrow friendly reach behind the receiving plane', () => {
  for (const player of [1, 2]) {
    const game = new TableTennisGame(), sign = player === 1 ? 1 : -1;
    game.physics.launch(v3(0, 1.1, 1.2 * sign), v3(0, 0, 3 * sign));
    expect(game.receiveWindow(player)).toBeGreaterThan(0);
    game.configure({assistance: 'standard'});
    expect(game.receiveWindow(player)).toBeNull();
  }
});

test('rally and challenge bots choose distinct placements and still use actual paddle contacts', () => {
  for (const botStyle of ['rally', 'challenge']) {
    const contacts = [];
    const game = new TableTennisGame({seed: 17, onEvent: event => {
      if (event.type === 'hit' && event.player === 2 && game.lastContact.assisted) contacts.push({...game.lastContact});
    }});
    game.configure({botStyle}); game.startMatch();
    for (let i = 0; i < 5000 && contacts.length < 3; i++) game.update(FIXED_STEP);
    expect(contacts.length).toBeGreaterThanOrEqual(3);
    expect(contacts.every(contact => contact.assisted && contact.speed > 0)).toBe(true);
    if (botStyle === 'rally') expect(contacts.every(contact => contact.target.x === 0)).toBe(true);
    else expect(new Set(contacts.map(contact => Math.sign(contact.target.x))).size).toBe(2);
    const checkpoint = game.checkpoint();
    if (checkpoint) {const restored = new TableTennisGame();expect(restored.restore(checkpoint)).toBe(true);expect(restored.settings.botStyle).toBe(botStyle);}
  }
});

test('practice unlocks a target after three legal returns and counts only landings inside it', () => {
  const game = new TableTennisGame();
  let id = 0;
  const returnAt = position => {
    game.feed();
    game.handleCollision({kind: 'bounce', side: 1, position: v3(0,.78,.7), id: ++id});
    game.handleCollision({kind: 'hit', player: 1, position: v3(0,1,1.2), velocity: v3(0,1,-4), id: ++id});
    game.handleCollision({kind: 'bounce', side: 2, position, id: ++id});
  };
  for (let i = 0; i < 3; i++) returnAt(v3(0,.78,-.9));
  expect(game.practiceChallenge).toMatchObject({stage:'target',returns:3,hits:0});
  returnAt(v3(0,.78,-.9));expect(game.practiceChallenge.hits).toBe(0);
  const target = game.practiceChallenge.target;
  returnAt(target);expect(game.practiceChallenge.hits).toBe(1);
  expect(game.snapshot().practiceChallenge.target).not.toEqual(target);
  game.startPractice();expect(game.practiceChallenge).toMatchObject({stage:'returns',returns:0,hits:0,target:null});
});
