// Attach the four checked lessons to catalogs and teacher routing, preserving existing content.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),input=process.argv[2],keyPath=process.argv[3];
if(!input||!keyPath)throw Error('Usage: node scripts/connect_lesson_pack.js PRIVATE_INPUT_DIR KEY_FILE');
const key=Buffer.from(fs.readFileSync(keyPath,'utf8').trim(),'base64');if(key.length!==32)throw Error('Invalid content key');
const ids=['a18','ma26','g21','mg24'];
const read=p=>fs.readFileSync(path.join(root,p),'utf8'),write=(p,s)=>fs.writeFileSync(path.join(root,p),s);
const packs=ids.map(id=>JSON.parse(fs.readFileSync(path.join(input,id+'.json'),'utf8')));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=s=>s.replace(/<span class="fr"><span>([\s\S]*?)<\/span><span>([\s\S]*?)<\/span><\/span>/g,'(($1)/($2))').replace(/<sup>([\s\S]*?)<\/sup>/g,'^($1)').replace(/<sub>([\s\S]*?)<\/sub>/g,'_($1)').replace(/<[^>]+>/g,' ').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function range(source,name){const m=new RegExp('\\b'+name+'\\s*=\\s*').exec(source);if(!m)throw Error('Missing '+name);let depth=0,quoted=false,escape=false,start=m.index+m[0].length;for(let i=start;i<source.length;i++){let c=source[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='['||c==='{')depth++;if(c===']'||c==='}')depth--;if(depth===0)return {start,end:i+1,value:JSON.parse(source.slice(start,i+1))};}throw Error('Unclosed '+name);}
function replace(source,name,value){const r=range(source,name);return source.slice(0,r.start)+JSON.stringify(value,null,2)+source.slice(r.end);}
function encrypt(b){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(b),c.final(),c.getAuthTag()]);}
function decrypt(b){const c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]);}
const short=id=>/^g\d+$/.test(id)?id.slice(1):id;
function row(d){let s=short(d.id);return '<section class="new-lesson-pack" data-lesson-pack="'+d.id+'"><h2>'+esc(d.kicker)+'</h2><div class="lessons"><div class="lesson-row"><div class="lesson-no">'+(d.id==='mg24'?'Доп.':d.id.match(/\d+/)[0])+'</div><div><h3><a href="'+d.id+'.html">'+esc(d.title)+'</a></h3><p>'+d.goals.map(esc).join(' · ')+'</p></div><div style="display:flex;gap:6px;flex-wrap:wrap"><a class="pill" href="'+d.id+'.html">конспект</a><a class="pill" href="s'+s+'.html">слайды</a><a class="pill" href="ws'+s+'.html">лист</a><a class="pill" href="quiz-'+d.id+'a.html">тест</a></div></div></div></section>';}
function addRow(html,d){if(html.includes('data-lesson-pack="'+d.id+'"'))return html;const i=html.lastIndexOf('</main>');if(i<0)throw Error('Missing index main: '+d.indexPage);return html.slice(0,i)+row(d)+html.slice(i);}
function next(html,d){if(html.includes('href="'+d.id+'.html"'))return html;const i=html.lastIndexOf('<div class="pager">'),end=html.indexOf('</div>',i);if(i<0||end<0)throw Error('Missing previous lesson pager');return html.slice(0,end)+'<a href="'+d.id+'.html">'+esc(d.title)+' →</a>'+html.slice(end);}
let auth=read('assets/auth.js'),tp=range(auth,'TEACHER_PAGES').value;
for(const d of packs)for(const id of [d.id,'ws'+short(d.id)])if(!tp.includes(id))tp.push(id);
auth=replace(auth,'TEACHER_PAGES',tp).replace("var group = {g1:","var group = {g21:'geometry',ws21:'geometry',g1:");write('assets/auth.js',auth);
const av=crypto.createHash('sha256').update(auth).digest('hex').slice(0,12);
let loader=read('t.html'),tf=range(loader,'TF').value;
for(const d of packs){const f='files/ws'+short(d.id)+'-teacher.pdf';if(!tf.includes(f))tf.push(f);}
loader=replace(loader,'TF',tf);const ver='lp-'+crypto.createHash('sha256').update(JSON.stringify(packs)).digest('hex').slice(0,12);
loader=loader.replace(/VER = '[^']+'/,'VER = \''+ver+'\'').replace(/assets\/auth.js\?v=[^"']+/g,'assets/auth.js?v='+av);write('t.html',loader);
let source=read('assets/catalogs.js'),data=range(source,'data').value;
for(const d of packs){
 const s=short(d.id),oldPrefix=d.id.startsWith('ma')?'ma':d.id.startsWith('mg')?'mg':d.id[0];
 const group=data.groups.find(g=>g[1].some(t=>t[0]===d.previousId));if(!group)throw Error('Unknown group '+d.id);
 if(!group[1].some(t=>t[0]===d.id))group[1].push([d.id,d.kicker.replace(d.subject+' · ','')+' · '+d.title]);
 data.quizzes['quiz-'+d.id+'a']=d.title+' · тест в классе';data.quizzes['quiz-'+d.id+'b']=d.title+' · тест домой';
 data.worksheets['ws'+s]=d.subject+' · '+d.title+' · рабочий лист';
 const hw=d.homework.map((t,i)=>'Д'+(i+1)+'. '+plain(t.promptHtml)).join('\n\n');
 data.homeworkHints[d.id]={src:d.book+' · '+d.kicker,text:hw,full:hw,ws:'рабочий лист '+d.title,quiz:'quiz-'+d.id+'b'};
 let book=addRow(read(d.indexPage),d).replace(/assets\/auth.js\?v=[^"']+/g,'assets/auth.js?v='+av);write(d.indexPage,book);
 const oldName=d.indexPage.slice(0,-5),old=JSON.parse(decrypt(fs.readFileSync(path.join(input,'old-t-'+oldName+'.bin'))).toString('utf8'));old.html=addRow(old.html,d);fs.mkdirSync(path.join(root,'t'),{recursive:true});fs.writeFileSync(path.join(root,'t',oldName+'.bin'),encrypt(Buffer.from(JSON.stringify(old))));
 write(d.previousId+'.html',next(read(d.previousId+'.html'),d));
 const previous=JSON.parse(decrypt(fs.readFileSync(path.join(input,'old-t-'+d.previousId+'.bin'))).toString('utf8'));previous.html=next(previous.html,d);fs.writeFileSync(path.join(root,'t',d.previousId+'.bin'),encrypt(Buffer.from(JSON.stringify(previous))));
}
write('assets/catalogs.js',replace(source,'data',data));
let board=read('board.html'),decks=range(board,'SLIDES').value;
const groups={'algebra.html':'Алгебра · Алимов','algebra-m.html':'Алгебра · Мерзляк','geometry.html':'Геометрия · Атанасян','geometry-m.html':'Геометрия · Мерзляк'};
for(const d of packs)if(!decks.some(s=>s.id===d.id))decks.push({id:d.id,g:groups[d.indexPage],t:d.title,n:10});write('board.html',replace(board,'SLIDES',decks));
console.log('Connected four lesson packs to pupil/teacher indexes, routing, catalogs and board slides');
