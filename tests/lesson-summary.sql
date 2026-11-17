-- Synthetic accounts and summaries are rolled back; no pupil records are changed.
do $test$
declare u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
 sid uuid; other_sid uuid; lid uuid; other_lid uuid; n int;
 v jsonb:='{"title":"Summary regression","covered":"Topic","formulas":"x²","homework":"Practice","fragments":[]}';
begin
 begin
  insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  select x,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','summary-regression-'||x::text||'@example.invalid',now(),now() from unnest(array[u,other_u,t]) x;
  update public.edu_profiles set role='teacher' where user_id=t;
  insert into public.edu_students(user_id,name) values(u,'Summary regression') returning id into sid;
  insert into public.edu_students(user_id,name) values(other_u,'Other regression') returning id into other_sid;
  insert into public.edu_lessons(student_id,date,notes) values(sid,current_date,'PRIVATE TEACHER NOTE') returning id into lid;
  insert into public.edu_lessons(student_id,date) values(other_sid,current_date) returning id into other_lid;
  perform set_config('request.jwt.claims',json_build_object('sub',t,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',t::text,true);execute 'set local role authenticated';
  insert into public.edu_lesson_summaries(lesson_id,draft) values(lid,v),(other_lid,v);
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',u::text,true);execute 'set local role authenticated';
  select count(*) into n from public.edu_lesson_summaries;if n<>0 then raise exception 'SUMMARY-01 pupil read draft table';end if;
  select count(*) into n from public.edu_lesson_summaries(lid);if n<>0 then raise exception 'SUMMARY-02 draft leaked';end if;
  begin insert into public.edu_lesson_summaries(lesson_id,draft) values(gen_random_uuid(),v);raise exception 'SUMMARY-03 pupil wrote draft';exception when insufficient_privilege then null;end;
  execute 'reset role';
  update public.edu_lesson_summaries set published=draft,published_at=now();
  execute 'set local role authenticated';
  select count(*) into n from public.edu_lesson_summaries(null);if n<>1 then raise exception 'SUMMARY-04 published list must contain only owned lesson';end if;
  select count(*) into n from public.edu_lesson_summaries(other_lid);if n<>0 then raise exception 'SUMMARY-05 foreign summary leaked';end if;
  update public.edu_lesson_summaries set published=null,published_at=null where lesson_id=lid;get diagnostics n=row_count;if n<>0 then raise exception 'SUMMARY-06 pupil edited summary';end if;
  execute 'reset role';
  update public.edu_lesson_summaries set draft=jsonb_set(draft,'{covered}','"PRIVATE NEW DRAFT"') where lesson_id=lid;
  execute 'set local role authenticated';
  if (select content->>'covered' from public.edu_lesson_summaries(lid))<>'Topic' then raise exception 'SUMMARY-07 unpublished edit leaked';end if;
  if (select content::text from public.edu_lesson_summaries(lid)) like '%PRIVATE%' then raise exception 'SUMMARY-08 teacher notes leaked';end if;
  execute 'reset role';
  update public.edu_lesson_summaries set published=null,published_at=null where lesson_id=lid;
  execute 'set local role authenticated';select count(*) into n from public.edu_lesson_summaries(lid);if n<>0 then raise exception 'SUMMARY-09 withdrawal failed';end if;execute 'reset role';
  begin update public.edu_lesson_summaries set draft=jsonb_set(v,'{fragments}','[{"src":"javascript:alert(1)","caption":"bad"}]') where lesson_id=lid;raise exception 'SUMMARY-10 invalid image accepted';exception when check_violation then null;end;
  begin update public.edu_lesson_summaries set draft=jsonb_set(v,'{fragments}','[{"src":"data:image/png;base64,YQ==","caption":"a"},{"src":"data:image/png;base64,YQ==","caption":"b"},{"src":"data:image/png;base64,YQ==","caption":"c"},{"src":"data:image/png;base64,YQ==","caption":"d"}]') where lesson_id=lid;raise exception 'SUMMARY-11 excess images accepted';exception when check_violation then null;end;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);perform set_config('request.jwt.claim.sub','',true);execute 'set local role anon';
  begin perform * from public.edu_lesson_summaries(null);raise exception 'SUMMARY-12 guest allowed';exception when insufficient_privilege then null;end;
  execute 'reset role';
  raise sqlstate 'PT001' using message='rollback summary fixtures';
 exception when sqlstate 'PT001' then null;
 end;
 if exists(select 1 from auth.users where id in(u,other_u,t)) then raise exception 'SUMMARY-13 fixture rollback failed';end if;
end $test$;
select 'PASS SUMMARY-01..13; fixtures rolled back' as result;
