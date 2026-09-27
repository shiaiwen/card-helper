const assert = require('node:assert/strict');
const { waitForRuntime } = require('../script/runtime-startup.cjs');
async function test() {
  let tick, cleanup, ready = false, calls = 0, cleared = 0;
  const status = {};
  const promise = waitForRuntime({status, probe:()=>ready?[]:['engine'], initialize:()=>{calls++;return true;}, registerCleanup:fn=>cleanup=fn, timers:{setInterval:fn=>(tick=fn,1),clearInterval:()=>cleared++}});
  for(let i=0;i<181;i++)tick();
  assert.equal(status.state,'waiting'); assert.equal(calls,0);
  ready=true; tick(); tick(); await promise;
  assert.equal(status.state,'ready'); assert.equal(calls,1); assert.equal(cleared,1); cleanup();
  const cancelled={};
  const pending=waitForRuntime({status:cancelled,probe:()=>['engine'],initialize:()=>{throw Error('Must not start');},registerCleanup:fn=>cleanup=fn,timers:{setInterval:()=>1,clearInterval:()=>{}}});
  cleanup(); assert.equal(await pending,false); assert.equal(cancelled.state,'cancelled');
  const failed={};
  await assert.rejects(waitForRuntime({status:failed,probe:()=>[],initialize:()=>{throw Error('initialization failed');},registerCleanup:()=>{},timers:{setInterval:()=>1,clearInterval:()=>{}}}),/initialization failed/);
  assert.equal(failed.state,'failed');
  console.log('Slow startup, initialize-once, cancellation and initialization failure checks passed.');
}
test().catch(error=>{console.error(error);process.exitCode=1;});
