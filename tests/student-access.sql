-- Regression tests against the real policies. All fixtures roll back, including on failure.
-- Run as the database owner in Supabase SQL Editor, or psql -v ON_ERROR_STOP=1 -f this-file.
do $test$
declare
  own_uid uuid := gen_random_uuid(); other_uid uuid := gen_random_uuid();
  teacher_uid uuid := gen_random_uuid(); unlinked_uid uuid := gen_random_uuid();
  own_sid uuid; other_sid uuid; sent_id uuid; draft_id uuid; other_id uuid;
  own_review text := 'rv-' || substr(md5(gen_random_uuid()::text),1,10);
  other_review text := 'rv-' || substr(md5(gen_random_uuid()::text),1,10);
  sent_path text; draft_path text; other_path text; n int;
begin
  begin
    insert into auth.users(id, instance_id, aud, role, email, created_at, updated_at)
    select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'regression-' || u::text || '@example.invalid', now(), now()
    from unnest(array[own_uid, other_uid, teacher_uid, unlinked_uid]) u;
    update public.edu_profiles set role='teacher' where user_id=teacher_uid;
    insert into public.edu_students(user_id,name) values(own_uid,'Regression owner') returning id into own_sid;
    insert into public.edu_students(user_id,name) values(other_uid,'Regression other') returning id into other_sid;
    insert into public.edu_lessons(student_id,homework,hw_sent_at) values(own_sid,'Regression sent',now()) returning id into sent_id;
    insert into public.edu_lessons(student_id,homework) values(own_sid,'Regression draft') returning id into draft_id;
    insert into public.edu_lessons(student_id,homework,hw_sent_at) values(other_sid,'Regression other',now()) returning id into other_id;
    insert into public.edu_reviews(id,student_id,items) values(own_review,own_sid,'[]'),(other_review,other_sid,'[]');
    sent_path := sent_id::text || '/regression.pdf';
    draft_path := draft_id::text || '/regression.pdf';
    other_path := other_id::text || '/regression.pdf';
    insert into storage.objects(bucket_id,name) values('edu-hw-files',sent_path),('edu-hw-files',draft_path),('edu-hw-files',other_path);

    perform set_config('request.jwt.claims',json_build_object('sub',own_uid,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',own_uid::text,true);
    execute 'set local role authenticated';
    select count(*) into n from public.edu_reviews where id=own_review;
    if n<>1 then raise exception 'ACCESS-01 own review must be readable'; end if;
    select count(*) into n from public.edu_reviews where id=other_review;
    if n<>0 then raise exception 'ACCESS-02 foreign review must be hidden'; end if;
    select count(*) into n from storage.objects where bucket_id='edu-hw-files' and name=sent_path;
    if n<>1 then raise exception 'ACCESS-03 sent homework attachment must be readable'; end if;
    select count(*) into n from storage.objects where bucket_id='edu-hw-files' and name in (draft_path,other_path);
    if n<>0 then raise exception 'ACCESS-04 draft and foreign attachments must be hidden'; end if;
    select count(*) into n from public.edu_students where id in(own_sid,other_sid);
    if n<>0 then raise exception 'ACCESS-05 private student cards must stay hidden'; end if;
    select count(*) into n from public.edu_lessons where id in(sent_id,draft_id,other_id);
    if n<>0 then raise exception 'ACCESS-06 private lesson notes must stay hidden'; end if;
    update public.edu_reviews set items='[{"text":"unauthorized"}]' where id=own_review;
    get diagnostics n=row_count;
    if n<>0 then raise exception 'ACCESS-07 student must not edit review'; end if;
    begin
      delete from storage.objects where bucket_id='edu-hw-files' and name=sent_path;
      get diagnostics n=row_count;
      if n<>0 then raise exception 'ACCESS-08 student must not delete teacher attachment'; end if;
    exception when insufficient_privilege then null; end;
    begin
      insert into storage.objects(bucket_id,name) values('edu-hw-files',sent_id::text||'/unauthorized.pdf');
      raise exception 'ACCESS-09 student uploaded teacher attachment';
    exception when insufficient_privilege then null; end;
    execute 'reset role';

    perform set_config('request.jwt.claims',json_build_object('sub',other_uid,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',other_uid::text,true);
    execute 'set local role authenticated';
    select count(*) into n from public.edu_reviews where id in(own_review,other_review);
    if n<>1 then raise exception 'ACCESS-10 second student must see only their review'; end if;
    select count(*) into n from storage.objects where bucket_id='edu-hw-files' and name in(sent_path,draft_path,other_path);
    if n<>1 then raise exception 'ACCESS-11 second student must see only their file'; end if;
    execute 'reset role';

    perform set_config('request.jwt.claims',json_build_object('sub',unlinked_uid,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',unlinked_uid::text,true);
    execute 'set local role authenticated';
    select count(*) into n from public.edu_reviews where id in(own_review,other_review);
    if n<>0 then raise exception 'ACCESS-12 unlinked user sees reviews'; end if;
    select count(*) into n from storage.objects where bucket_id='edu-hw-files' and name in(sent_path,draft_path,other_path);
    if n<>0 then raise exception 'ACCESS-13 unlinked user sees attachments'; end if;
    execute 'reset role';

    perform set_config('request.jwt.claims','{"role":"anon"}',true);
    perform set_config('request.jwt.claim.sub','',true);
    execute 'set local role anon';
    select count(*) into n from public.edu_reviews where id in(own_review,other_review);
    if n<>0 then raise exception 'ACCESS-14 guest sees reviews'; end if;
    select count(*) into n from storage.objects where bucket_id='edu-hw-files' and name in(sent_path,draft_path,other_path);
    if n<>0 then raise exception 'ACCESS-15 guest sees attachments'; end if;
    execute 'reset role';

    perform set_config('request.jwt.claims',json_build_object('sub',teacher_uid,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',teacher_uid::text,true);
    execute 'set local role authenticated';
    select count(*) into n from public.edu_reviews where id in(own_review,other_review);
    if n<>2 then raise exception 'ACCESS-16 teacher must see both reviews'; end if;
    select count(*) into n from storage.objects where bucket_id='edu-hw-files' and name in(sent_path,draft_path,other_path);
    if n<>3 then raise exception 'ACCESS-17 teacher must see sent, draft and other attachments'; end if;
    execute 'reset role';
    -- Roll back this entire subtransaction without retaining test users or storage metadata.
    raise sqlstate 'PT001' using message='rollback regression fixtures';
  exception when sqlstate 'PT001' then null;
  end;
end $test$;
select 'PASS ACCESS-01..17; all fixtures rolled back' as result;
