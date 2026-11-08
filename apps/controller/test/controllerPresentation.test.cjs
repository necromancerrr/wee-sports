const {test}=require('node:test');
const assert=require('node:assert/strict');

test('native sport selection respects eight-player bowling and keeps golf unavailable',async()=>{
  const {sportChoice}=await import('../src/controllerPresentation.js');
  const seat={players:Array.from({length:8},(_,slot)=>({slot}))};
  assert.equal(sportChoice('bowling',seat).fits,true);
  assert.equal(sportChoice('tennis',seat).fits,false);
  assert.equal(sportChoice('table-tennis',seat).fits,false);
  assert.equal(sportChoice('golf',seat).available,false);
  assert.equal(sportChoice('golf',seat).caption,'Coming soon');
});

test('native tennis shows direct set points, including reset points and the final set',async()=>{
  const {matchSummary}=await import('../src/controllerPresentation.js');
  const seat={sport:'tennis',phase:'game',players:[{slot:0,name:'Riley'},{slot:1,name:'Sam'}],
    gameState:{phase:'serve',score:[0,0],sets:[1,0],completedSets:[{player1:8,player2:6}],targetPoints:7,setsToWin:2}};
  let summary=matchSummary(seat);
  assert.equal(summary.label,'Set 2 · Best of 3');assert.deepEqual(summary.score,[0,0]);assert.equal(summary.tally,'1–0 sets');
  assert.equal(summary.detail,'First to 7 points · Win by 2');
  seat.gameState={...seat.gameState,phase:'complete',score:[7,4],sets:[2,0],completedSets:[{player1:8,player2:6},{player1:7,player2:4}],winner:1};
  summary=matchSummary(seat);
  assert.equal(summary.label,'Set 2 · Best of 3');assert.deepEqual(summary.score,[7,4]);assert.equal(summary.result,'Riley wins!');
});

test('native results use real opponents and shared bowling winners without inventing missing scores',async()=>{
  const {matchSummary}=await import('../src/controllerPresentation.js');
  assert.equal(matchSummary({phase:'ready',sport:'tennis'}),null);
  const tennis=matchSummary({phase:'game',sport:'tennis',players:[{slot:0,name:'Riley'}],gameState:{phase:'rally'}});
  assert.equal(tennis.score,null);assert.deepEqual(tennis.names,['Riley','Bot']);
  const table=matchSummary({phase:'game',sport:'table-tennis',players:[{slot:0,name:'Riley'},{slot:1,name:'Sam'}],gameState:{phase:'complete',score:[12,10],winner:1}});
  assert.equal(table.detail,'First to 12 points · Win by 2');assert.deepEqual(table.names,['Riley','Sam']);
  const bowling=matchSummary({phase:'game',sport:'bowling',players:[{slot:0,name:'Riley'},{slot:7,name:'Sam'}],gameState:{phase:'complete',frame:10,winners:[1,8],winnerScore:180}});
  assert.equal(bowling.result,'Riley & Sam share first place');assert.equal(bowling.detail,'180 points');
});
