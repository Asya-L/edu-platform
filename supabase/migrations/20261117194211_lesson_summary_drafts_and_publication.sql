-- A draft is teacher-only; pupils receive only the explicitly published snapshot.
create or replace function edu_private.valid_lesson_summary(v jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare f jsonb;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>2200000 then return false; end if;
 if jsonb_typeof(v->'title') is distinct from 'string' or length(v->>'title') not between 1 and 200 then return false; end if;
 if jsonb_typeof(v->'covered') is distinct from 'string' or length(v->>'covered')>12000
 or jsonb_typeof(v->'formulas') is distinct from 'string' or length(v->>'formulas')>12000
 or jsonb_typeof(v->'homework') is distinct from 'string' or length(v->>'homework')>20000
 or jsonb_typeof(v->'fragments') is distinct from 'array' then return false; end if;
 if jsonb_array_length(v->'fragments')>3 then return false; end if;
 for f in select value from jsonb_array_elements(v->'fragments') loop
  if jsonb_typeof(f)<>'object' or jsonb_typeof(f->'src') is distinct from 'string'
  or length(f->>'src')>700000 or (f->>'src') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'
  or jsonb_typeof(f->'caption') is distinct from 'string' or length(f->>'caption')>300 then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function edu_private.valid_lesson_summary(jsonb) from public,anon;
grant execute on function edu_private.valid_lesson_summary(jsonb) to authenticated;
create table public.edu_lesson_summaries (
 lesson_id uuid primary key references public.edu_lessons(id) on delete cascade,
 draft jsonb not null check (edu_private.valid_lesson_summary(draft)),
 published jsonb check (published is null or edu_private.valid_lesson_summary(published)),
 published_at timestamptz,
 updated_at timestamptz not null default now(),
 check ((published is null) = (published_at is null))
);
alter table public.edu_lesson_summaries enable row level security;
revoke all on public.edu_lesson_summaries from public,anon,authenticated;
grant select,insert,update on public.edu_lesson_summaries to authenticated;
create policy "teacher manages lesson summary drafts" on public.edu_lesson_summaries
 for all to authenticated using (public.edu_is_teacher()) with check (public.edu_is_teacher());
create or replace function public.edu_lesson_summaries(p_lesson uuid default null)
returns table(lesson_id uuid,lesson_date date,content jsonb,published_at timestamptz,homework_sent boolean)
language sql stable security definer set search_path='' as $$
 select m.lesson_id,l.date,case when p_lesson is null then jsonb_build_object('title',m.published->>'title') else m.published end,m.published_at,l.hw_sent_at is not null
 from public.edu_lesson_summaries m join public.edu_lessons l on l.id=m.lesson_id
 join public.edu_students s on s.id=l.student_id
 where (select auth.uid()) is not null and m.published is not null
 and (p_lesson is null or m.lesson_id=p_lesson)
 and (s.user_id=(select auth.uid()) or public.edu_is_teacher())
 order by l.date desc,m.published_at desc limit 200;
$$;
revoke all on function public.edu_lesson_summaries(uuid) from public,anon;
grant execute on function public.edu_lesson_summaries(uuid) to authenticated;
