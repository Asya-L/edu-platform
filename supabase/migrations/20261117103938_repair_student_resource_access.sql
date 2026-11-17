-- Keep private student cards inaccessible; expose only a caller-bound ownership predicate.
create schema if not exists edu_private;
revoke all on schema edu_private from public;
grant usage on schema edu_private to authenticated;

create or replace function edu_private.owns_student(p_student uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.edu_students s
    where s.id = p_student and s.user_id = (select auth.uid())
  );
$$;
revoke all on function edu_private.owns_student(uuid) from public, anon;
grant execute on function edu_private.owns_student(uuid) to authenticated;

alter policy "edu: повторения — свои" on public.edu_reviews
to authenticated using (edu_private.owns_student(student_id));

alter policy "edu-hw-files: ученик читает свою домашку" on storage.objects
to authenticated using (
  bucket_id = 'edu-hw-files'
  and public.edu_owns_lesson((storage.foldername(name))[1])
);
