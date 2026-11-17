-- Atomic operations replace competing full-board snapshots.
alter table public.edu_boards add column if not exists revision bigint not null default 0;

create table if not exists edu_private.board_batches (
  board_id uuid not null references public.edu_boards(id) on delete cascade,
  batch_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(board_id,batch_id)
);
alter table edu_private.board_batches enable row level security;
revoke all on edu_private.board_batches from public,anon,authenticated;
create index if not exists board_batches_user_id on edu_private.board_batches(user_id);

create or replace function public.edu_board_apply(p_board uuid,p_batch uuid,p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  b public.edu_boards%rowtype; op jsonb; el jsonb; elements jsonb; current_bg text; result jsonb;
  actor uuid := auth.uid(); previous_actor uuid;
begin
  if actor is null then raise insufficient_privilege using message='Not allowed'; end if;
  select * into b from public.edu_boards where id=p_board for update;
  if not found or not public.edu_can_board(p_board::text) then raise insufficient_privilege using message='Not allowed'; end if;
  if p_batch is null then raise invalid_parameter_value using message='Batch id required'; end if;
  select user_id into previous_actor from edu_private.board_batches where board_id=p_board and batch_id=p_batch;
  if found then
    if previous_actor<>actor then raise insufficient_privilege using message='Not allowed'; end if;
    return jsonb_build_object('data',b.data,'revision',b.revision,'updated_at',b.updated_at);
  end if;
  if p_ops is null or jsonb_typeof(p_ops)<>'array' then raise invalid_parameter_value using message='Operations array required'; end if;
  if jsonb_array_length(p_ops)<1 or jsonb_array_length(p_ops)>200 or octet_length(p_ops::text)>3000000 then
    raise invalid_parameter_value using message='Operations too large';
  end if;
  elements := coalesce(b.data->'els','[]'::jsonb); current_bg := coalesce(b.data->>'bg','grid');
  for op in select value from jsonb_array_elements(p_ops) loop
    if op->>'k' in ('add','upd') then
      if jsonb_typeof(op->'els') is distinct from 'array' then raise invalid_parameter_value using message='Elements array required'; end if;
      for el in select value from jsonb_array_elements(op->'els') loop
        if jsonb_typeof(el) is distinct from 'object' or jsonb_typeof(el->'id') is distinct from 'string'
          or length(el->>'id') not between 1 and 128 then raise invalid_parameter_value using message='Invalid element id'; end if;
        if op->>'k'='add' then
          if not exists(select 1 from jsonb_array_elements(elements) e where e->>'id'=el->>'id') then
            elements := elements || jsonb_build_array(el);
          end if;
        else
          select coalesce(jsonb_agg(case when e.value->>'id'=el->>'id' then el else e.value end order by e.n),'[]'::jsonb)
          into elements from jsonb_array_elements(elements) with ordinality e(value,n);
        end if;
      end loop;
    elsif op->>'k'='del' then
      if jsonb_typeof(op->'ids') is distinct from 'array' then raise invalid_parameter_value using message='Ids array required'; end if;
      if exists(select 1 from jsonb_array_elements(op->'ids') e where jsonb_typeof(e)<>'string' or length(e#>>'{}') not between 1 and 128) then
        raise invalid_parameter_value using message='Invalid deletion id';
      end if;
      select coalesce(jsonb_agg(e.value order by e.n),'[]'::jsonb) into elements
      from jsonb_array_elements(elements) with ordinality e(value,n) where not (op->'ids' ? (e.value->>'id'));
    elsif op->>'k'='bg' and op->>'bg' in ('grid','plain') then current_bg := op->>'bg';
    else raise invalid_parameter_value using message='Unsupported board operation';
    end if;
  end loop;
  result := (b.data - '_revision') || jsonb_build_object('els',elements,'bg',current_bg);
  if octet_length(result::text)>3000000 then raise invalid_parameter_value using message='Board too large'; end if;
  update public.edu_boards set data=result,revision=revision+1,updated_at=clock_timestamp() where id=p_board returning * into b;
  insert into edu_private.board_batches(board_id,batch_id,user_id) values(p_board,p_batch,actor);
  return jsonb_build_object('data',b.data,'revision',b.revision,'updated_at',b.updated_at);
end $$;
revoke all on function public.edu_board_apply(uuid,uuid,jsonb) from public,anon;
grant execute on function public.edu_board_apply(uuid,uuid,jsonb) to authenticated;

create or replace function public.edu_board_get(p_board uuid)
returns table(id uuid,student_id uuid,title text,data jsonb,updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id,b.student_id,b.title,b.data || jsonb_build_object('_revision',b.revision),b.updated_at
  from public.edu_boards b where b.id=p_board and public.edu_can_board(p_board::text);
$$;

-- Legacy tabs may save until the board first uses the new protocol. Afterwards,
-- refuse stale full snapshots rather than destroy newly merged work.
create or replace function public.edu_board_save(p_board uuid,p_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare b public.edu_boards%rowtype;
begin
  if auth.uid() is null then raise insufficient_privilege using message='Not allowed'; end if;
  select * into b from public.edu_boards where id=p_board for update;
  if not found or not public.edu_can_board(p_board::text) then return false; end if;
  if b.revision>0 then raise sqlstate 'P0002' using message='Refresh the board page to continue saving'; end if;
  if p_data is null or jsonb_typeof(p_data->'els') is distinct from 'array' or octet_length(p_data::text)>3000000 then
    raise invalid_parameter_value using message='Bad board data';
  end if;
  update public.edu_boards set data=p_data,updated_at=clock_timestamp() where id=p_board;
  return true;
end $$;
