const assert=require('node:assert/strict'), {chromium}=require('playwright');
const {randomBytes,createCipheriv}=require('node:crypto');
const SITE=process.env.SITE;
const keys={
 'quiz-inf4b': ['код000','код10101','код0010','a','ТЕСТ','42']
}; // Synthetic q1: what matters here is that 0 and 000 do not compare equal.
(async()=>{const b=await chromium.launch();try{
 const cipherKey=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cipherKey,iv);
 const pack=Buffer.concat([iv,cipher.update(JSON.stringify({title:'Информатика',html:'<main><h2>Темы</h2></main>'})),cipher.final(),cipher.getAuthTag()]);
 const c=await b.newContext({acceptDownloads:true});await c.route(/googleapis|gstatic/,r=>r.abort());
 await c.route('**/t/ege-inf.bin?*',r=>r.fulfill({body:pack}));
 await c.addInitScript(require('./mock.js')(cipherKey.toString('base64'),keys,{}));
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(SITE+'help.html');
 await p.evaluate(()=>{
  localStorage.setItem('mockSession',JSON.stringify({user:{id:'u1',email:'teacher@test.local'}}));
  localStorage.setItem('mockTeacherPdfs',JSON.stringify({'inf4-teacher':btoa('%PDF-1.4 mock')}));
  localStorage.setItem('mockdb',JSON.stringify({edu_profiles:[{user_id:'u1',role:'teacher'},{user_id:'u2',role:'student'}],edu_students:[{id:'inf-student',user_id:'u2',name:'Тестовый ученик'}],edu_lessons:[],edu_progress:[]}));
 });
 await p.goto(SITE+'t.html#ege-inf/inf4-teacher');
 await p.evaluate(()=>{window.open=()=>null;});
 const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#inf4-solutions').click()]);
 assert.equal(download.suggestedFilename(),'Условие Фано — разбор для учителя.pdf');
 await p.goto(SITE+'journal.html');
 await p.selectOption('#lTopic','inf4');
 assert.equal(await p.inputValue('#lQuiz'),'quiz-inf4b');
 assert.equal((await p.inputValue('#lHw')).match(/^Д[1-6]\./gm).length,6);
 await p.click('#lSend');
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('mockdb')).edu_lessons.some(x=>x.topic==='inf4'&&x.hw_sent_at));
 await p.evaluate(()=>localStorage.setItem('mockSession',JSON.stringify({user:{id:'u2',email:'kid@test.local'}})));
 await p.goto(SITE+'ege-inf.html');
 await p.getByRole('link',{name:'Начать урок №4 · Условие Фано'}).click();
 assert.equal(await p.locator('#inf4-practice .task').count(),3);
 assert.equal(await p.locator('#inf4-homework .task').count(),6);
 assert.equal(await p.locator('#inf4-solutions').count(),0);
 await p.setViewportSize({width:390,height:844});
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 await p.goto(SITE+'sinf4.html');
 assert.equal(await p.textContent('#cnt'),'1 / 10');await p.click('#next');
 assert.equal(await p.textContent('#cnt'),'2 / 10');
 await p.goto(SITE+'wsinf4.html');
 assert.equal(await p.locator('main .task').count(),3);
 await p.goto(SITE+'homework.html');
 await p.locator('a[href^="quiz-inf4b.html?hw="]').click();
 await p.waitForSelector('#fano-assigned:not([hidden])');
 for(let i=1;i<=6;i++){
   const box=p.locator('[data-q="'+i+'"]'), v=['0','10101','0010','a','ТЕСТ','42'][i-1];
   if(i===4)await box.locator('input[value="'+v+'"]').check();else await box.locator('input[type=text]').fill(v);
 }
 await p.click('#qzGo');
 await p.waitForFunction(()=>document.getElementById('fano-score').textContent.includes('первая попытка засчитана'));
 assert.match(await p.textContent('#fano-score'),/5 из 6/);
 assert.match(await p.locator('[data-q="1"] .fano-result').textContent(),/000/);
 await p.click('#qzAgain');
 assert(await p.locator('#qzGo').isEnabled());
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('mockdb')).edu_quiz_results.some(r=>r.lesson_id&&r.answers['1']==='код0'));
 assert.deepEqual(errors,[]);
 console.log('PASS INF4: teacher PDF, printable sheet, slides, homework assignment, first attempt, leading zero validation');
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
