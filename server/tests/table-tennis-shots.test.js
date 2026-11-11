import {describe, test, expect} from 'vitest';
import {TableTennisGame} from '@wee/src/tabletennis/game.js';
import {TableTennisPhysics, FIXED_STEP, MATERIAL, v3, length} from '@wee/src/tabletennis/physics.js';
import {shotIntent, planFriendlyReturn} from '@wee/src/tabletennis/shot.js';

const pose = (reach = 0, rate = 0) => ({orientation: [0, 0, 0, 1], angularVelocity: v3(rate, 0, 0), reach: {x: reach, y: 0}});

function receive({aim = 0, power = 4, lateral = 0, turnAfterStart = false, seed = 137} = {}) {
  const game = new TableTennisGame({seed});
  game.feed();
  game.physics.ball.position.x = lateral;
  let started = null, contact = null, landing = null, latched = false;
  const collision = game.physics.onEvent;
  game.physics.onEvent = event => {
    if (event.kind === 'hit' && event.player === 1) contact = event;
    if (event.kind === 'bounce' && event.side === 2 && contact) landing = event.position;
    collision(event);
  };
  for (let frame = 0; frame < 600 && game.physics.ball.active && !landing; frame++) {
    if (started === null && game.physics.ball.velocity.z > 0 && game.physics.ball.position.z >= .5) started = game.time;
    const phase = started === null ? -1 : (game.time - started) / .24;
    const input = pose(turnAfterStart && latched ? -aim : aim,
      phase >= 0 && phase <= 1 ? power * Math.sin(phase * Math.PI) : 0);
    if (turnAfterStart && latched) input.orientation = [.6, 0, 0, .8];
    game.setInput(input);
    game.update(FIXED_STEP);
    if (game.playerStroke.intent) latched = true;
  }
  return {game, contact, landing};
}

describe('repeatable Friendly shot placement', () => {
  test('the same aim lands within two centimetres across power and receiving position', () => {
    for (const aim of [-.8, 0, .8]) for (const power of [1.5, 4, 9]) for (const lateral of [-.4, 0, .4]) {
      const {contact, landing} = receive({aim, power, lateral});
      expect(contact?.assisted).toBe(true);
      expect(landing).not.toBeNull();
      expect(Math.hypot(landing.x - aim * .55, landing.z + .9)).toBeLessThan(.02);
    }
  });

  test('a stronger stroke changes pace while retaining the intended landing area', () => {
    const gentle = receive({power: 1.5, aim: .8}), strong = receive({power: 9, aim: .8});
    expect(length(strong.contact.velocity)).toBeGreaterThan(length(gentle.contact.velocity) + .4);
    expect(Math.abs(strong.landing.x - gentle.landing.x)).toBeLessThan(.005);
    expect(Math.abs(strong.landing.z - gentle.landing.z)).toBeLessThan(.02);
  });

  test('the stroke locks its target before live phone recovery can turn the face away', () => {
    const steady = receive({aim: .8}), turned = receive({aim: .8, turnAfterStart: true});
    expect(turned.landing).toEqual(steady.landing);
    expect(turned.contact.position).toEqual(steady.contact.position);
    expect(turned.game.lastContact.target.x).toBeCloseTo(.44);
    expect(turned.game.lastContact.position).toEqual(turned.contact.position);
  });

  test('neutral practice is a repeatable drill and directional drills remain explicit', () => {
    const left = receive({seed: 2}), right = receive({seed: 900});
    expect(left.contact).toEqual(right.contact);
    expect(left.landing).toEqual(right.landing);
    const game = new TableTennisGame(); game.startPractice('left'); game.feed();
    expect(game.physics.ball.position.x).toBe(-.42);
    game.startPractice('right'); game.feed();
    expect(game.physics.ball.position.x).toBe(.42);
  });

  test('serve aim is captured once; subsequent phone movement cannot deflect the toss', () => {
    const serve = move => {
      const game = new TableTennisGame(); game.startMatch(); game.setInput(pose(.6)); game.serve();
      const bounces = [];
      const collision = game.physics.onEvent;
      game.physics.onEvent = event => {if (event.kind === 'bounce') bounces.push(event.position); collision(event);};
      for (let frame = 0; frame < 150 && bounces.length < 2; frame++) {
        game.setInput(pose(move ? -.9 : .6, move ? 12 : 0)); game.update(FIXED_STEP);
      }
      return bounces;
    };
    expect(serve(true)).toEqual(serve(false));
    expect(serve(false)).toHaveLength(2);
  });

  test('a centered rally stays consistent and deliberate wide placement beats finite bot reach', () => {
    const run = wide => {
      const game = new TableTennisGame(); game.startMatch();
      let started = null, incoming = false, hits = 0, returns = 0, hitter = 0;
      const collision = game.physics.onEvent;
      game.physics.onEvent = event => {
        if (event.kind === 'hit') {hitter = event.player; if (event.player === 1) hits++;}
        if (event.kind === 'bounce' && event.side === 2 && hitter === 1) returns++;
        collision(event);
      };
      for (let frame = 0; frame < 9000 && game.rules.phase !== 'complete'; frame++) {
        const ball = game.physics.ball;
        if (!ball.active || ball.velocity.z < 0) {started = null; incoming = false;}
        if (!incoming && ball.active && ball.velocity.z > 0 && ball.position.z > .5) {started = game.time; incoming = true;}
        const phase = started === null ? -1 : (game.time - started) / .24;
        game.setInput(pose(wide ? hits % 2 ? 1 : -1 : 0,
          phase >= 0 && phase <= 1 ? 4 * Math.sin(phase * Math.PI) : 0));
        game.update(FIXED_STEP);
      }
      return {game, returns};
    };
    const center = run(false), wide = run(true);
    expect(center.returns).toBeGreaterThan(50);
    expect(center.game.rules.score).toEqual([0, 0]);
    expect(wide.game.rules.winner).toBe(1);
    expect(wide.returns).toBeGreaterThanOrEqual(20);
  });
});

describe('contact-only assistance respects physical flight', () => {
  test('bounded impulses clear the real net and land on target across contact heights and sides', () => {
    for (const player of [1, 2]) for (const x of [-.5, 0, .5]) for (const y of [.84, 1.02, 1.4]) {
      for (const power of [1.5, 9]) {
        const position = v3(x, y, player === 1 ? .7 : -.7);
        const intent = shotIntent({reach: {x: -.8}, angularVelocity: v3(0, 0, 6)}, player);
        const plan = planFriendlyReturn(position, intent, power);
        expect(length(plan.velocity)).toBeLessThan(MATERIAL.maxSpeed);
        const physics = new TableTennisPhysics(), events = [];
        physics.paddles.forEach(paddle => {paddle.enabled = false;});
        physics.onEvent = event => events.push(event);
        physics.launch(position, plan.velocity, plan.spin);
        for (let step = 0; step < 180 && !events.some(event => event.kind === 'bounce'); step++) physics.step();
        expect(events.some(event => event.kind === 'net')).toBe(false);
        const bounce = events.find(event => event.kind === 'bounce');
        expect(bounce?.side).toBe(3 - player);
        expect(Math.hypot(bounce.position.x - intent.target.x, bounce.position.z - intent.target.z)).toBeLessThan(.02);
      }
    }
  });

  test('Standard keeps physical contact and an invalid assistance response cannot corrupt the ball', () => {
    const game = new TableTennisGame(); game.configure({assistance: 'standard'});
    game.playerStroke.phase = 'forward';
    expect(game.resolveContact({player: 1, position: v3(0, 1, 1)})).toBeNull();
    const physics = new TableTennisPhysics();
    physics.resolvePaddleContact = () => ({velocity: v3(NaN, 0, 0), spin: v3()});
    physics.paddles[0].normal = physics.paddles[0].previousNormal = v3(0, 0, -1);
    physics.launch(v3(0, 1.02, 1.15), v3(0, 0, 5)); physics.step();
    expect(Number.isFinite(length(physics.ball.velocity))).toBe(true);
    expect(physics.ball.velocity.z).toBeLessThan(0);
  });
});
