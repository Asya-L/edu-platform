-- Run against the installed schema as database owner. Test fixtures always roll back.
do $test$
declare
  teacher_uid uuid := gen_random_uuid();
  student_uid uuid := gen_random_uuid();
  n integer;
begin
  begin
    if not exists (select 1 from public.edu_teacher_materials where id='g5-paired-sections') then
      insert into public.edu_teacher_materials(id,pdf_base64) values ('g5-paired-sections','JVBERi0xLjQ=');
    end if;

    insert into auth.users(id, instance_id, aud, role, email, created_at, updated_at)
    select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'regression-' || u::text || '@example.invalid', now(), now()
    from unnest(array[teacher_uid, student_uid]) u;
    update public.edu_profiles set role='teacher' where user_id=teacher_uid;

    perform set_config('request.jwt.claims',json_build_object('sub',teacher_uid,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',teacher_uid::text,true);
    execute 'set local role authenticated';
    select count(*) into n from public.edu_teacher_materials where id='g5-paired-sections';
    if n<>1 then raise exception 'Teacher cannot read material'; end if;
    if has_table_privilege('public.edu_teacher_materials','insert')
       or has_table_privilege('public.edu_teacher_materials','update')
       or has_table_privilege('public.edu_teacher_materials','delete') then
      raise exception 'Browser may modify teacher materials';
    end if;
    execute 'reset role';

    perform set_config('request.jwt.claims',json_build_object('sub',student_uid,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',student_uid::text,true);
    execute 'set local role authenticated';
    select count(*) into n from public.edu_teacher_materials where id='g5-paired-sections';
    if n<>0 then raise exception 'Student can see teacher material'; end if;
    execute 'reset role';

    perform set_config('request.jwt.claims','{"role":"anon"}',true);
    perform set_config('request.jwt.claim.sub','',true);
    execute 'set local role anon';
    begin
      perform pdf_base64 from public.edu_teacher_materials where id='g5-paired-sections';
      raise exception 'Guest can query teacher materials';
    exception when insufficient_privilege then null; end;
    execute 'reset role';

    raise sqlstate 'PT001' using message='rollback fixtures';
  exception when sqlstate 'PT001' then null;
  end;
end $test$;
select 'PASS: only the teacher reads the PDF; browser writes and guest reads denied; fixtures rolled back' as result;
