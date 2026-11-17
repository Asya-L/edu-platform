(function(){
var K=window.KABINET;
K.state.then(function(st){if(!st||st.role==='teacher')return;var host=document.getElementById('lessonSummaries');if(!host)return;
async function load(){try{var r=await K.sb.rpc('edu_lesson_summaries');if(r.error)throw r.error;host.replaceChildren();if(!(r.data||[]).length){host.hidden=true;return;}var h=document.createElement('h2');h.textContent='Итоги уроков';host.appendChild(h);r.data.forEach(function(x){var a=document.createElement('a');a.href='summary.html?lesson='+encodeURIComponent(x.lesson_id);a.textContent=x.lesson_date.split('-').reverse().join('.')+' · '+x.content.title;host.appendChild(a);});host.hidden=false;}catch(e){host.hidden=false;host.textContent='Не удалось загрузить итоги уроков. Обновите страницу, чтобы повторить.';}}
load();addEventListener('focus',load);
});
})();
