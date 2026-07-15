-- 아침 약 복용 대시보드 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.

create table if not exists medications (
  id bigint generated always as identity primary key,
  name text not null,
  dosage text,
  memo text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists intake_logs (
  id bigint generated always as identity primary key,
  medication_id bigint not null references medications(id),
  date text not null, -- 'YYYY-MM-DD'
  taken_at timestamptz not null default now(),
  unique (medication_id, date)
);

create index if not exists intake_logs_date_idx on intake_logs (date);

-- RLS: 로그인(authenticated)한 사용자만 읽기/쓰기 가능
alter table medications enable row level security;
alter table intake_logs enable row level security;

create policy "authenticated full access" on medications
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on intake_logs
  for all to authenticated using (true) with check (true);
