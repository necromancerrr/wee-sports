import {describe, it, expect} from 'vitest';
import {tableTennisAnnouncement} from '@wee/src/tabletennis/presentation.js';

describe('table-tennis score announcements', () => {
  const state = {score: [0, 0], server: 1, winner: null, targetPoints: 12, deuce: false, gamePoint: null};
  it('announces deuce and the next game point from authoritative state', () => {
    expect(tableTennisAnnouncement({...state, score: [11, 11], deuce: true}, {type: 'point', winner: 2}).detail).toBe('11 – 11 · Deuce · win by two');
    expect(tableTennisAnnouncement({...state, score: [12, 11], gamePoint: 1}, {type: 'point', winner: 1}).detail).toBe('12 – 11 · Game point · You');
    expect(tableTennisAnnouncement({...state, score: [11, 12], server: 2, gamePoint: 2}, {type: 'serve'})).toMatchObject({title: 'Bot serves', detail: 'Game point · Bot'});
  });
  it('announces an actual winner and retains the point score', () => {
    expect(tableTennisAnnouncement({...state, score: [13, 11], winner: 1}, {type: 'point', winner: 1})).toMatchObject({title: 'You win', detail: '13 – 11 · Well played', tone: 'win'});
    expect(tableTennisAnnouncement({...state, score: [13, 11], winner: 1}, {type: 'point', winner: 1}, 'Alex').title).toBe('Alex wins');
    expect(tableTennisAnnouncement({...state, score: [3, 12], winner: 2}, {type: 'point', winner: 2}).title).toBe('Bot wins');
  });
  it('lets do not claim a point and ordinary hit events create no score announcement', () => {
    expect(tableTennisAnnouncement(state, {type: 'let'}).detail).toContain('score stays the same');
    expect(tableTennisAnnouncement(state, {type: 'hit', player: 1})).toBeNull();
    expect(tableTennisAnnouncement(state, {type: 'serve'}, 'Alex').title).toBe('Alex’s serve');
  });
});
