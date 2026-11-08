import {expect, test} from 'vitest';
import {Vector3} from 'three';
import {createTableTennisViews} from '../src/tabletennis/views.js';
import {TableTennisGame} from '../src/tabletennis/game.js';
import {tableTennisResult} from '../src/tabletennis/presentation.js';
import {shotIntent} from '../src/tabletennis/shot.js';

const pose = {orientation:[0,0,0,1], angularVelocity:{x:0,y:0,z:0}, reach:{x:0,y:0}};
test('each split camera puts its player nearest and forehand-left/backhand-right in its own view', () => {
  for (const [width,height] of [[1920,1080],[1280,800],[801,600],[2560,1080]]) {
    const views=createTableTennisViews();
    const split=views.layout(width,height,true);
    expect(split[0].width+split[1].width).toBe(width);
    expect(split[1].x).toBe(split[0].width);
    split.forEach(({camera,width:w},index)=>{
      const player=index+1, sign=player===1?1:-1;
      expect(camera.aspect).toBe(w/height);
      const own=new Vector3(0,1,sign*1.4).project(camera);
      const opponent=new Vector3(0,1,-sign*1.4).project(camera);
      expect(own.y).toBeLessThan(opponent.y);
      for (const direction of [-1,1]) {
        const target=shotIntent(pose,player,{direction}).target;
        expect(Math.sign(new Vector3(target.x,target.y,target.z).project(camera).x)).toBe(direction);
      }
    });
    const [solo]=views.layout(width,height,false);
    expect(solo.width).toBe(width);expect(solo.camera.aspect).toBe(width/height);
  }
});

test('a finished TV match remains a result after input expires, pauses, and checkpoint restoration', () => {
  let now=0;
  const game=new TableTennisGame({now:()=>now});game.startMatch({players:2});
  for(const player of [1,2])game.setInput(pose,{player,remote:true});
  for(let i=0;i<12;i++){game.rules.beginPoint();game.rules.award(2,'No return');}
  game.physics.ball.active=false;
  const saved=game.checkpoint();
  now=15;game.paused=true;game.update(.1);
  expect(game.snapshot()).toMatchObject({phase:'complete',winner:2,score:[0,12],stale:false});
  expect(tableTennisResult(game.snapshot(),'Sam','Alex')).toMatchObject({title:'Alex wins!',score:'0 – 12'});
  const restored=new TableTennisGame();expect(restored.restore(saved)).toBe(true);
  expect(tableTennisResult(restored.snapshot(),'Sam','Alex').title).toBe('Alex wins!');
  game.startMatch({players:2});expect(tableTennisResult(game.snapshot())).toBeNull();
});

test('Standard paddle pointing mirrors with the player camera, including the raw contact face', () => {
  const faces=[];
  for(const player of [1,2]) {
    const game=new TableTennisGame();game.startMatch({players:2});game.configure({assistance:'standard'});
    const sign=player===1?1:-1;
    game.setInput({...pose,orientation:[0,.15,0,Math.sqrt(1-.15**2)]},{player});
    game.physics.launch({x:0,y:1,z:0},{x:0,y:0,z:3*sign});
    Object.assign(game.players[player-1].stroke,{phase:'queued',until:1});
    game.updateHumanPaddle(player,1/60,false);
    faces.push(game.physics.paddles[player-1].normal);
  }
  expect(Math.abs(faces[0].x)).toBeGreaterThan(.01);
  expect(faces[0].x).toBeCloseTo(-faces[1].x);
  expect(faces[0].y).toBeCloseTo(faces[1].y);
  expect(faces[0].z).toBeCloseTo(-faces[1].z);
});
