-- 약 체크 — Supabase 스키마 (신규 설치용)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 이미 운영 중인 DB라면: 가족 기능은 migrate-persons.sql, 시간대 기능은 migrate-slot.sql 을 사용하세요.

create table if not exists persons (
  id bigint generated always as identity primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists medications (
  id bigint generated always as identity primary key,
  name text not null,
  dosage text,
  memo text,
  person_id bigint not null references persons(id),
  slot text not null default 'anytime'
    check (slot in ('morning', 'lunch', 'dinner', 'night', 'anytime')),
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
create index if not exists medications_slot_idx on medications (slot) where active;

-- 기본 구성원 1명
insert into persons (name) values ('나');

-- RLS: 로그인(authenticated)한 사용자만 읽기/쓰기 가능
alter table persons enable row level security;
alter table medications enable row level security;
alter table intake_logs enable row level security;

create policy "authenticated full access" on persons
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on medications
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on intake_logs
  for all to authenticated using (true) with check (true);

-- 미복용 조회 RPC (NAS 알림 스크립트용)
--    NAS 스크립트가 조인 없이 한 번에 "그 시간대에 아직 안 먹은 약"을 가져오게 한다.
--    security invoker = RLS 를 그대로 따름 → 로그인한 요청만 결과를 받는다.
--    날짜는 Asia/Seoul 기준 (NAS/DB 타임존과 무관하게 앱의 기기 로컬 날짜와 맞춤).
create or replace function pending_meds(p_slot text, p_date text default null)
returns table (person_name text, med_name text, dosage text)
language sql
stable
security invoker
as $$
  select p.name, m.name, m.dosage
  from medications m
  join persons p on p.id = m.person_id
  where m.active
    and p.active
    and m.slot = p_slot
    and not exists (
      select 1
      from intake_logs l
      where l.medication_id = m.id
        and l.date = coalesce(
          p_date,
          to_char(timezone('Asia/Seoul', now())::date, 'YYYY-MM-DD')
        )
    )
  order by p.created_at, m.created_at;
$$;

grant execute on function pending_meds(text, text) to authenticated;

-- Supabase 는 기본 권한으로 anon 에게도 EXECUTE 를 직접 준다.
-- security invoker + RLS 덕에 anon 이 호출해도 빈 배열이라 데이터가 새지는 않지만,
-- 호출 자체를 막아 한 겹 더 좁힌다. (`revoke ... from public` 만으로는 빠지지 않는다)
revoke execute on function pending_meds(text, text) from public;
revoke execute on function pending_meds(text, text) from anon;
