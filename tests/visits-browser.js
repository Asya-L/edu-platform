// Synthetic data only. Covers file-only lessons and live visits without editing pupil records.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const fs = require('node:fs');
const mock = require('./mock.js')('unused-test-key', {}, {});
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.route(/googleapis|gstatic/, route => route.abort());
    await context.addInitScript(mock);
    await context.addInitScript(() => {
      const create = window.supabase.createClient;
      window.supabase.createClient = function(...args) {
        const sb = create(...args), from = sb.from, rpc = sb.rpc;
        sb.from = function(table) {
          if (table === 'edu_visits' && localStorage.getItem('failVisits')) {
            const q = {select(){return q;}, order(){return q;}, limit(){return q;}, then(ok,no){return Promise.resolve({error:{message:'private server detail'}}).then(ok,no);}};
            return q;
          }
          return from(table);
        };
        sb.rpc = function(name, args) {
          if (name === 'edu_ping' && localStorage.getItem('failPing')) return Promise.resolve({error:{message:'private server detail'}});
          return rpc(name,args);
        };
        return sb;
      };
    });
    if (process.env.BASELINE_JOURNAL) {
      await context.route('**/journal.html', route => route.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.BASELINE_JOURNAL,'utf8')}));
    }
    const page = await context.newPage(), errors = [], warnings = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
    const SITE = process.env.SITE;
    await page.goto(SITE + 'help.html');
    await page.evaluate(() => {
      localStorage.setItem('mockSession', JSON.stringify({user:{id:'u1',email:'teacher@test.local'}}));
      localStorage.setItem('mockdb',JSON.stringify({
        edu_profiles:[{user_id:'u1',role:'teacher'},{user_id:'u2',role:'student'}],
        edu_students:[{id:'s1',user_id:'u2',name:'Тестовый ученик'}],edu_progress:[],
        edu_lessons:[
          {id:'empty',student_id:'s1',date:'2026-11-12',homework:null},
          {id:'file-only',student_id:'s1',date:'2026-11-10',homework:null,hw_files:[{name:'Задачи.pdf',path:'test/tasks.pdf'}]},
          {id:'text',student_id:'s1',date:'2026-11-09',homework:'Текст задания'}
        ],edu_visits:[]
      }));
    });
    await page.clock.install();
    await page.goto(SITE + 'journal.html');
    await page.waitForSelector('#log .lesson');
    assert.equal(await page.locator('#log .lesson').count(),3);
    assert.match(await page.textContent('#log'),/10\.11\.2026/);
    assert.match(await page.textContent('#log'),/Задачи.pdf/);
    assert.deepEqual(errors,[]);
    console.log('PASS LESSON-01: empty and file-only lessons render along with later records');
    await page.fill('#lHw','Несохранённое задание');
    await page.evaluate(() => {
      const db=JSON.parse(localStorage.getItem('mockdb'));
      const now=new Date().toISOString();
      db.edu_visits=[{student_id:'s1',day:now.slice(0,10),first_at:now,last_at:now,visits:1,active_min:12,pages:{homework:1}}];
      localStorage.setItem('mockdb',JSON.stringify(db));
    });
    await page.clock.runFor(30001);
    await page.waitForFunction(() => document.querySelector('#visits').textContent.includes('12 мин'));
    assert.equal(await page.inputValue('#lHw'),'Несохранённое задание');
    assert.equal(await page.locator('#log .lesson').count(),3);
    console.log('PASS VISITS-01: visit appears within 30 seconds while unsaved homework stays intact');
    await page.evaluate(() => localStorage.setItem('failVisits','1'));
    await page.clock.runFor(30001);
    await page.waitForFunction(() => document.querySelector('#visits').textContent.includes('последние загруженные'));
    assert.match(await page.textContent('#visits'),/12 мин/);
    await page.evaluate(() => localStorage.removeItem('failVisits'));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.querySelector('#visits').textContent.includes('Не удалось'));
    console.log('PASS VISITS-02: failed refresh retains previous visits and reconnect recovers');
    await page.evaluate(() => localStorage.setItem('failVisits','1'));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#visits').textContent.includes('Не удалось загрузить'));
    assert.doesNotMatch(await page.textContent('#visits'),/ещё не заходил|не включён/);
    console.log('PASS VISITS-03: initial read error is not shown as absent visits');
    await page.evaluate(() => {
      localStorage.removeItem('failVisits');
      localStorage.setItem('failPing','1');
      localStorage.setItem('mockSession',JSON.stringify({user:{id:'u2',email:'kid@test.local'}}));
    });
    await page.goto(SITE+'help.html');
    await page.waitForFunction(() => window.KABINET && window.KABINET.sb);
    await page.clock.runFor(1000);
    assert(warnings.some(t=>t.includes('Не удалось записать посещение')));
    assert(!warnings.some(t=>t.includes('private server detail')));
    await page.evaluate(() => {
      localStorage.removeItem('failPing');
      const db=JSON.parse(localStorage.getItem('mockdb')); db.edu_visits=[]; localStorage.setItem('mockdb',JSON.stringify(db));
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mockdb')).edu_visits.length===1);
    assert.deepEqual(errors,[]);
    console.log('PASS VISITS-04: RPC response errors are diagnosed without private details; reconnect records activity');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
