(function(){
'use strict';
var K=window.KABINET, $=function(id){return document.getElementById(id);};
var id=new URLSearchParams(location.search).get('lesson'), sb, teacher=false, row=null, lesson=null, fragments=[], changed=false, busy=false, channel=null, allowedBoards=[];
var status=function(s){$('summaryStatus').textContent=s;};
function date(s){return (s||'').split('-').reverse().join('.');}
function node(t,text){var e=document.createElement(t);if(text!=null)e.textContent=text;return e;}
function validImage(s){return typeof s==='string' && s.length<=700000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s);}
function value(){return {title:$('sumTitle').value.trim(),covered:$('sumCovered').value,formulas:$('sumFormulas').value,homework:$('sumHomework').value,fragments:fragments};}
function render(content,day,homeworkSent){
  var box=$('summaryContent');box.replaceChildren();box.appendChild(node('h2',content.title));box.appendChild(node('p','Занятие '+date(day)));
  [['Что разобрали',content.covered],['Главные формулы и выводы',content.formulas],['Что сделать дома',content.homework]].forEach(function(x){if(x[1]){box.appendChild(node('h2',x[0]));box.appendChild(node('p',x[1]));}});
  (content.fragments||[]).forEach(function(f){if(!validImage(f.src))return;var fig=node('figure'),im=node('img');im.src=f.src;im.alt=f.caption||'Фрагмент доски с занятия';fig.appendChild(im);if(f.caption)fig.appendChild(node('figcaption',f.caption));box.appendChild(fig);});
  if(homeworkSent){var a=node('a','Открыть домашнее задание и прикреплённые файлы →');a.href='homework.html#hw-'+encodeURIComponent(id);box.appendChild(a);}
}
function fragmentList(){
  var box=$('sumFragments');box.replaceChildren();
  fragments.forEach(function(f,i){var card=node('div');card.className='summary-fragment';var im=node('img');im.src=f.src;im.alt='Фрагмент '+(i+1);card.appendChild(im);var label=node('label','Подпись к фрагменту'),input=node('input');input.value=f.caption;input.maxLength=300;input.addEventListener('input',function(){f.caption=input.value;changed=true;});label.appendChild(input);card.appendChild(label);var b=node('button','Убрать фрагмент');b.type='button';b.addEventListener('click',function(){fragments.splice(i,1);changed=true;fragmentList();});card.appendChild(b);box.appendChild(card);});
}
function showEditor(){ $('summaryEditor').hidden=false;$('summaryPreview').hidden=true; }
function preview(){var v=value();render(v,lesson.date,!!lesson.hw_sent_at);$('summaryEditor').hidden=true;$('summaryPreview').hidden=false;$('sumBack').hidden=false;status('Предпросмотр. Ученик увидит итог только после отправки.');}
async function save(action){
  if(busy)return;
  if(!$('summaryForm').reportValidity())return;
  var v=value();if(!v.title){status('Добавьте название урока.');return;}
  if(new Blob([JSON.stringify(v)]).size>2200000){status('Итог слишком большой. Уберите один фрагмент или выделите участок поменьше.');return;}
  var payload={lesson_id:id,draft:v,updated_at:new Date().toISOString()};
  if(action==='publish'){payload.published=v;payload.published_at=new Date().toISOString();}
  if(action==='unpublish'){payload.published=null;payload.published_at=null;}
  busy=true;document.querySelectorAll('.summary-actions button').forEach(function(b){b.disabled=true;});
  status('Сохраняю…');
  try {
    var q=row?sb.from('edu_lesson_summaries').update(payload).eq('lesson_id',id).eq('updated_at',row.updated_at):sb.from('edu_lesson_summaries').insert(payload);
    var r=await q.select('*').maybeSingle();if(r.error)throw r.error;if(!r.data){status('Итог изменён в другой вкладке. Ваш текст остался здесь; скопируйте его перед обновлением страницы.');return;}
    row=r.data;changed=false;$('sumUnpublish').hidden=!row.published;
    status(action==='publish'?'Итог отправлен. Ученик найдёт его в разделе «Домашка».':action==='unpublish'?'Доступ ученику закрыт. Черновик сохранён.':row.published?'Черновик сохранён. Ученик пока видит ранее отправленный итог.':'Черновик сохранён. Ученику пока не виден.');
  } catch(e){status('Не удалось сохранить итог. Текст и фрагменты остались на странице — не закрывайте её и попробуйте ещё раз.');}
  finally {busy=false;document.querySelectorAll('.summary-actions button').forEach(function(b){b.disabled=false;});}
}
$('summaryForm').addEventListener('input',function(){changed=true;});
$('summaryForm').addEventListener('submit',function(e){e.preventDefault();save('draft');});
$('sumPreview').onclick=preview;$('sumBack').onclick=showEditor;$('sumPublish').onclick=function(){save('publish');};$('sumUnpublish').onclick=function(){save('unpublish');};$('sumPrint').onclick=function(){window.print();};
addEventListener('beforeunload',function(e){if(changed||busy){e.preventDefault();e.returnValue='';}});
K.state.then(async function(st){
  if(!st)return;sb=K.sb;teacher=st.role==='teacher';if(!id){status('Откройте итог из записи занятия или раздела «Домашка».');return;}
  try {
    if(!teacher){
      var r=await sb.rpc('edu_lesson_summaries',{p_lesson:id});if(r.error)throw r.error;var item=r.data&&r.data[0];
      if(!item){status('Итог пока не отправлен или недоступен этому аккаунту.');return;}
      render(item.content,item.lesson_date,item.homework_sent);$('summaryPreview').hidden=false;status('Итог занятия от учителя');return;
    }
    $('back').href='journal.html';$('back').textContent='← Журнал';
    var lr=await sb.from('edu_lessons').select('id,student_id,date,topic,topic_text,homework,hw_sent_at').eq('id',id).maybeSingle();if(lr.error)throw lr.error;lesson=lr.data;if(!lesson){status('Занятие не найдено.');return;}
    var sr=await sb.from('edu_lesson_summaries').select('*').eq('lesson_id',id).maybeSingle();if(sr.error)throw sr.error;row=sr.data;
    var content=row?row.draft:{title:new URLSearchParams(location.search).get('title')||lesson.topic_text||'Итог урока',covered:new URLSearchParams(location.search).get('title')||lesson.topic_text||'',formulas:'',homework:lesson.homework||'',fragments:[]};
    $('sumTitle').value=content.title;$('sumCovered').value=content.covered;$('sumFormulas').value=content.formulas;$('sumHomework').value=content.homework;fragments=content.fragments||[];fragmentList();showEditor();
    $('sumUnpublish').hidden=!(row&&row.published);status('Занятие '+date(lesson.date)+(row&&row.published?' · итог отправлен; изменения будут черновиком':' · черновик, виден только вам'));
    var br=await sb.from('edu_boards').select('id,title,lesson_id,created_at').eq('student_id',lesson.student_id).order('created_at',{ascending:false});
    if(br.error){$('sumBoards').textContent='Не удалось загрузить список досок. Текст итога можно сохранить.';return;}
    allowedBoards=(br.data||[]).map(function(b){return b.id;});
    if(!allowedBoards.length){$('sumBoards').textContent='У ученика пока нет досок. Итог можно отправить без фрагментов.';return;}
    if(!window.BroadcastChannel){$('sumBoards').textContent='Выбор фрагментов не поддерживается этим браузером. Откройте итог в современном браузере.';return;}
    var token=crypto.randomUUID();channel=new BroadcastChannel('lesson-summary:'+token);
    channel.onmessage=function(e){var m=e.data;if(!m||m.lesson!==id||allowedBoards.indexOf(m.board)<0||!validImage(m.src))return;if(fragments.length>=3){status('Уже добавлены три фрагмента. Уберите один, чтобы добавить новый.');channel.postMessage({ack:m.request,ok:false});return;}fragments.push({src:m.src,caption:''});fragmentList();changed=true;status('Фрагмент добавлен в черновик. Проверьте его перед отправкой.');channel.postMessage({ack:m.request,ok:true});};
    (br.data||[]).forEach(function(b){var a=node('a',(b.lesson_id===id?'Доска этого занятия: ':'Доска: ')+b.title);a.href='board.html?b='+encodeURIComponent(b.id)+'&summary='+encodeURIComponent(id)+'&summary_token='+encodeURIComponent(token);a.target='_blank';a.rel='noopener';a.className='summary-link';$('sumBoards').appendChild(a);});
  } catch(e){status('Не удалось загрузить итог. Проверьте соединение и обновите страницу.');}
});
})();
