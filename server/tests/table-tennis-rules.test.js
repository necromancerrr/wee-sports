import {describe, expect, test} from 'vitest';
import {TableTennisRules} from '@wee/src/tabletennis/rules.js';
import {TableTennisGame} from '@wee/src/tabletennis/game.js';
import {validateSportState} from '@server/profiles/roomPersistence.js';

const point = (rules, winner) => {
  expect(rules.beginPoint()).toBe(true);
  return rules.award(winner, 'Fixture point');
};
const checkpoint = (score, targetPoints = 12, extra = {}) => ({
  firstServer: 1, targetPoints, score, pointId: score[0] + score[1],
  phase: 'ready', winner: null, ...extra,
});

describe('first to twelve, win by two', () => {
  test.each([1, 2])('player %i needs twelve points and completion cannot score twice', winner => {
    const rules = new TableTennisRules();
    for (let i = 0; i < 11; i++) point(rules, winner);
    expect(rules.snapshot()).toMatchObject({phase: 'ready', winner: null, targetPoints: 12, gamePoint: winner});
    point(rules, winner);
    expect(rules.phase).toBe('complete'); expect(rules.winner).toBe(winner);
    expect(rules.beginPoint()).toBe(false); expect(rules.award(winner, 'duplicate')).toBeNull();
    expect(rules.score[winner - 1]).toBe(12);
    expect(rules.snapshot()).toMatchObject({deuce: false, gamePoint: null});
  });

  test.each([1, 2])('server %i keeps two serves until 11–11, then alternates each point', firstServer => {
    const rules = new TableTennisRules({firstServer});
    for (let i = 0; i < 22; i++) {
      expect(rules.server).toBe(Math.floor(i / 2) % 2 ? 3 - firstServer : firstServer);
      point(rules, i % 2 ? 2 : 1);
    }
    expect(rules.snapshot()).toMatchObject({score: [11, 11], deuce: true, gamePoint: null});
    const atDeuce = rules.server;
    for (let i = 0; i < 8; i++) {
      point(rules, i % 2 ? 2 : 1);
      expect(rules.server).toBe(i % 2 ? atDeuce : 3 - atDeuce);
      expect(rules.snapshot().gamePoint).toBe(i % 2 ? null : 1);
      expect(rules.winner).toBeNull();
    }
    point(rules, 2); point(rules, 2);
    expect(rules.snapshot()).toMatchObject({score: [15, 17], phase: 'complete', winner: 2});
  });

  test('11–10 is game point but 12–11 still needs a two-point lead', () => {
    const rules = new TableTennisRules();
    expect(rules.restore(checkpoint([11, 10]))).toBe(true);
    expect(rules.snapshot()).toMatchObject({gamePoint: 1, deuce: false});
    point(rules, 2); point(rules, 1);
    expect(rules.snapshot()).toMatchObject({score: [12, 11], phase: 'ready', winner: null, gamePoint: 1});
    point(rules, 1);
    expect(rules.snapshot()).toMatchObject({score: [13, 11], phase: 'complete', winner: 1});
  });

  test('a let repeats the same service turn without changing score', () => {
    const rules = new TableTennisRules(); rules.restore(checkpoint([11, 11]));
    const server = rules.server;
    rules.beginPoint(); rules.event('hit', {player: server}); rules.event('bounce', {side: server});
    rules.event('net'); expect(rules.event('bounce', {side: 3 - server})?.type).toBe('let');
    expect(rules.score).toEqual([11, 11]); expect(rules.server).toBe(server);
    expect(rules.beginPoint()).toBe(true); expect(rules.server).toBe(server);
  });
});

describe('saved scoring rules', () => {
  test('new checkpoints retain twelve-point rules through game and server validation', () => {
    const game = new TableTennisGame(); game.startMatch();
    game.rules.restore(checkpoint([11, 0]));
    const saved = game.checkpoint();
    expect(saved.rules.targetPoints).toBe(12);
    const restored = new TableTennisGame(); expect(restored.restore(saved)).toBe(true);
    expect(restored.checkpoint()).toEqual(saved);
    const room = {sport: 'table-tennis', players: [{slot: 0, memberId: 'player'}]};
    expect(validateSportState(room, saved)).toBeUndefined();
    point(restored.rules, 1);
    expect(validateSportState(room, restored.checkpoint())).toEqual([{memberId: 'player', score: 12, rank: 1, outcome: 'win'}]);
  });

  test('old checkpoints without target metadata retain eleven-point service and victory', () => {
    const legacy = checkpoint([10, 10]); delete legacy.targetPoints;
    const rules = new TableTennisRules(); expect(rules.restore(legacy)).toBe(true);
    expect(rules.snapshot()).toMatchObject({targetPoints: 11, deuce: true, server: 1});
    point(rules, 2); expect(rules.server).toBe(2); point(rules, 2);
    expect(rules.snapshot()).toMatchObject({winner: 2, score: [10, 12]});
    expect(rules.checkpoint().targetPoints).toBe(11);
    const complete = checkpoint([11, 4], 11, {phase: 'complete', winner: 1});
    delete complete.targetPoints;
    expect(new TableTennisRules().restore(complete)).toBe(true);
    expect(new TableTennisRules().restore({...complete, targetPoints: 12})).toBe(false);
  });

  test('starting a new match after a legacy restore uses the new twelve-point rule', () => {
    const game = new TableTennisGame(), legacy = game.checkpoint();
    delete legacy.rules.targetPoints;
    expect(game.restore(legacy)).toBe(true); expect(game.rules.targetPoints).toBe(11);
    game.startMatch(); expect(game.rules.targetPoints).toBe(12);
  });

  test('invalid targets, inconsistent winners and play after completion are rejected', () => {
    for (const targetPoints of [0, 10, 13, '12', null, NaN]) {
      expect(new TableTennisRules().restore(checkpoint([0, 0], targetPoints))).toBe(false);
    }
    const rules = new TableTennisRules();
    expect(rules.restore(checkpoint([12, 10], 12, {phase: 'complete', winner: 2}))).toBe(false);
    expect(rules.restore(checkpoint([13, 0], 12, {phase: 'complete', winner: 1}))).toBe(false);
    rules.beginPoint(); expect(rules.award(3, 'invalid player')).toBeNull();
    expect(rules.score).toEqual([0, 0]);
  });
});
