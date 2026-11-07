import {describe, expect, test} from 'vitest';
import {BALL, TABLE, TableTennisPhysics, add, scale, v3, length,
  flightAcceleration, sphereContact, sweepPaddle, makePaddle} from '../src/tabletennis/physics.js';

const energy = (velocity, spin) => .5 * length(velocity) ** 2 +
  .5 * BALL.inertiaFactor * BALL.radius ** 2 * length(spin) ** 2;

describe('table-tennis contact impulses', () => {
  test('topspin and backspin change actual paddle rebound in opposite directions', () => {
    const hit = spin => {
      const physics = new TableTennisPhysics();
      const paddle = physics.paddles[0];
      paddle.position = paddle.previous = v3(0, 1, 1.1);
      paddle.normal = paddle.previousNormal = v3(0, 0, -1);
      let contact;
      physics.onEvent = event => { if (event.kind === 'hit') contact = event; };
      physics.launch(v3(0, 1, 1.06), v3(0, 0, 5), v3(spin, 0, 0));
      physics.step();
      return contact.velocity;
    };
    expect(hit(60).y).toBeGreaterThan(.4);
    expect(hit(-60).y).toBeLessThan(-.4);
    // Opposite Magnus acceleration acts during the short approach as well.
    expect(Math.abs(hit(60).z - hit(-60).z)).toBeLessThan(.00001);
  });

  test('a rolling contact with zero slip preserves its tangential motion and spin', () => {
    const result = sphereContact(v3(0, 1.2, 5), v3(60, 0, 0), v3(0, 0, -1), v3(), .8, .45);
    expect(result.velocity).toEqual(v3(0, 1.2, -4));
    expect(result.spin).toEqual(v3(60, 0, 0));
  });

  test('a grazing tabletop bounce cannot deliver a large sideways kick from spin', () => {
    const incoming = v3(3, -.01, 0);
    const result = sphereContact(incoming, v3(0, 0, 150), v3(0, 1, 0), v3(), .88, .12);
    // Coulomb's bound uses normal impulse, so a nearly tangential brush has
    // very little grip even when the contact point has large slip velocity.
    const maximum = .12 * (1 + .88) * .01;
    expect(Math.abs(result.velocity.x - incoming.x)).toBeLessThanOrEqual(maximum + 1e-12);
    expect(result.velocity.y).toBeCloseTo(.0088, 10);
  });

  test('stationary-surface impulses dissipate total translational and rotational energy', () => {
    for (const normal of [v3(0, 1, 0), v3(0, 0, -1)]) {
      for (const speed of [.05, 1, 5, 12]) for (const spin of [-150, -60, 0, 60, 150]) {
        const velocity = normal.y ? v3(2, -speed, 1) : v3(2, 1, speed);
        const rotation = v3(spin, spin / 2, spin / 3);
        const result = sphereContact(velocity, rotation, normal, v3(), .88, .45);
        expect(energy(result.velocity, result.spin)).toBeLessThanOrEqual(energy(velocity, rotation) + 1e-9);
      }
    }
  });

  test('a separating ball cannot receive a second contact impulse', () => {
    const velocity = v3(0, 0, -2), spin = v3(30, 20, 10);
    expect(sphereContact(velocity, spin, v3(0, 0, -1), v3(), .8, .45)).toEqual({velocity, spin});
  });

  test('a horizontal paddle still has a finite face and rejects a distant ball', () => {
    const paddle = makePaddle(1);
    paddle.position = paddle.previous = v3(0, 1, 1.1);
    paddle.normal = paddle.previousNormal = v3(0, 1, 0);
    expect(sweepPaddle(v3(0, 1.05, 1.1), v3(0, .95, 1.1), paddle)).not.toBeNull();
    expect(sweepPaddle(v3(.5, 1.05, 1.1), v3(.5, .95, 1.1), paddle)).toBeNull();
  });

  test('a bounce followed by a moving-paddle hit uses only the remaining paddle trajectory', () => {
    const dt = 1 / 480, initial = v3(0, .781, 1.067), velocity = v3(0, -1, 5);
    const physics = new TableTennisPhysics();
    const paddle = physics.paddles[0];
    paddle.previous = v3(0, .87, 1.1); paddle.position = v3(0, .87, 1.096);
    paddle.normal = paddle.previousNormal = v3(0, 0, -1);
    physics.paddles[1].enabled = false;
    let bounce, hit;
    physics.onEvent = event => {
      if (event.kind === 'bounce') bounce = {...event, velocity: {...physics.ball.velocity}};
      if (event.kind === 'hit') hit = event;
    };
    physics.launch(initial, velocity);
    physics.substep(dt, 0, 1, dt);
    expect(bounce).toBeDefined(); expect(hit).toBeDefined();
    const before = add(velocity, scale(flightAcceleration(velocity, v3()), dt));
    const bounceTime = (bounce.position.z - initial.z) / before.z;
    const paddleSpeed = (paddle.position.z - paddle.previous.z) / dt;
    // Two straight trajectories after the bounce have one analytic crossing.
    const hitTime = (paddle.previous.z - (BALL.radius + .006) - bounce.position.z +
      bounce.velocity.z * bounceTime) / (bounce.velocity.z - paddleSpeed);
    expect(hitTime).toBeGreaterThan(bounceTime);
    expect(hit.position.z).toBeCloseTo(paddle.previous.z + paddleSpeed * hitTime - (BALL.radius + .006) - .0001, 10);
    expect(bounce.position.y).toBeCloseTo(TABLE.height + BALL.radius + .0001, 10);
  });

  test('a ball cannot be collected from behind the paddle or beyond its finite rim', () => {
    const paddle = makePaddle(1);
    paddle.normal = paddle.previousNormal = v3(0, 0, -1);
    expect(sweepPaddle(v3(0, 1.02, 1.2), v3(0, 1.02, 1.15), paddle)).toBeNull();
    expect(sweepPaddle(v3(.14, 1.02, 1.14), v3(.14, 1.02, 1.2), paddle)).toBeNull();
  });
});
