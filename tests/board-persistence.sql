-- Real database regressions. Fixtures are rolled back on success and failure.
do $test$
declare
  u uuid := gen_random_uuid(); teacher uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  sid uuid; bid uuid; batch1 uuid := gen_random_uuid(); j jsonb; n int;
begin
  begin
    insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'board-regression-'||id::text||'@example.invalid',now(),now() from unnest(array[u,teacher,outsider]) id;
    update public.edu_profiles set role='teacher' where user_id=teacher;
    insert into public.edu_students(user_id,name) values(u,'Board regression') returning id into sid;
    insert into public.edu_boards(student_id,title) values(sid,'Regression board') returning id into bid;
    perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u::text,true);
    execute 'set local role authenticated';
    if not public.edu_board_save(bid,'{"els":[],"bg":"grid"}') then raise exception 'BOARD-19 legacy client must work before upgrade'; end if;
    j := public.edu_board_apply(bid,batch1,'[{"k":"add","els":[{"id":"a","t":"pt","x":1}]}]');
    if j->>'revision'<>'1' or jsonb_array_length(j->'data'->'els')<>1 then raise exception 'BOARD-01 first operation failed'; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims',json_build_object('sub',teacher,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',teacher::text,true);
    execute 'set local role authenticated';
    j := public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"add","els":[{"id":"b","t":"pt"}]}]');
    if j->>'revision'<>'2' or jsonb_array_length(j->'data'->'els')<>2 then raise exception 'BOARD-02 second client overwrote first'; end if;
    begin
      perform public.edu_board_apply(bid,batch1,'[{"k":"bg","bg":"plain"}]');
      raise exception 'BOARD-18 batch belonging to another account was accepted';
    exception when insufficient_privilege then null; end;
    j := public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"upd","els":[{"id":"a","t":"pt","x":99}]}]');
    if j->'data'->'els'->0->>'x'<>'99' then raise exception 'BOARD-03 update failed'; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u::text,true);
    execute 'set local role authenticated';
    j := public.edu_board_apply(bid,batch1,'[{"k":"add","els":[{"id":"a","t":"pt","x":1}]}]');
    if j->>'revision'<>'3' or j->'data'->'els'->0->>'x'<>'99' then raise exception 'BOARD-04 lost-response retry replayed stale operations'; end if;
    j := public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"del","ids":["a"]}]');
    if jsonb_array_length(j->'data'->'els')<>1 then raise exception 'BOARD-05 delete failed'; end if;
    j := public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"upd","els":[{"id":"a","x":5}]}]');
    if jsonb_array_length(j->'data'->'els')<>1 then raise exception 'BOARD-06 stale update resurrected deleted object'; end if;
    j := public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"add","els":[{"id":"a","x":5}]}]');
    if jsonb_array_length(j->'data'->'els')<>2 then raise exception 'BOARD-07 undo delete failed'; end if;
    j := public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"bg","bg":"plain"}]');
    if j->'data'->>'bg'<>'plain' then raise exception 'BOARD-08 background failed'; end if;
    select count(*) into n from public.edu_board_get(bid) b where (b.data->>'_revision')::int=7;
    if n<>1 then raise exception 'BOARD-09 get must expose latest revision'; end if;
    begin
      perform public.edu_board_save(bid,'{"els":[]}');
      raise exception 'BOARD-10 legacy snapshot overwrote upgraded board';
    exception when sqlstate 'P0002' then null; end;
    begin
      perform public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"set","els":[]}]');
      raise exception 'BOARD-11 full snapshot replacement was accepted';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"bg","bg":"grid"},{"k":"unsupported"}]');
      raise exception 'BOARD-20 partially valid batch was accepted';
    exception when invalid_parameter_value then null; end;
    select count(*) into n from public.edu_board_get(bid) b where b.data->>'bg'='plain' and b.data->>'_revision'='7';
    if n<>1 then raise exception 'BOARD-20 invalid batch changed board state'; end if;
    begin
      perform 1 from edu_private.board_batches;
      raise exception 'BOARD-17 batch metadata is directly readable';
    exception when insufficient_privilege then null; end;
    begin
      perform public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"add","els":[{"x":1}]}]');
      raise exception 'BOARD-12 object without id was accepted';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.edu_board_apply(bid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('k','add','els',jsonb_build_array(jsonb_build_object('id','large','text',repeat('x',3000001))))));
      raise exception 'BOARD-13 oversized operation was accepted';
    exception when invalid_parameter_value then null; end;
    execute 'reset role';
    perform set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',outsider::text,true);
    execute 'set local role authenticated';
    begin
      perform public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"bg","bg":"grid"}]');
      raise exception 'BOARD-14 outsider changed board';
    exception when insufficient_privilege then null; end;
    execute 'reset role';
    perform set_config('request.jwt.claims','{"role":"anon"}',true);
    perform set_config('request.jwt.claim.sub','',true);
    execute 'set local role anon';
    begin
      perform public.edu_board_apply(bid,gen_random_uuid(),'[{"k":"bg","bg":"grid"}]');
      raise exception 'BOARD-15 guest changed board';
    exception when insufficient_privilege then null; end;
    execute 'reset role';
    select count(*) into n from edu_private.board_batches where board_id=bid;
    if n<>7 then raise exception 'BOARD-16 duplicate or rejected operations changed batch history'; end if;
    raise sqlstate 'PT001' using message='rollback board fixtures';
  exception when sqlstate 'PT001' then null;
  end;
end $test$;
select 'PASS BOARD-01..20; all fixtures rolled back' as result;
