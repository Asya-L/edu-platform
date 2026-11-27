(function(){
  'use strict';
  var root = document.querySelector('[data-fano-quiz]');
  var id = root.dataset.fanoQuiz, homework = new URLSearchParams(location.search).get('hw');
  var form = root.querySelector('form'), boxes = Array.from(form.querySelectorAll('[data-q]'));
  var go = document.getElementById('qzGo'), again = document.getElementById('qzAgain'), score = document.getElementById('fano-score');
  var ready = false;
  go.disabled = true;
  window.KABINET.state.then(function(st){
    ready = Boolean(st && st.session && window.KABINET.sb);
    go.disabled = !ready;
    document.getElementById('fano-assigned').hidden = !homework;
  });
  form.addEventListener('submit', async function(ev){
    ev.preventDefault(); if (!ready || go.disabled) return;
    var answers = {};
    boxes.forEach(function(box){
      var input = box.querySelector('input[type=text], input:checked');
      var value = input ? input.value.trim() : '';
      // The shared grader also accepts numerically equivalent answers. Keep binary words textual.
      answers[box.dataset.q] = value && input.hasAttribute('data-bits') ? 'код' + value : value;
    });
    if (Object.values(answers).some(function(a){ return !a; })) { score.textContent = 'Ответь на все шесть вопросов.'; return; }
    go.disabled = true; score.textContent = 'Проверяю…';
    try {
      var args = {p_quiz:id, p_answers:answers};
      if (homework) args.p_lesson = homework;
      var r = await window.KABINET.sb.rpc('edu_check_quiz',args);
      if (r.error || !r.data || !Array.isArray(r.data.items)) throw Error('quiz response');
      r.data.items.forEach(function(item){
        var box = boxes.find(function(b){ return Number(b.dataset.q) === Number(item.q); });
        if (!box) return;
        var output = box.querySelector('.fano-result'), value = String(item.answer || '').replace(/^код(?=[01]+$)/,'');
        var option = Array.from(box.querySelectorAll('input[type=radio]')).find(function(i){ return i.value === value; });
        if (option) value = option.closest('label').textContent.trim();
        output.textContent = item.ok ? 'Верно' : 'Проверь себя: ' + value;
        output.hidden = false;
        box.querySelectorAll('input').forEach(function(i){ i.disabled = true; });
      });
      score.textContent = r.data.score + ' из ' + r.data.total + (r.data.homework ? (r.data.first ? ' · первая попытка засчитана в домашнюю работу' : ' · тренировочная попытка') : '');
      go.hidden = true; again.hidden = false;
    } catch(e) {
      score.textContent = 'Не получилось проверить ответы. Попробуй ещё раз.';
      go.disabled = false;
    }
  });
  again.addEventListener('click',function(){
    form.reset(); score.textContent = '';
    boxes.forEach(function(box){ box.querySelector('.fano-result').hidden = true; box.querySelectorAll('input').forEach(function(i){ i.disabled = false; }); });
    go.hidden = false; go.disabled = !ready; again.hidden = true;
  });
})();
