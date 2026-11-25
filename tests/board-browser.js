const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const mock = require('./mock.js')('unused-board-key',{},{});
const SITE = process.env.SITE || 'http://127.0.0.1:8765/';
const data = page => page.evaluate(()=>JSON.parse(localStorage.getItem('mockdb')));
const objects = page => page.evaluate(()=>JSON.parse(JSON.stringify(window.__board.els())));
async function flush(page) {
  if (await page.evaluate(()=>typeof window.__board.flush==='function')) return page.evaluate(()=>window.__board.flush());
  await page.waitForTimeout(1500); // baseline reproduction against the previous board
}
async function point(page,x=250,y=210) {
  await page.click('[data-tool=pt]');
  const box=await page.locator('#bdCanvas').boundingBox();
  await page.mouse.click(box.x+x,box.y+y);
}
async function open(page,id='board-a') {
  await page.goto(SITE+'board.html?b='+id);
  await page.waitForFunction(id=>window.__board && window.__board.board() && window.__board.board().id===id,id);
  await page.waitForSelector('#bdCanvas',{state:'visible'});
}
(async()=>{
  const browser=await chromium.launch();
  try {
    async function scenario(name, run, realtime=false) {
      if (process.env.BOARD_SCENARIO && !name.includes(process.env.BOARD_SCENARIO)) return;
      const context=await browser.newContext({viewport:{width:1280,height:820}});
      const errors=[];
      try {
        await context.route(/googleapis|gstatic/,r=>r.abort());await context.addInitScript(mock);
        if(process.env.BASELINE_BOARD) {
          const html=fs.readFileSync(process.env.BASELINE_BOARD,'utf8');
          await context.route('**/board.html?*',r=>r.fulfill({contentType:'text/html',body:html}));
        }
        const seed=await context.newPage();await seed.goto(SITE+'help.html');
        await seed.evaluate(realtime=>{
          const now=new Date().toISOString();localStorage.setItem('mockNoRealtime',JSON.stringify(!realtime));
          localStorage.setItem('mockdb',JSON.stringify({
            edu_profiles:[{user_id:'u1',role:'teacher',email:'teacher@test.local'},{user_id:'u2',role:'student',email:'kid@test.local'}],
            edu_students:[{id:'student-1',user_id:'u2',name:'Тестовый ученик'}],edu_lessons:[],edu_progress:[],
            edu_boards:['board-a','board-b'].map(id=>({id,student_id:'student-1',title:id,data:{els:[],bg:'grid'},revision:0,created_at:now,updated_at:now}))
          }));
        },realtime);
        async function tab(id) {
          const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
          await p.addInitScript(id=>sessionStorage.setItem('mockSessionTab',JSON.stringify({user:{id,email:id==='u1'?'teacher@test.local':'kid@test.local'}})),id);
          await open(p);return p;
        }
        await run({teacher:await tab('u1'),student:await tab('u2'),context,tab});
        assert.deepEqual(errors,[],name+' browser errors');console.log('PASS '+name);
      } finally {await context.close();}
    }
    await scenario('BOARD-UI-01 simultaneous independent points survive without realtime',async({teacher,student})=>{
      await Promise.all([point(teacher),point(student,450,220)]);
      await Promise.all([flush(teacher),flush(student)]);
      const snapshot=await data(teacher);
      assert.equal(snapshot.edu_boards[0].data.els.length,2,JSON.stringify({board:snapshot.edu_boards[0],batches:snapshot.edu_board_batches,teacher:await objects(teacher),student:await objects(student)}));
      await open(teacher);assert.equal((await objects(teacher)).length,2);
    });
    if(process.env.BASELINE_BOARD && !process.env.BOARD_SCENARIO) return;
    await scenario('BOARD-UI-02 new changes during delayed save reach the database',async({teacher})=>{
      await teacher.evaluate(()=>sessionStorage.setItem('mockBoardDelay','600'));
      await point(teacher);
      await teacher.evaluate(()=>{window.firstSave=window.__board.flush();});
      await point(teacher,400,220);
      assert.equal(await teacher.evaluate(()=>window.__board.pending()),true);
      await teacher.evaluate(()=>window.firstSave);await flush(teacher);
      await teacher.waitForFunction(()=>JSON.parse(localStorage.getItem('mockdb')).edu_boards[0].data.els.length===2);
      assert.equal(await teacher.textContent('#bdSave'),'Сохранено');
    });
    await scenario('BOARD-UI-03 reload restores offline draft; successful retry clears it',async({teacher})=>{
      await teacher.evaluate(()=>sessionStorage.setItem('mockBoardOffline','1'));await point(teacher);await flush(teacher);
      assert.match(await teacher.textContent('#bdSave'),/Нет связи/);
      await teacher.reload();await teacher.waitForFunction(()=>window.__board && window.__board.els().length===1);
      assert.equal(await teacher.evaluate(()=>window.__board.pending()),true);
      await teacher.evaluate(()=>sessionStorage.removeItem('mockBoardOffline'));await flush(teacher);
      assert.equal((await data(teacher)).edu_boards[0].data.els.length,1);
      assert.equal(await teacher.evaluate(()=>window.__board.pending()),false);
    });
    await scenario('BOARD-UI-04 lost response does not duplicate committed actions',async({teacher})=>{
      await teacher.evaluate(()=>sessionStorage.setItem('mockBoardLoseResponse','1'));await point(teacher);
      assert.equal(await flush(teacher),false);await flush(teacher);
      const db=await data(teacher);assert.equal(db.edu_boards[0].data.els.length,1);assert.equal(db.edu_board_batches.length,1);
    });
    await scenario('BOARD-UI-05 switching boards preserves draft in the original board',async({teacher})=>{
      await teacher.evaluate(()=>sessionStorage.setItem('mockBoardOffline','1'));await point(teacher);await flush(teacher);
      await teacher.click('#bdPick');await teacher.click('[data-open="board-b"]');
      await teacher.waitForFunction(()=>window.__board.board().id==='board-b');assert.equal((await objects(teacher)).length,0);
      await teacher.evaluate(()=>sessionStorage.removeItem('mockBoardOffline'));await point(teacher,400,230);await flush(teacher);
      await teacher.click('#bdPick');await teacher.click('[data-open="board-a"]');
      await teacher.waitForFunction(()=>window.__board.board().id==='board-a');await flush(teacher);
      const boards=(await data(teacher)).edu_boards;assert.equal(boards[0].data.els.length,1);assert.equal(boards[1].data.els.length,1);
    });
    await scenario('BOARD-UI-06 clear and undo preserve a concurrent unseen object',async({teacher,student})=>{
      await point(teacher);await flush(teacher);await open(student);
      await point(student,450,220);await flush(student);
      await teacher.click('#bdClear');await flush(teacher);
      assert.equal((await data(teacher)).edu_boards[0].data.els.length,1);
      await teacher.click('#bdUndo');await flush(teacher);
      assert.equal((await data(teacher)).edu_boards[0].data.els.length,2);
    });
    await scenario('BOARD-UI-07 live operations converge and remote objects are not resaved',async({teacher,student})=>{
      await teacher.waitForFunction(()=>document.querySelector('#bdPeer').textContent.includes('Ученик на доске'));
      await point(teacher);await student.waitForFunction(()=>window.__board.els().length===1);await flush(teacher);
      await point(student,450,220);await teacher.waitForFunction(()=>window.__board.els().length===2);await flush(student);
      assert.equal((await data(teacher)).edu_board_batches.length,2);
      await open(teacher);assert.equal((await objects(teacher)).length,2);
    },true);
    await scenario('BOARD-UI-12 a section drawing from lesson 5 is shared and can be annotated',async({teacher,student})=>{
      await teacher.click('#bdFigBtn');
      const choices=teacher.locator('[data-fig^="g5-section-"]');
      assert.deepEqual(await choices.evaluateAll(buttons=>buttons.map(b=>b.dataset.fig)),
        Array.from({length:14},(_,i)=>'g5-section-'+(i+1)+'.svg'));
      const hw=teacher.locator('[data-fig^="g5-hw-v2-"]');
      assert.deepEqual(await hw.evaluateAll(buttons=>buttons.map(b=>b.dataset.fig)),
        Array.from({length:6},(_,i)=>'g5-hw-v2-'+(i+1)+'.svg'));
      for (const image of await hw.locator('img').all()) await image.evaluate(img=>img.decode());
      for (const image of await choices.locator('img').all()) await image.evaluate(img=>img.decode());
      await hw.last().click();
      await flush(teacher);
      const src='fig:g5-hw-v2-6.svg';
      await student.waitForFunction(src=>window.__board.els().some(e=>e.src===src),src);
      const drawing=(await objects(student)).find(e=>e.src===src);
      assert.equal(drawing.hh,404);
      await point(student,430,330);
      await flush(student);
      await teacher.waitForFunction(()=>window.__board.els().some(e=>e.t==='pt'));
      await open(teacher);
      assert.deepEqual((await objects(teacher)).map(e=>e.t),['img','pt']);
    },true);
    await scenario('BOARD-UI-13 paired exercises appear next to each other on the shared board',async({teacher,student})=>{
      await teacher.click('#bdFigBtn');
      const advanced=teacher.locator('[data-fig^="g5-advanced-"]');
      assert.equal(await advanced.count(),4);
      for(const image of await advanced.locator('img').all())await image.evaluate(im=>im.decode());
      const groups=teacher.locator('#bdFigs .grid.pair');
      const names=Array.from({length:5},(_,i)=>['a','b'].map(v=>'g5-pair-'+(i+1)+v+'.svg'));
      assert.deepEqual(await groups.evaluateAll(gs=>gs.map(g=>[...g.querySelectorAll('button')].map(b=>b.dataset.fig))),names);
      const pair=groups.last();
      for(const image of await pair.locator('img').all())await image.evaluate(im=>im.decode());
      await pair.locator('button').first().click();
      await teacher.click('#bdFigBtn');
      await pair.locator('button').last().click();
      await flush(teacher);
      await student.waitForFunction(()=>window.__board.els().length===2);
      const [a,b]=await objects(student);
      assert.equal(a.src,'fig:g5-pair-5a.svg');
      assert.equal(b.src,'fig:g5-pair-5b.svg');
      assert(b.x>a.x+a.ww);
      assert.equal(b.y,a.y);
    },true);
    await scenario('BOARD-UI-11 pupil sees continuous writing despite silent realtime loss',async({teacher,student})=>{
      await teacher.waitForFunction(()=>document.querySelector('#bdPeer').textContent.includes('Ученик на доске'));
      for (const p of [teacher,student]) await p.evaluate(()=>{ BroadcastChannel.prototype.postMessage=function(){}; });
      await teacher.click('[data-tool=pen]');
      const box=await teacher.locator('#bdCanvas').boundingBox();
      let latency;
      const start=Date.now();
      await Promise.all([
        student.waitForFunction(()=>window.__board.els().length>0,undefined,{timeout:2500,polling:50})
          .then(()=>{latency=Date.now()-start;}),
        (async()=>{
          for(let i=0;i<24;i++) {
            await teacher.mouse.move(box.x+200+i*18,box.y+220);await teacher.mouse.down();
            await teacher.mouse.move(box.x+210+i*18,box.y+235);await teacher.mouse.up();
            await teacher.waitForTimeout(110);
          }
        })()
      ]);
      await student.waitForFunction(()=>window.__board.els().length===24,undefined,{timeout:2500,polling:50});
      console.log('  First stroke via fallback: '+latency+' ms');
      assert.match(await student.textContent('#bdPeer'),/Учитель на доске/);
      assert.equal((await data(teacher)).edu_boards[0].data.els.length,24);
    },true);
    await scenario('BOARD-UI-08 undo redo text and background changes persist',async({teacher})=>{
      await teacher.click('[data-tool=text]');const box=await teacher.locator('#bdCanvas').boundingBox();
      await teacher.mouse.click(box.x+250,box.y+210);await teacher.fill('#bdText','Проверка сохранения');await teacher.press('#bdText','Enter');
      await flush(teacher);assert.equal((await data(teacher)).edu_boards[0].data.els[0].s,'Проверка сохранения');
      await teacher.click('#bdUndo');await flush(teacher);assert.equal((await data(teacher)).edu_boards[0].data.els.length,0);
      await teacher.click('#bdRedo');await teacher.click('#bdBg');await flush(teacher);
      await open(teacher);assert.equal((await objects(teacher))[0].s,'Проверка сохранения');assert.equal((await data(teacher)).edu_boards[0].data.bg,'plain');
    });
    await scenario('BOARD-UI-09 same-account tabs restore separate offline drafts',async({teacher,tab})=>{
      const second=await tab('u1');
      await teacher.evaluate(()=>sessionStorage.setItem('mockBoardOffline','1'));
      await second.evaluate(()=>sessionStorage.setItem('mockBoardOffline','1'));
      await point(teacher);await point(second,450,230);await Promise.all([flush(teacher),flush(second)]);
      await Promise.all([teacher.reload(),second.reload()]);
      for (const p of [teacher,second]) {
        await p.waitForFunction(()=>window.__board && window.__board.els().length===1);
        await p.evaluate(()=>sessionStorage.removeItem('mockBoardOffline'));await flush(p);
      }
      assert.equal((await data(teacher)).edu_boards[0].data.els.length,2);
    });
    await scenario('BOARD-UI-10 remote changes during text editing survive cancel and submit',async({teacher,student})=>{
      const box=await teacher.locator('#bdCanvas').boundingBox();
      await teacher.click('[data-tool=text]');await teacher.mouse.click(box.x+250,box.y+210);
      await teacher.fill('#bdText','Не терять ввод');await point(student,450,230);await flush(student);
      // A refresh received while the editor is open must be applied after editing finishes.
      await teacher.evaluate(()=>window.dispatchEvent(new Event('online')));
      await teacher.press('#bdText','Enter');await flush(teacher);
      assert.equal((await data(teacher)).edu_boards[0].data.els.length,2);
      await teacher.click('[data-tool=text]');await teacher.mouse.click(box.x+250,box.y+320);
      await point(student,550,330);await flush(student);
      await teacher.evaluate(()=>window.dispatchEvent(new Event('online')));
      await teacher.press('#bdText','Escape');
      await teacher.waitForFunction(()=>window.__board.els().length===3);
    },true);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
