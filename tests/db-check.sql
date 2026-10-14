-- Кабинет математики — проверка правил доступа в базе (тест-кейсы DB-01…DB-08).
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
  st_id uuid; ot_id uuid; l_mine uuid; l_other uuid;
  n int; n2 int; n3 int; b boolean; v text; err text;
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
  insert into public.edu_lessons(student_id, topic, homework, notes, mark)
    values (st_id, 'g1', 'ТЕСТ: моё ДЗ', 'ТЕСТ: заметка учителя', '5') returning id into l_mine;
  insert into public.edu_lessons(student_id, topic, homework)
    values (st_id, 'g2', '') ;                                   -- занятие без ДЗ — не должно попасть в список
  insert into public.edu_lessons(student_id, homework, notes)
    values (ot_id, 'ТЕСТ: чужое ДЗ', 'ТЕСТ: чужая заметка') returning id into l_other;
  insert into public.edu_progress(student_id) values (st_id), (ot_id);

  -- DB-01: учитель читает ключ
  perform set_config('request.jwt.claims', json_build_object('sub', t_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(t_uid::text, ''), true);
  execute 'set local role authenticated';
  select count(*) into n from public.edu_secrets where name = 'content_key';
  execute 'reset role';
  r := r || case when n = 1 then 'PASS' else 'FAIL' end || ' DB-01 учитель видит ключ: строк ' || n || E'\n';

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

  -- DB-06: «сделал» — своему занятию можно, чужому нельзя
  perform public.edu_set_done(l_other, true);
  perform public.edu_set_done(l_mine, true);
  execute 'reset role';
  select student_done into b from public.edu_lessons where id = l_other;
  select student_done into v from public.edu_lessons where id = l_mine;
  r := r || case when not b and v = 'true' then 'PASS' else 'FAIL' end
         || ' DB-06 отметка «сделал»: чужое изменилось? ' || b || ', своё отмечено? ' || v || E'\n';

  -- DB-08: гость (без входа) вызывает функции ДЗ и читает таблицы
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  err := '';
  begin perform * from public.edu_my_homework(); err := err || 'ДЗ доступно; ';
  exception when insufficient_privilege then null; end;
  begin perform public.edu_set_done(l_mine, false); err := err || 'отметка доступна; ';
  exception when insufficient_privilege then null; end;
  select (select count(*) from public.edu_secrets) + (select count(*) from public.edu_students)
       + (select count(*) from public.edu_lessons) + (select count(*) from public.edu_profiles) into n;
  execute 'reset role';
  r := r || case when err = '' and n = 0 then 'PASS' else 'FAIL' end
         || ' DB-08 гость: ' || case when err = '' then 'функции закрыты' else err end || ', видит строк ' || n || E'\n';

  raise exception '%', r;
end $$;
