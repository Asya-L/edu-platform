-- Real RPC and RLS regression; synthetic fixtures always roll back.
do $test$
declare
  pupil uuid := gen_random_uuid(); teacher uuid := gen_random_uuid(); sid uuid;
  d date := (now() at time zone 'Europe/Kaliningrad')::date; n int;
begin
  begin
    insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'visits-regression-'||u::text||'@example.invalid',now(),now() from unnest(array[pupil,teacher]) u;
    update public.edu_profiles set role='teacher' where user_id=teacher;
    insert into public.edu_students(user_id,name) values(pupil,'Visits regression') returning id into sid;
    perform set_config('request.jwt.claims',json_build_object('sub',pupil,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',pupil::text,true);
    execute 'set local role authenticated';
    perform public.edu_ping('homework',true);
    perform public.edu_ping(null,true);
    select count(*) into n from public.edu_visits where student_id=sid;
    if n<>0 then raise exception 'student must not read private attendance'; end if;
    execute 'reset role';
    select count(*) into n from public.edu_visits where student_id=sid and day=d and visits=1 and active_min=1 and pages->>'homework'='1';
    if n<>1 then raise exception 'ping must record page, Kaliningrad day and deduplicate active minutes'; end if;
    perform set_config('request.jwt.claims',json_build_object('sub',teacher,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',teacher::text,true);
    execute 'set local role authenticated';
    select count(*) into n from public.edu_visits where student_id=sid;
    if n<>1 then raise exception 'teacher must see attendance'; end if;
    execute 'reset role';
    raise exception using errcode='PZ001',message='rollback successful test fixtures';
  exception when sqlstate 'PZ001' then null;
  end;
  if exists(select 1 from auth.users where id in(pupil,teacher)) or exists(select 1 from public.edu_students where id=sid)
    or exists(select 1 from public.edu_visits where student_id=sid) then raise exception 'test fixture rollback failed'; end if;
  raise notice 'PASS: RPC records visits, active minutes are deduplicated, RLS isolates pupils, teacher can read; fixtures rolled back';
end $test$;
