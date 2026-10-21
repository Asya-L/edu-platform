-- Кабинет математики — проверка правил доступа в базе (тест-кейсы DB-01…DB-27).
-- Как запустить: Supabase → SQL Editor → New query → вставить целиком → Run.
--
-- Скрипт ничего не меняет: он создаёт двух временных тестовых учеников, проверяет,
-- что они видят, и в конце ОТМЕНЯЕТ все изменения. Поэтому результат приходит
-- красным сообщением «ERROR: ИТОГ ПРОВЕРКИ…» — так и задумано: это и есть отчёт,
-- а «ошибка» нужна, чтобы база откатила тестовые данные.
-- В отчёте каждая строка — PASS (всё правильно) или FAIL (есть дыра).

do $$
declare
  t_uid uuid;
  s_uid uuid := gen_random_uuid();   -- тестовый ученик
  o_uid uuid := gen_random_uuid();   -- другой тестовый ученик
  st_id uuid; ot_id uuid; l_mine uuid; l_other uuid; l_draft uuid;
  n int; n2 int; n3 int; b boolean; v text; err text; j jsonb; obj_other text; b_mine uuid; b_other uuid; nb uuid; nk int;
  r text := E'ИТОГ ПРОВЕРКИ (все изменения отменены)\n';

  -- строки отчёта собираются в r
begin
  select user_id into t_uid from public.edu_profiles where lower(email) = 'alutovinovaa@gmail.com';

  -- DB-07: новый пользователь получает роль «ученик», почта учителя — «учитель»
  insert into auth.users(id, instance_id, aud, role, email, created_at, updated_at) values
    (s_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'edu-test-' || left(s_uid::text, 8) || '@example.invalid', now(), now()),
    (o_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'edu-test-' || left(o_uid::text, 8) || '@example.invalid', now(), now());
  select role into v from public.edu_profiles where user_id = s_uid;
  r := r || case when v = 'student' and t_uid is not null
                      and (select role from public.edu_profiles where user_id = t_uid) = 'teacher'
                 then 'PASS' else 'FAIL' end
         || ' DB-07 роли: новый пользователь → ' || coalesce(v, 'нет профиля')
         || ', alutovinovaa@gmail.com → ' || coalesce((select role from public.edu_profiles where user_id = t_uid), 'нет профиля') || E'\n';

  -- тестовые данные журнала (от имени владельца базы)
  insert into public.edu_students(user_id, name) values (s_uid, 'ТЕСТ ученик') returning id into st_id;
  insert into public.edu_students(user_id, name) values (o_uid, 'ТЕСТ другой') returning id into ot_id;
  insert into public.edu_lessons(student_id, topic, homework, notes, mark, hw_sent_at)
    values (st_id, 'g1', 'ТЕСТ: моё ДЗ', 'ТЕСТ: заметка учителя', '5', now()) returning id into l_mine;
  insert into public.edu_lessons(student_id, date, topic, homework, quiz)
    values (st_id, current_date + 3, 'g3', 'ТЕСТ: черновик ДЗ', 'quiz-geo1') returning id into l_draft;   -- записано заранее, ученику не отправлено
  insert into public.edu_lessons(student_id, topic, homework)
    values (st_id, 'g2', '') ;                                   -- занятие без ДЗ — не должно попасть в список
  insert into public.edu_lessons(student_id, homework, notes, hw_sent_at)
    values (ot_id, 'ТЕСТ: чужое ДЗ', 'ТЕСТ: чужая заметка', now()) returning id into l_other;
  insert into public.edu_progress(student_id) values (st_id), (ot_id);
  update public.edu_students set next_at = now() + interval '2 days', call_url = 'https://example.invalid/call' where id = st_id;
  obj_other := o_uid::text || '/' || l_other::text || '/z.jpg';
  insert into storage.objects(bucket_id, name) values ('edu-hw', obj_other);
  update public.edu_lessons set quiz = 'quiz-geo1' where id in (l_mine, l_other);
  insert into public.edu_boards(student_id, title) values (st_id, 'ТЕСТ моя доска') returning id into b_mine;
  insert into public.edu_boards(student_id, title) values (ot_id, 'ТЕСТ чужая доска') returning id into b_other;
  insert into public.edu_bank(id, num, answer, solution) values ('test-bank', 5, '-2.5', 'ТЕСТ решение') on conflict (id) do update set answer = '-2.5', num = 5;
  insert into public.edu_bank_attempts(student_id, task, num, answer, ok) values (ot_id, 'test-bank', 5, '1', false);
  insert into public.edu_ws_answers(student_id, ws, answers, submitted_at) values (ot_id, 'ws9', '{"0":"ЧУЖОЕ"}', now());

  -- DB-01: учитель читает ключ
  perform set_config('request.jwt.claims', json_build_object('sub', t_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(t_uid::text, ''), true);
  execute 'set local role authenticated';
  select count(*) into n from public.edu_secrets where name = 'content_key';
  select count(*) + n into n from public.edu_board_get(b_other);
  execute 'reset role';
  r := r || case when n = 2 then 'PASS' else 'FAIL' end || ' DB-01 учитель видит ключ и любую доску: строк ' || n || E'\n';

  -- дальше — от имени тестового ученика
  perform set_config('request.jwt.claims', json_build_object('sub', s_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', s_uid::text, true);
  execute 'set local role authenticated';

  -- DB-02: ученик читает ключ
  select count(*) into n from public.edu_secrets;
  r := r || case when n = 0 then 'PASS' else 'FAIL' end || ' DB-02 ученик видит ключ: строк ' || n || E'\n';

  -- DB-03: ученик читает журнал напрямую и пытается писать в него
  select count(*) into n from public.edu_students;
  select count(*) into n2 from public.edu_lessons;
  select count(*) into n3 from public.edu_progress;
  err := 'запись прошла';
  begin
    insert into public.edu_lessons(student_id, homework) values (st_id, 'взлом');
  exception when others then err := 'запись запрещена';
  end;
  r := r || case when n + n2 + n3 = 0 and err = 'запись запрещена' then 'PASS' else 'FAIL' end
         || ' DB-03 ученик и журнал: ученики ' || n || ', занятия ' || n2 || ', прогресс ' || n3 || ', ' || err || E'\n';

  -- DB-04: ученик делает себя учителем
  update public.edu_profiles set role = 'teacher' where user_id = s_uid;
  get diagnostics n = row_count;
  select count(*) into n2 from public.edu_profiles;          -- должен видеть только свой профиль
  err := 'вставка прошла';
  begin
    insert into public.edu_profiles(user_id, email, role) values (gen_random_uuid(), 'x@example.invalid', 'teacher');
  exception when others then err := 'вставка запрещена';
  end;
  b := public.edu_is_teacher();
  r := r || case when n = 0 and n2 = 1 and not b and err = 'вставка запрещена' then 'PASS' else 'FAIL' end
         || ' DB-04 ученик → учитель: изменено строк ' || n || ', видит профилей ' || n2 || ', учитель? ' || b || ', ' || err || E'\n';

  -- DB-05: своё ДЗ через edu_my_homework — только своё, только с заданием, без заметок
  select count(*), coalesce(bool_or(h.homework like '%чужое%'), false) into n, b from public.edu_my_homework() h;
  r := r || case when n = 1 and not b then 'PASS' else 'FAIL' end
         || ' DB-05 моё ДЗ: заданий ' || n || ' (ждём 1), чужое попало? ' || b || E'\n';

  -- DB-26: домашка, записанная заранее и не отправленная, ученику не видна: ни в списке, ни для сдачи, ни для теста, ни для фото
  err := '';
  if exists(select 1 from public.edu_my_homework() h where h.id = l_draft) then err := err || 'черновик виден; '; end if;
  if public.edu_submit(l_draft, 'x', '[]'::jsonb) then err := err || 'черновик сдан; '; end if;
  perform public.edu_set_done(l_draft, true);
  j := public.edu_check_quiz('quiz-geo1', '{}'::jsonb, l_draft);
  if (j->>'homework')::boolean then err := err || 'тест засчитан в черновик; '; end if;
  begin insert into storage.objects(bucket_id, name) values ('edu-hw', s_uid::text || '/' || l_draft::text || '/d.jpg'); err := err || 'фото к черновику загрузилось; ';
  exception when others then null; end;
  r := r || case when err = '' then 'PASS' else 'FAIL' end || ' DB-26 неотправленная домашка: ' || case when err = '' then 'ученику не видна и не сдаётся' else err end || E'\n';

  -- DB-06: «сделал» — своему занятию можно, чужому нельзя
  perform public.edu_set_done(l_other, true);
  perform public.edu_set_done(l_mine, true);

  -- DB-09: сдача ДЗ — своё можно, чужое нельзя, чужие фото подставить нельзя
  b := public.edu_submit(l_mine, 'ТЕСТ: мой комментарий', jsonb_build_array(s_uid::text || '/' || l_mine::text || '/a.jpg'));
  v := public.edu_submit(l_other, 'взлом', '[]'::jsonb)::text;
  err := 'чужие фото приняты';
  begin perform public.edu_submit(l_mine, 'x', jsonb_build_array(obj_other));
  exception when others then err := 'чужие фото отклонены'; end;
  select count(*) into n from public.edu_my_homework() h where h.id = l_mine and jsonb_array_length(h.photos) = 1 and h.student_comment like 'ТЕСТ%';
  r := r || case when b and v = 'false' and err = 'чужие фото отклонены' and n = 1 then 'PASS' else 'FAIL' end
         || ' DB-09 сдача ДЗ: своё ' || b || ', чужое ' || v || ', ' || err || ', видна в «Домашке» ' || n || E'\n';

  -- DB-10: хранилище фото — только в свою папку и к своему занятию, видно только своё
  err := '';
  begin insert into storage.objects(bucket_id, name) values ('edu-hw', s_uid::text || '/' || l_mine::text || '/a.jpg');
  exception when others then err := err || 'своё не загрузилось; '; end;
  begin insert into storage.objects(bucket_id, name) values ('edu-hw', o_uid::text || '/' || l_other::text || '/b.jpg'); err := err || 'в чужую папку загрузилось; ';
  exception when others then null; end;
  begin insert into storage.objects(bucket_id, name) values ('edu-hw', s_uid::text || '/' || l_other::text || '/c.jpg'); err := err || 'к чужому занятию загрузилось; ';
  exception when others then null; end;
  select count(*) into n from storage.objects where bucket_id = 'edu-hw';
  begin delete from storage.objects where name = obj_other; exception when others then null; end;
  r := r || case when err = '' and n = 1 then 'PASS' else 'FAIL' end
         || ' DB-10 фото: ' || case when err = '' then 'загрузка только своего' else err end || ', видит файлов ' || n || E'\n';

  -- DB-11: ключи и результаты самопроверки ученику закрыты
  select count(*) into n from public.edu_quiz_keys;
  select count(*) into n2 from public.edu_quiz_results;
  err := 'запись прошла';
  begin insert into public.edu_quiz_results(student_id, quiz, score, total) values (st_id, 'quiz-geo1', 10, 10);
  exception when others then err := 'запись запрещена'; end;
  r := r || case when n = 0 and n2 = 0 and err = 'запись запрещена' then 'PASS' else 'FAIL' end
         || ' DB-11 самопроверка: видит ключей ' || n || ', результатов ' || n2 || ', ' || err || E'\n';

  -- DB-12: проверка на сервере сохраняет попытку ученика
  j := public.edu_check_quiz('quiz-geo1', '{}'::jsonb);
  select count(*) into n from public.edu_my_quiz_results();
  r := r || case when (j->>'saved')::boolean and (j->>'total')::int > 0 and (j->>'score')::int = 0 and n = 2 then 'PASS' else 'FAIL' end
         || ' DB-12 проверка теста: ' || (j->>'score') || ' из ' || (j->>'total') || ', сохранено ' || (j->>'saved') || ', попыток видно ' || n || E'\n';

  -- DB-19: тест как ДЗ — своё задание засчитывается (первая попытка), чужое нельзя
  j := public.edu_check_quiz('quiz-geo1', '{}'::jsonb, l_mine);
  b := (j->>'homework')::boolean and (j->>'first')::boolean;
  j := public.edu_check_quiz('quiz-geo1', '{}'::jsonb, l_mine);
  b := b and (j->>'homework')::boolean and not (j->>'first')::boolean;
  j := public.edu_check_quiz('quiz-geo1', '{}'::jsonb, l_other);
  v := (j->>'homework');
  select count(*) into n from public.edu_my_homework() h where h.id = l_mine and h.quiz = 'quiz-geo1' and h.quiz_tries = 2 and h.quiz_first like '0/%';
  r := r || case when b and v = 'false' and n = 1 then 'PASS' else 'FAIL' end
         || ' DB-19 тест как ДЗ: своё засчитано ' || b || ', чужое ' || v || ', в «Домашке» попыток 2 — ' || n || E'\n';

  -- DB-20: банк ЕГЭ — ключи и чужие попытки ученику закрыты, решение только после своей попытки
  select count(*) into n from public.edu_bank;
  select count(*) into n2 from public.edu_bank_attempts;
  err := '';
  begin perform public.edu_bank_solution('test-bank'); err := err || 'решение до попытки; ';
  exception when others then null; end;
  begin insert into public.edu_bank_attempts(student_id, task, num, ok) values (st_id, 'test-bank', 5, true); err := err || 'запись попытки напрямую; ';
  exception when insufficient_privilege then null; end;
  r := r || case when n = 0 and n2 = 0 and err = '' then 'PASS' else 'FAIL' end
         || ' DB-20 банк закрыт: ключей видно ' || n || ', попыток видно ' || n2 || ', ' || case when err = '' then 'решение закрыто' else err end || E'
';

  -- DB-21: проверка ответа банка на сервере (запятая и знак «−»), решение после попытки, статистика своя
  j := public.edu_bank_check('test-bank', '2,5'); b := not (j->>'ok')::boolean and (j->>'saved')::boolean and (j->>'tries')::int = 1;
  v := public.edu_bank_solution('test-bank') ->> 'answer';
  j := public.edu_bank_check('test-bank', '−2,5'); b := b and (j->>'ok')::boolean and (j->>'tries')::int = 2;
  j := public.edu_bank_check('test-bank', ' -2.50 '); b := b and (j->>'ok')::boolean;
  select count(*) into n from public.edu_bank_my_stats() m where m.task = 'test-bank' and m.tries = 3 and m.solved and not m.first_ok and m.revealed;
  select count(*) into n2 from public.edu_bank_my_stats();
  r := r || case when b and v = '-2.5' and n = 1 and n2 = 1 then 'PASS' else 'FAIL' end
         || ' DB-21 проверка банка: ответы засчитаны ' || b || ', решение ' || coalesce(v, '—') || ', статистика ' || n || '/' || n2 || E'
';

  -- DB-13: ученик видит только свою карточку: занятие, ссылку, прогресс
  select count(*), max(i.name), bool_and(i.next_at > now()) into n, v, b from public.edu_my_info() i;
  r := r || case when n = 1 and v = 'ТЕСТ ученик' and b then 'PASS' else 'FAIL' end
         || ' DB-13 следующее занятие: строк ' || n || ', карточка «' || coalesce(v, '—') || '»' || E'\n';

  -- DB-15: доски — ученик видит и открывает только свои
  select count(*) into n from public.edu_my_boards();
  select count(*) into n2 from public.edu_board_get(b_mine);
  select count(*) into n3 from public.edu_board_get(b_other);
  select count(*) + n3 into n3 from public.edu_boards;
  r := r || case when n = 1 and n2 = 1 and n3 = 0 then 'PASS' else 'FAIL' end
         || ' DB-15 доски: в списке ' || n || ', своя открывается ' || n2 || ', чужая/таблица напрямую ' || n3 || E'\n';

  -- DB-16: сохранение — своё да, чужое нет; черновик создаётся только себе
  b := public.edu_board_save(b_mine, '{"els":[{"id":"x","t":"pen"}]}'::jsonb);
  v := public.edu_board_save(b_other, '{"els":[]}'::jsonb)::text;
  nb := public.edu_board_new('ТЕСТ черновик');
  select count(*) into n from public.edu_my_boards();
  r := r || case when b and v = 'false' and nb is not null and n = 2 then 'PASS' else 'FAIL' end
         || ' DB-16 сохранение доски: своя ' || b || ', чужая ' || v || ', черновик → досок ' || n || E'\n';

  -- DB-17: картинки доски — только в папку своей доски
  err := '';
  begin insert into storage.objects(bucket_id, name) values ('edu-board', b_mine::text || '/p.jpg');
  exception when others then err := err || 'своё не загрузилось; '; end;
  begin insert into storage.objects(bucket_id, name) values ('edu-board', b_other::text || '/p.jpg'); err := err || 'в чужую доску загрузилось; ';
  exception when others then null; end;
  select count(*) into n from storage.objects where bucket_id = 'edu-board';
  r := r || case when err = '' and n = 1 then 'PASS' else 'FAIL' end
         || ' DB-17 картинки доски: ' || case when err = '' then 'только своя доска' else err end || ', видит ' || n || E'\n';

  -- DB-23: рабочий лист — ученик сохраняет и сдаёт свой лист, таблицу напрямую не видит, чужой лист не читает
  j := public.edu_ws_save('wsa3', '{"0":"ТЕСТ"}'::jsonb, false);
  b := (j->>'submitted_at') is null;
  j := public.edu_ws_save('wsa3', '{"0":"ТЕСТ","1":"В"}'::jsonb, true);
  select count(*) into n from public.edu_ws_answers;
  v := public.edu_ws_mine('wsa3')->'answers'->>'1';
  err := '';
  if public.edu_ws_mine('ws9') is not null then err := err || 'чужой лист виден; '; end if;
  begin perform public.edu_ws_save('../x', '{}'::jsonb); err := err || 'плохое имя листа принято; '; exception when others then null; end;
  begin perform public.edu_ws_save('ws1', '[1]'::jsonb); err := err || 'не объект принят; '; exception when others then null; end;
  begin update public.edu_ws_answers set answers = '{}' where ws = 'ws9'; exception when others then null; end;
  r := r || case when b and (j->>'submitted_at') is not null and n = 0 and v = 'В' and err = '' then 'PASS' else 'FAIL' end
         || ' DB-23 рабочий лист: черновик без сдачи ' || b || ', сдан ' || ((j->>'submitted_at') is not null) || ', строк таблицы видно ' || n || ', ответ ' || coalesce(v, '—') || case when err = '' then '' else ', ' || err end || E'\n';

  -- DB-25: лист к лекции ЕГЭ (wse…) сохраняется так же
  err := '';
  begin j := public.edu_ws_save('wse4', '{"0":"ТЕСТ"}'::jsonb, true); exception when others then err := 'лист wse4 не сохранился: ' || sqlerrm; end;
  r := r || case when err = '' and public.edu_ws_mine('wse4') is not null then 'PASS' else 'FAIL' end || ' DB-25 лист к лекции ЕГЭ: ' || case when err = '' then 'сохранён и сдан' else err end || E'\n';

  -- DB-27: посещения — ученик отмечается, но саму таблицу не видит; чужие имена страниц отбрасываются
  perform public.edu_ping('el7', true); perform public.edu_ping('el7', true); perform public.edu_ping('../x', false); perform public.edu_ping(null, true);
  select count(*) into n from public.edu_visits;
  r := r || case when n = 0 then '' else E'FAIL DB-27a ученик видит таблицу посещений\n' end;

  -- DB-18: живой канал доски — правило пускает только в свою доску
  b := public.edu_can_board(b_mine::text); v := public.edu_can_board(b_other::text)::text;
  execute 'reset role';
  select count(*) into n from pg_policies where schemaname = 'realtime' and policyname like 'edu-board:%';
  r := r || case when b and v = 'false' and (n = 2 or to_regclass('realtime.messages') is null) then 'PASS' else 'FAIL' end
         || ' DB-18 канал доски: своя ' || b || ', чужая ' || v || ', правил на канале ' || n || E'\n';
  select count(*) into n from public.edu_boards where id = b_other and data = '{"els":[]}'::jsonb and title = 'ТЕСТ чужая доска';
  r := r || case when n = 1 then '' else E'FAIL DB-16b чужая доска изменена\n' end;
  select student_done into b from public.edu_lessons where id = l_other;
  select student_done into v from public.edu_lessons where id = l_mine;
  r := r || case when not b and v = 'true' then 'PASS' else 'FAIL' end
         || ' DB-06 отметка «сделал»: чужое изменилось? ' || b || ', своё отмечено? ' || v || E'\n';

  -- DB-14: от имени учителя видны сдача, фото и попытка ученика; чужое фото цело
  select count(*) into n from storage.objects where name = obj_other;
  select count(*) into n2 from public.edu_quiz_results where student_id = st_id;
  select count(*) into n3 from public.edu_lessons where id = l_other and submitted_at is null and student_comment is null;
  select count(*) into nk from public.edu_bank_attempts where student_id = st_id;
  r := r || case when nk = 4 then 'PASS' else 'FAIL' end || ' DB-22 попытки банка у ученика записаны: ' || nk || ' (3 ответа + просмотр решения)' || E'\n';
  r := r || case when n = 1 and n2 = 5 and n3 = 1 then 'PASS' else 'FAIL' end
         || ' DB-14 целостность: чужое фото на месте ' || n || ', попытка у своего ученика ' || n2 || ', чужое ДЗ не тронуто ' || n3 || E'\n';

  -- DB-24: учитель видит листы учеников; чужой лист не изменён учеником
  perform set_config('request.jwt.claims', json_build_object('sub', t_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(t_uid::text, ''), true);
  execute 'set local role authenticated';
  select count(*) into n from public.edu_ws_answers where student_id in (st_id, ot_id);
  select count(*) into n2 from public.edu_ws_answers where student_id = ot_id and answers->>'0' = 'ЧУЖОЕ';
  execute 'reset role';
  r := r || case when n = 3 and n2 = 1 then 'PASS' else 'FAIL' end || ' DB-24 учитель видит рабочие листы: ' || n || ', чужой лист цел ' || n2 || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', t_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(t_uid::text, ''), true);
  execute 'set local role authenticated';
  select count(*), max((pages ->> 'el7')::int), max(active_min), max(jsonb_typeof(pages -> '../x')) into n, n2, n3, v from public.edu_visits where student_id = st_id;
  execute 'reset role';
  r := r || case when n = 1 and n2 = 2 and n3 = 1 and v is null then 'PASS' else 'FAIL' end
         || ' DB-27 посещения: строк ' || n || ', открыта лекция 7 раз ' || coalesce(n2::text, '—') || ', активных минут ' || coalesce(n3::text, '—') || E'\n';

  -- DB-08: гость (без входа) вызывает функции ДЗ и читает таблицы
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  err := '';
  begin perform * from public.edu_my_homework(); err := err || 'ДЗ доступно; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_set_done(l_mine, false); err := err || 'отметка доступна; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_submit(l_mine, 'x', '[]'::jsonb); err := err || 'сдача доступна; ';
  exception when insufficient_privilege then null; end;
  begin perform * from public.edu_my_info(); err := err || 'карточка доступна; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_ws_save('ws1', '{}'::jsonb); err := err || 'сохранение листа доступно; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_ping('index', true); err := err || 'отметка посещения доступна; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_check_quiz('quiz-geo1', '{}'::jsonb); err := err || 'проверка теста доступна; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_bank_check('test-bank', '1'); err := err || 'проверка банка доступна; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_bank_solution('test-bank'); err := err || 'решение банка доступно; ';
  exception when insufficient_privilege then null; end;
  begin perform * from public.edu_bank_my_stats(); err := err || 'статистика банка доступна; ';
  exception when insufficient_privilege then null; end;
  begin perform * from public.edu_board_get(b_mine); err := err || 'доска доступна; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_board_save(b_mine, '{"els":[]}'::jsonb); err := err || 'сохранение доски доступно; ';
  exception when insufficient_privilege then null; end;
  select (select count(*) from public.edu_secrets) + (select count(*) from public.edu_students)
       + (select count(*) from public.edu_lessons) + (select count(*) from public.edu_profiles)
       + (select count(*) from public.edu_quiz_keys) + (select count(*) from public.edu_quiz_results)
       + (select count(*) from storage.objects where bucket_id in ('edu-hw', 'edu-board')) + (select count(*) from public.edu_boards)
       + (select count(*) from public.edu_bank) + (select count(*) from public.edu_bank_attempts) + (select count(*) from public.edu_visits) into n;
  execute 'reset role';
  r := r || case when err = '' and n = 0 then 'PASS' else 'FAIL' end
         || ' DB-08 гость: ' || case when err = '' then 'функции закрыты' else err end || ', видит строк ' || n || E'\n';

  raise exception '%', r;
end $$;
