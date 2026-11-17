const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const mock=require('./mock.js')('unused-summary-key',{},{}),SITE=process.env.SITE;
(async()=>{
 const browser=await chromium.launch();
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];
  await ctx.route(/googleapis|gstatic/,r=>r.abort());await ctx.addInitScript(mock);
  const t=await ctx.newPage();t.on('pageerror',e=>errors.push(e.message));await t.goto(SITE+'help.html');
  await t.evaluate(()=>{
   localStorage.setItem('mockSession',JSON.stringify({user:{id:'u1',email:'teacher@test.local'}}));
   const now=new Date().toISOString();
   localStorage.setItem('mockdb',JSON.stringify({edu_profiles:[{user_id:'u1',role:'teacher'},{user_id:'u2',role:'student'},{user_id:'u3',role:'student'}],edu_students:[{id:'s1',user_id:'u2',name:'Тестовый ученик'},{id:'s2',user_id:'u3',name:'Другой ученик'}],edu_progress:[],edu_lessons:[{id:'l1',student_id:'s1',date:'2026-11-17',topic:'el2',homework:'Решить задачи 1–3',notes:'PRIVATE TEACHER NOTE',hw_sent_at:now},{id:'l2',student_id:'s2',date:'2026-11-16',homework:'Чужое ДЗ'}],edu_boards:[{id:'b1',student_id:'s1',lesson_id:'l1',title:'Доска занятия',data:{els:[{id:'point1',t:'pt',x:200,y:200,c:'#222',r:4}],bg:'grid'},revision:0,created_at:now,updated_at:now}]}));
  });
  await t.goto(SITE+'journal.html');await t.waitForSelector('a[href^="summary.html?lesson=l1"]');
  await t.click('a[href^="summary.html?lesson=l1"]');await t.waitForSelector('#summaryEditor:not([hidden])');
  assert.equal(await t.inputValue('#sumHomework'),'Решить задачи 1–3');assert.doesNotMatch(await t.inputValue('#sumCovered'),/PRIVATE/);
  await t.fill('#sumFormulas','x² − 5x + 6 = (x − 2)(x − 3)');await t.fill('#sumCovered','Разобрали ОДЗ и чётность');
  await t.click('#sumSave');await t.waitForFunction(()=>document.querySelector('#summaryStatus').textContent.includes('Черновик сохранён'));
  const pupil=await ctx.newPage();pupil.on('pageerror',e=>errors.push(e.message));await pupil.addInitScript(()=>sessionStorage.setItem('mockSessionTab',JSON.stringify({user:{id:'u2',email:'kid@test.local'}})));
  await pupil.goto(SITE+'summary.html?lesson=l1');await pupil.waitForFunction(()=>document.querySelector('#summaryStatus').textContent.includes('пока не отправлен'));
  console.log('PASS SUMMARY-UI-01 draft is teacher-only; topic and homework prefill without private notes');
  const popup=ctx.waitForEvent('page');await t.click('#sumBoards a');const board=await popup;board.on('pageerror',e=>errors.push(e.message));await board.waitForSelector('#summaryCapture');await board.waitForSelector('#bdCanvas',{state:'visible'});
  await board.click('#summaryCapture');const crop=await board.locator('#summaryCrop').boundingBox();await board.mouse.move(crop.x+crop.width/2-150,crop.y+crop.height/2-100);await board.mouse.down();await board.mouse.move(crop.x+crop.width/2+150,crop.y+crop.height/2+100);await board.mouse.up();
  await t.waitForSelector('#sumFragments img');assert.equal(await t.locator('#sumFragments img').count(),1);await board.waitForFunction(()=>document.querySelector('#summaryCaptureStatus').textContent.includes('Фрагмент добавлен'));
  await t.fill('#sumFragments input','Пример с доски');await t.click('#sumPreview');await t.waitForSelector('#summaryPreview:not([hidden])');assert.match(await t.textContent('#summaryContent'),/Пример с доски/);assert.doesNotMatch(await t.textContent('#summaryContent'),/PRIVATE/);
  await t.click('#sumBack');await t.click('#sumPublish');await t.waitForFunction(()=>document.querySelector('#summaryStatus').textContent.includes('Итог отправлен'));
  await pupil.reload();await pupil.waitForSelector('#summaryContent img');assert.match(await pupil.textContent('#summaryContent'),/ОДЗ и чётность/);assert.equal(await pupil.locator('#summaryEditor:visible').count(),0);
  await pupil.goto(SITE+'homework.html');await pupil.waitForSelector('#lessonSummaries a');assert.match(await pupil.textContent('#lessonSummaries'),/17\.11\.2026/);
  console.log('PASS SUMMARY-UI-02 crop a real board fragment, preview, publish and discover the pupil summary');
  await t.fill('#sumCovered','PRIVATE NEW DRAFT');await t.click('#sumSave');await t.waitForFunction(()=>document.querySelector('#summaryStatus').textContent.includes('ранее отправленный'));
  await pupil.goto(SITE+'summary.html?lesson=l1');await pupil.waitForSelector('#summaryContent img');assert.doesNotMatch(await pupil.textContent('#summaryContent'),/PRIVATE/);
  const outsider=await ctx.newPage();await outsider.addInitScript(()=>sessionStorage.setItem('mockSessionTab',JSON.stringify({user:{id:'u3',email:'new@test.local'}})));await outsider.goto(SITE+'summary.html?lesson=l1');await outsider.waitForFunction(()=>document.querySelector('#summaryStatus').textContent.includes('недоступен'));assert.equal(await outsider.locator('#summaryContent img').count(),0);
  console.log('PASS SUMMARY-UI-03 later draft edits and foreign lessons remain private');
  await t.evaluate(()=>localStorage.setItem('mockSummaryFail','1'));await t.fill('#sumFormulas','Не терять этот текст');await t.click('#sumSave');await t.waitForFunction(()=>document.querySelector('#summaryStatus').textContent.includes('Не удалось сохранить'));assert.equal(await t.inputValue('#sumFormulas'),'Не терять этот текст');assert.equal(await t.locator('#sumFragments img').count(),1);await t.evaluate(()=>localStorage.removeItem('mockSummaryFail'));
  await t.click('#sumUnpublish');await t.waitForFunction(()=>document.querySelector('#summaryStatus').textContent.includes('Доступ ученику закрыт'));
  await pupil.reload();await pupil.waitForFunction(()=>document.querySelector('#summaryStatus').textContent.includes('пока не отправлен'));assert.equal(await pupil.locator('#summaryContent img').count(),0);
  console.log('PASS SUMMARY-UI-04 failed save preserves input; withdrawal removes pupil access');
  await t.evaluate(()=>window.scrollTo(0,0));
  await t.screenshot({path:process.env.SUMMARY_SCREENSHOT||'/private/tmp/lesson-summary-desktop.png',fullPage:true});
  await t.setViewportSize({width:390,height:844});await t.screenshot({path:'/private/tmp/lesson-summary-mobile.png',fullPage:true});
  assert.equal(await t.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'mobile layout must not overflow');assert.deepEqual(errors,[]);
  console.log('PASS SUMMARY-UI-05 desktop/mobile editor has no overflow or browser errors');
  await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
