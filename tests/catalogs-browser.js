const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const catalog=require('../assets/catalogs.js');
const mock=require('./mock.js')('unused-catalog-key',{},{});
const SITE=process.env.SITE;
(async()=>{
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext(),errors=[],loads=[];
  await context.route(/googleapis|gstatic/,r=>r.abort());await context.addInitScript(mock);
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  p.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/assets/catalogs.js'))loads.push(r.url());});
  await p.goto(SITE+'help.html');
  await p.evaluate(()=>{
   const now=new Date().toISOString();
   localStorage.setItem('mockSession',JSON.stringify({user:{id:'u2',email:'kid@test.local'}}));
   localStorage.setItem('mockdb',JSON.stringify({edu_profiles:[{user_id:'u1',role:'teacher',email:'teacher@test.local'},{user_id:'u2',role:'student',email:'kid@test.local'}],edu_students:[{id:'s1',user_id:'u2',name:'Тестовый ученик'}],edu_progress:[{student_id:'s1',topics:{g1:'done',el2:'work'}}],edu_lessons:[{id:'lesson-1',student_id:'s1',date:'2026-11-17',topic:'el2',homework:'Индивидуальная задача',quiz:'quiz-el2b',hw_sent_at:now,created_at:now}],edu_ws_answers:[{student_id:'s1',ws:'wsma5',answers:{one:'1'},updated_at:now,submitted_at:now}]}));
  });
  await p.goto(SITE+'index.html');await p.waitForSelector('#meBox:not([hidden])');await p.waitForSelector('#hwBox .hw-card');
  assert((await p.textContent('#meBox')).includes('1 из '+Object.keys(catalog.topics).length+' тем освоено'));
  await p.click('#meBox summary');await p.waitForSelector('#meBox .me-chips:not([hidden])');
  assert((await p.textContent('#meBox .done')).includes(catalog.topics.g1));
  assert((await p.textContent('#meBox .work')).includes(catalog.topics.el2));
  assert.equal(await p.textContent('#hwBox a[href="el2.html"]'),catalog.topics.el2);
  assert((await p.textContent('#hwBox')).includes(catalog.quizzes['quiz-el2b']));
  assert.equal(loads.length,1,'both homepage blocks must load the catalogue once');
  console.log('PASS CATALOG-UI-01: both homepage blocks show progress and assigned homework from one catalogue');
  await p.goto(SITE+'homework.html');await p.waitForSelector('#hwBox .hw-card');
  assert.equal(await p.textContent('#hwBox a[href="el2.html"]'),catalog.topics.el2);
  assert((await p.textContent('#hwBox')).includes(catalog.quizzes['quiz-el2b']));
  assert.equal(await p.getAttribute('#hwBox a[href^="quiz-el2b.html"]','href'),'quiz-el2b.html?hw=lesson-1');
  console.log('PASS CATALOG-UI-02: homework retains topic names, quiz labels and assignment links');
  await p.evaluate(()=>localStorage.setItem('mockSession',JSON.stringify({user:{id:'u1',email:'teacher@test.local'}})));
  await p.goto(SITE+'journal.html');await p.waitForSelector('#log .lesson');
  const topics=await p.locator('#lTopic option').evaluateAll(nodes=>nodes.filter(n=>n.value && n.value!=='other').map(n=>[n.value,n.textContent]));
  assert.deepEqual(topics,catalog.groups.flatMap(group=>group[1]));
  assert((await p.textContent('#wsl')).includes(catalog.worksheets.wsma5));
  assert.equal(await p.getAttribute('#wsl a','href'),'t.html#wsma5');
  const snapshot=await p.evaluate(()=>({shared:window.EDU_CATALOG.homeworkHints.el2.text,generated:window.EDU_EGE_HOMEWORK.el2}));
  assert.equal(snapshot.shared,catalog.homeworkHints.el2.text);
  assert.notEqual(snapshot.generated,snapshot.shared,'EGE override should stay local to the journal');
  await p.selectOption('#lTopic','el2');assert.equal(await p.inputValue('#lHw'),snapshot.generated);
  console.log('PASS CATALOG-UI-03: journal retains every topic and worksheet label; generated EGE homework stays isolated');
  await p.evaluate(()=>{
    const db=JSON.parse(localStorage.getItem('mockdb'));
    db.edu_quiz_results=[{student_id:'s1',quiz:'quiz-el2b',score:4,total:6,wrong:[1,2],created_at:new Date().toISOString()}];
    localStorage.setItem('mockdb',JSON.stringify(db));
  });
  await p.goto(SITE+'progress.html');await p.waitForSelector('#pgBody table');
  assert((await p.textContent('#pgBody')).includes(catalog.quizzes['quiz-el2b']));
  assert((await p.textContent('#pgBody')).includes(catalog.worksheets.wsma5));
  assert((await p.textContent('#pgBody')).includes('4/6'));
  assert.deepEqual(errors,[]);
  console.log('PASS CATALOG-UI-04: progress retains quiz and worksheet names and recorded scores');
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
