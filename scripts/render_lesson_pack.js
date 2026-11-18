// Render the generated pupil slides/worksheets; teacher PDFs are encrypted immediately.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),input=process.argv[2],keyPath=process.argv[3];
if(!input||!keyPath)throw Error('Usage: node scripts/render_lesson_pack.js PRIVATE_INPUT_DIR KEY_FILE');
const ids=['a18','ma26','g21','mg24'];
const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}const b=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8'}).end(b);}catch{res.writeHead(404).end();}});
function encrypt(data,key){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(data),cipher.final(),cipher.getAuthTag()]);}
(async()=>{
 const key=Buffer.from((await fs.readFile(keyPath,'utf8')).trim(),'base64');if(key.length!==32)throw Error('Invalid content key');
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.address().port+'/';const browser=await chromium.launch();const report=[];
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:720}});
  await ctx.route(/googleapis|gstatic/,r=>r.abort());
  await ctx.route('**/assets/auth.js?*',r=>r.fulfill({contentType:'application/javascript',body:'window.KABINET={state:Promise.resolve({role:"student",session:{user:{id:"render"}}})};document.documentElement.classList.remove("auth-wait");'}));
  await ctx.route('**/config.js?*',r=>r.fulfill({contentType:'application/javascript',body:'window.APP_CONFIG={};'}));
  const p=await ctx.newPage();await fs.mkdir(path.join(root,'files'),{recursive:true});await fs.mkdir(path.join(root,'t/files'),{recursive:true});
  for(const id of ids){
   const short=/^g\d+$/.test(id)?id.slice(1):id,sid='s'+short,ws='ws'+short;
   const folder=path.join(root,'assets/slides',id);await fs.mkdir(folder,{recursive:true});
   await p.goto(base+sid+'.html');await p.waitForFunction(()=>document.querySelector('.slide.on'));await p.evaluate(()=>document.fonts.ready);
   await p.addStyleTag({content:'#ui{display:none!important}'});
   for(let i=1;i<=10;i++){
    await p.evaluate(n=>{history.replaceState(null,'','#'+n);document.querySelectorAll('.slide').forEach((x,k)=>x.classList.toggle('on',k===n-1));},i);
    const metrics=await p.locator('.slide.on').evaluate(e=>{const b=e.querySelector('.slide-body'),area=e.querySelector('.in');return {bottom:b.getBoundingClientRect().bottom,limit:area.getBoundingClientRect().bottom-35,overflow:b.scrollWidth>b.clientWidth+2};});
    if(metrics.bottom>metrics.limit+2||metrics.overflow)report.push({id,slide:i,metrics});
    await p.locator('.slide.on').screenshot({path:path.join(folder,String(i).padStart(2,'0')+'.png')});
   }
   await p.emulateMedia({media:'print'});
   for(const teacher of [false,true]){
    const source=path.join(input,ws+(teacher?'-teacher':'-student')+'.print.html');await p.setContent(await fs.readFile(source,'utf8'));await p.evaluate(()=>document.fonts.ready);
    const pdf=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true});
    if(teacher){await fs.writeFile(path.join(input,ws+'-teacher.pdf'),pdf);await fs.writeFile(path.join(root,'t/files',ws+'-teacher.pdf.bin'),encrypt(pdf,key));}
    else await fs.writeFile(path.join(root,'files',ws+'-student.pdf'),pdf);
   }
   await p.emulateMedia({media:'screen'});console.log('Rendered 10 slides and worksheets:',id);
  }
  await fs.writeFile(path.join(input,'render-report.json'),JSON.stringify(report,null,2));if(report.length)throw Error('Slide overflow found; inspect private render-report.json');
 }finally{await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e.message);process.exitCode=1;server.close();});
