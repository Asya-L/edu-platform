-- Only teachers may read these materials through the API. Writes are deployment-only.
create table public.edu_teacher_materials (
  id text primary key,
  pdf_base64 text not null check (left(pdf_base64, 7) = 'JVBERi0' and char_length(pdf_base64) between 8 and 1400000)
);

alter table public.edu_teacher_materials enable row level security;
revoke all on public.edu_teacher_materials from public, anon, authenticated;
grant select on public.edu_teacher_materials to authenticated;

create policy "teachers read teacher materials"
  on public.edu_teacher_materials for select to authenticated
  using ((select public.edu_is_teacher()));
