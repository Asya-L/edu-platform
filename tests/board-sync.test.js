const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create, applyOps} = require('../assets/board-sync.js');
const copy = value => JSON.parse(JSON.stringify(value));
const storage = () => { const map = new Map(); return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}; };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const add = id => ({k:'add',els:[{id,t:'pt',x:1,y:2}]});
function server() {
  let data={els:[],bg:'grid'}, revision=0; const batches=new Set();
  return {read:()=>copy(data), rpc:async(name,args)=>{
    if(name==='edu_board_get') return {data:[{data:{...copy(data),_revision:revision}}]};
    if(!batches.has(args.p_batch)) {data=applyOps(data,args.p_ops);revision++;batches.add(args.p_batch);}
    return {data:{data:copy(data),revision}};
  }};
}
function session(rpc, options={}) {return create({boardId:'board-a',userId:'user-a',rpc,storage:storage(),delay:60000,retry:60000,...options});}

test('independent writes from two clients do not replace each other', async t=>{
  const db=server(), a=session(db.rpc), b=session(db.rpc);t.after(()=>{a.close();b.close();});
  a.enqueue(add('teacher'));b.enqueue(add('student'));
  await Promise.all([a.flush(),b.flush()]);
  assert.deepEqual(db.read().els.map(e=>e.id),['teacher','student']);
});
test('changes made during an in-flight save remain dirty and get a second batch',async t=>{
  const db=server(), wait=deferred();let calls=0;
  const a=session(async(n,p)=>{calls++;if(calls===1)await wait.promise;return db.rpc(n,p);});t.after(()=>a.close());
  a.enqueue(add('first'));const saving=a.flush();a.enqueue(add('second'));wait.resolve();await saving;
  assert.equal(a.dirty(),true);await a.flush();assert.equal(a.dirty(),false);
  assert.deepEqual(db.read().els.map(e=>e.id),['first','second']);
});
test('continuous writing is saved before the writer pauses',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const db=server(), a=session(db.rpc,{delay:300});t.after(()=>a.close());
  for(let i=0;i<3;i++) {a.enqueue(add(String(i)));t.mock.timers.tick(100);}
  await Promise.resolve();
  assert.deepEqual(db.read().els.map(e=>e.id),['0','1','2']);
  await a.flush();
});
test('lost response retries the exact batch id and never replays an old update',async t=>{
  const db=server();let lost=true;const ids=[];
  const a=session(async(n,p)=>{ids.push(p.p_batch);const r=await db.rpc(n,p);if(lost){lost=false;throw Error('response lost');}return r;});t.after(()=>a.close());
  a.enqueue(add('one'));assert.equal(await a.flush(),false);assert.equal(a.dirty(),true);
  await a.flush();assert.equal(ids[0],ids[1]);assert.equal(db.read().els.length,1);assert.equal(a.dirty(),false);
});
test('offline queue survives reload and is scoped to account and board',async t=>{
  const db=server(), disk=storage();const a=session(async()=>{throw Error('offline');},{storage:disk});
  a.enqueue(add('draft'));await a.flush();a.close();
  const b=session(db.rpc,{storage:disk}), other=session(db.rpc,{storage:disk,userId:'another'}), anotherBoard=session(db.rpc,{storage:disk,boardId:'board-b'});
  t.after(()=>{b.close();other.close();anotherBoard.close();});
  assert.equal(b.dirty(),true);assert.equal(other.dirty(),false);assert.equal(anotherBoard.dirty(),false);
  await b.flush();assert.equal(db.read().els[0].id,'draft');assert.equal(b.dirty(),false);
});
test('late response from a closed board cannot update the active view',async()=>{
  const wait=deferred();let renders=0;
  const a=session(()=>wait.promise,{onState:()=>renders++});a.enqueue(add('old'));const p=a.flush();a.close();const before=renders;
  wait.resolve({data:{data:{els:[{id:'old'}]},revision:1}});await p;assert.equal(renders,before);
});
test('concurrent refresh cannot roll a newer server revision backwards',async t=>{
  const wait=deferred(), db=server();const a=session((name,args)=>name==='edu_board_get'?wait.promise:db.rpc(name,args));t.after(()=>a.close());
  const refresh=a.refresh();a.enqueue(add('new'));await a.flush();
  wait.resolve({data:[{data:{els:[],_revision:0}}]});await refresh;
  assert.equal(a.view().els[0].id,'new');
});
test('an unchanged board is read once without redrawing',async t=>{
  const wait=deferred(), stamp='2026-11-18T12:00:00Z';let reads=0,renders=0;
  const a=session((name,args,since)=>{reads++;assert.equal(since,stamp);return wait.promise;},
    {initialUpdatedAt:stamp,onState:()=>renders++});t.after(()=>a.close());
  const both=Promise.all([a.refresh(),a.refresh()]);
  wait.resolve({data:[]});
  assert.deepEqual(await both,[true,true]);assert.equal(reads,1);assert.equal(renders,1);
});
test('remote hints survive saves until their sender confirms persistence',async t=>{
  const db=server(),states=[],a=session(db.rpc,{onStatus:s=>states.push(s)});t.after(()=>a.close());
  a.receive(add('remote'),'remote-op');a.enqueue(add('mine'));await a.flush();
  assert.deepEqual(new Set(a.view().els.map(e=>e.id)),new Set(['mine','remote']));
  assert.equal(states.at(-1),'remote-pending');
  await db.rpc('edu_board_apply',{p_batch:'remote-batch',p_ops:[add('remote')]});
  await a.ack(['remote-op']);assert.equal(a.view().els.filter(e=>e.id==='remote').length,1);
  assert.equal(states.at(-1),'saved');
});
test('clear and undo only affect known objects; a new remote object survives',()=>{
  const data={els:[{id:'a'},{id:'remote'}],bg:'grid'};
  const cleared=applyOps(data,[{k:'del',ids:['a']}]);
  const undone=applyOps(cleared,[{k:'add',els:[{id:'a'}]}]);
  assert.deepEqual(undone.els.map(e=>e.id),['remote','a']);assert.equal(data.els.length,2);
});
test('timeout retains the queue and batch for a retry',async t=>{
  const a=session(()=>new Promise(()=>{}),{timeout:15});t.after(()=>a.close());
  a.enqueue(add('pending'));assert.equal(await a.flush(),false);assert.equal(a.dirty(),true);
});
test('storage errors are reported and never prevent saving to the server',async t=>{
  const db=server(),states=[];const a=session(db.rpc,{storage:{getItem(){throw Error();},setItem(){throw Error();},removeItem(){}},onStatus:s=>states.push(s)});t.after(()=>a.close());
  a.enqueue(add('a'));assert.ok(states.includes('storage-error'));await a.flush();assert.equal(db.read().els.length,1);
});
test('separate tabs of the same account keep independent offline drafts',async t=>{
  const disk=storage(),db=server();
  const a=session(db.rpc,{storage:disk,clientId:'tab-a'}),b=session(db.rpc,{storage:disk,clientId:'tab-b'});
  a.enqueue(add('a'));b.enqueue(add('b'));a.close();b.close();
  const restoredA=session(db.rpc,{storage:disk,clientId:'tab-a'}),restoredB=session(db.rpc,{storage:disk,clientId:'tab-b'});
  t.after(()=>{restoredA.close();restoredB.close();});
  assert.equal(restoredA.view().els[0].id,'a');assert.equal(restoredB.view().els[0].id,'b');
  await restoredA.flush();await restoredB.flush();assert.equal(db.read().els.length,2);
});
test('validation rejection keeps the draft and is not reported as a network outage',async t=>{
  const states=[],a=session(async()=>({error:{code:'22023',message:'Board too large'}}),{onStatus:s=>states.push(s)});t.after(()=>a.close());
  a.enqueue(add('a'));assert.equal(await a.flush(),false);
  assert.equal(a.dirty(),true);assert.equal(states.at(-1),'rejected');
});
