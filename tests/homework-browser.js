// Focused journal regressions. No production key or live pupil data is used.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const mock = require('./mock.js')('test-key-unused', {}, {});
const SITE = process.env.SITE || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.route(/googleapis|gstatic/, route => route.abort());
    await context.addInitScript(mock);
    if (process.env.BASELINE_JOURNAL) {
      const html = require('node:fs').readFileSync(process.env.BASELINE_JOURNAL, 'utf8');
      await context.route('**/journal.html', route => route.fulfill({contentType:'text/html', body:html}));
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(SITE + 'help.html');
    await page.evaluate(() => {
      localStorage.setItem('mockSession', JSON.stringify({user: {id: 'u1', email: 'teacher@test.local'}}));
      const db = JSON.parse(localStorage.getItem('mockdb') || 'null') || {edu_profiles: [
        {user_id:'u1',email:'teacher@test.local',role:'teacher'},
        {user_id:'u2',email:'kid@test.local',role:'student'}], edu_students:[],edu_lessons:[],edu_progress:[]};
      db.edu_students = [{id:'student-1',user_id:'u2',name:'Тестовый ученик'}];
      localStorage.setItem('mockdb', JSON.stringify(db));
    });
    await page.goto(SITE + 'journal.html');
    await page.waitForFunction(() => document.querySelector('#lTopic option[value="el20"]'));
    for (let i = 1; i <= 20; i++) {
      await page.fill('#lHw', '');
      await page.selectOption('#lTopic', 'el' + i);
      const text = await page.inputValue('#lHw');
      const count = i <= 13 ? 6 : i <= 19 ? 4 : 3;
      assert.equal((text.match(/^Д\d+\./gm) || []).length, count, 'Full homework for el' + i);
      assert.equal(await page.inputValue('#lQuiz'), 'quiz-el' + i + 'b');
    }
    console.log('PASS JOURNAL-01: full conditions and matching quiz for all 20 EGE lessons');
    await page.fill('#lHw', 'Моя индивидуальная задача');
    await page.selectOption('#lTopic', 'el13');
    assert.equal(await page.inputValue('#lHw'), 'Моя индивидуальная задача');
    console.log('PASS JOURNAL-02: changing topic preserves custom homework');
    await page.click('#lHwSug button:has-text("Подставить")');
    assert.match(await page.inputValue('#lHw'), /300 000 рублей/);
    await page.click('#lHwSug button:has-text("Полностью из конспекта")');
    assert.match(await page.inputValue('#lHw'), /110 000 рублей/);
    assert.equal(await page.locator('#lHwSug button:has-text("Номера из презентации учебника")').count(), 0);
    console.log('PASS JOURNAL-03: both suggestion actions insert complete tasks');
    await page.fill('#lHw', '');
    await page.selectOption('#lTopic', 'el2');
    const math = await page.inputValue('#lHw');
    assert.match(math, /\(2x \+ 1\)\/\(x − 1\)/);
    assert.match(math, /√\(x \+ 10\)/);
    assert.match(math, /2\^\(3 − x\)/);
    console.log('PASS JOURNAL-04: fractions, radicals and exponents retain their scope');
    await page.click('#lSend');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('mockdb')).edu_lessons || []).some(l => l.hw_sent_at && l.topic === 'el2'));
    await page.fill('#lHw', '');
    await page.selectOption('#lTopic', 'g5');
    const sections = await page.inputValue('#lHw');
    assert.deepEqual([...sections.matchAll(/\(чертёж Д([1-6]) · вариант 2\)/g)].map(m=>m[1]), ['1','2','3','4','5','6']);
    assert.doesNotMatch(sections, /периметр|площадь/);
    for (const n of [1,3,4,6]) await page.getByRole('checkbox',{name:'Д'+n,exact:true}).uncheck();
    await page.getByRole('button',{name:'Подставить выбранные с рисунками'}).click();
    assert.deepEqual([...(await page.inputValue('#lHw')).matchAll(/^Д([1-6])\./gm)].map(m=>m[1]), ['2','5']);
    await page.click('#lSend');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mockdb')).edu_lessons.some(l => l.hw_sent_at && l.topic === 'g5'));
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('mockdb'));
      db.edu_lessons.push({id:'legacy-g5-homework',student_id:'student-1',topic:'g5',date:'2026-11-01',hw_sent_at:'2026-11-01T12:00:00Z',homework:'Прежнее условие (чертёж Д5)'});
      localStorage.setItem('mockdb',JSON.stringify(db));
      localStorage.setItem('mockSession', JSON.stringify({user: {id:'u2',email:'kid@test.local'}}));
    });
    await page.goto(SITE + 'homework.html');
    await page.waitForSelector('.hw-card');
    const received = await page.textContent('#hwBox');
    assert.match(received, /Д1\./);
    assert.match(received, /Д6\./);
    assert.match(received, /\(2x \+ 1\)\/\(x − 1\)/);
    console.log('PASS JOURNAL-05: sent task conditions reach the student');
    const diagrams=page.locator('.hw-card .hw-text .hw-diagram img');
    assert.deepEqual(await diagrams.evaluateAll(a=>a.map(x=>x.getAttribute('src'))), ['assets/fig/g5-hw-v2-2.svg','assets/fig/g5-hw-v2-5.svg']);
    for(const image of await diagrams.all()) await image.evaluate(img=>img.decode());
    const legacy=page.locator('#hw-legacy-g5-homework a[href="g5.html#g5-homework-task-5"]');
    await legacy.click();
    await page.waitForURL('**/g5.html#g5-homework-task-5');
    const drawing=page.locator('#g5-homework-task-5 img');
    await drawing.scrollIntoViewIfNeeded(); await drawing.evaluate(img=>img.decode());
    assert.equal(await drawing.getAttribute('src'),'assets/fig/g5-hw-5.svg');
    assert.equal(await page.locator('#g5-homework-solutions').count(), 0);
    console.log('PASS: two selected tasks show inline drawings; previously assigned drawings stay unchanged');
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('mockdb'));
      db.edu_reviews = [
        {id:'rv-1111111111',student_id:'student-1',items:[{text:'Моя задача для повторения'}]},
        {id:'rv-2222222222',student_id:'another-student',items:[{text:'Чужая задача для повторения'}]}
      ];
      localStorage.setItem('mockdb', JSON.stringify(db));
    });
    await page.goto(SITE + 'review.html?id=rv-1111111111');
    await page.waitForSelector('.qz-q');
    assert.match(await page.textContent('#qzForm'), /Моя задача для повторения/);
    await page.goto(SITE + 'review.html?id=rv-2222222222');
    await page.waitForFunction(() => document.querySelector('#rvBox').textContent.includes('не найдено'));
    assert.doesNotMatch(await page.textContent('#qzForm'), /Чужая задача для повторения/);
    console.log('PASS REVIEW-01: mock and review UI distinguish own and foreign assignments');
    assert.deepEqual(errors, []);
    console.log('PASS JOURNAL-06: no uncaught browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
