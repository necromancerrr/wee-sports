import {expect, test, vi} from 'vitest';
import {createBowlingAimFilter, createBowlingAimStream} from '../src/controller/bowlingAim.js';
import {createTimeConstantFilter} from '../shared/motion.js';

test('aim smoothing has the same response at 30, 60 and 100 Hz', () => {
  const results = [30, 60, 100].map(rate => {
    const filter = createTimeConstantFilter({timeConstantSeconds: .084});
    filter.reset(0, 0);
    let value = 0;
    for (let i = 1; i <= rate / 2; i++) value = filter.push(.8, i / rate);
    return value;
  });
  for (const value of results) expect(value).toBeCloseTo(.8 * (1 - Math.exp(-.5 / .084)), 10);
});

test('latest aim is bounded to display cadence, locks immediately and does not replay on pause', () => {
  const send = vi.fn();
  const stream = createBowlingAimStream(send);
  stream.publish(0, false, 0, true);
  for (let time = 1; time < 16; time++) stream.publish(time / 100, false, time, true);
  expect(send).toHaveBeenCalledTimes(1);
  stream.publish(.5, false, 16, true);
  stream.publish(.5, true, 17, true);
  expect(send.mock.calls.at(-1)[0]).toEqual({aim: .5, locked: true, sequence: 3});
  stream.publish(-.8, false, 100, false);
  expect(send).toHaveBeenCalledTimes(3);
  stream.publish(.2, false, 200, true);
  expect(send.mock.calls.at(-1)[0]).toEqual({aim: .2, locked: false, sequence: 4});
  for (const aim of [NaN, Infinity, -2, 2]) stream.publish(aim, false, 300, true);
  expect(send).toHaveBeenCalledTimes(4);
});

test('deliberate aim reaches over 90 percent within two 60Hz samples without overshooting', () => {
  const filter = createBowlingAimFilter();
  filter.reset(0, 0);
  expect(filter.push(.8, 1 / 60)).toBeGreaterThan(.5);
  expect(filter.push(.8, 2 / 60)).toBeGreaterThan(.72);
  const reverse = filter.push(-.8, 3 / 60);
  expect(reverse).toBeLessThan(0);
  expect(filter.push(-.8, 4 / 60)).toBeLessThan(-.6);
  for (let i = 5; i < 60; i++) expect(filter.push(-.8, i / 60)).toBeGreaterThanOrEqual(-.8);
});

test('small aim tremors stay filtered and stale timestamps cannot rewind the guide', () => {
  const filter = createBowlingAimFilter(); filter.reset(0, 0);
  for (let i = 1; i < 60; i++) expect(Math.abs(filter.push(i % 2 ? .012 : -.012, i / 60))).toBeLessThan(.007);
  expect(filter.push(.6, 2)).toBe(.6); // A new stream after a gap starts at its latest value.
  expect(filter.push(-.9, 1)).toBe(.6);
  expect(filter.push(NaN, 3)).toBe(.6);
});

test('stationary aim refreshes without a per-sensor packet flood', () => {
  const send = vi.fn();
  const stream = createBowlingAimStream(send);
  for (let time = 0; time <= 1000; time++) stream.publish(.1, false, time, true);
  expect(send).toHaveBeenCalledTimes(6);
});
