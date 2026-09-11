-- 약 체크 — 시간대(slot) 기능 추가 마이그레이션
-- 이미 운영 중인 DB에 실행하세요. 신규 설치는 setup.sql 하나면 됩니다.
-- intake_logs 는 건드리지 않습니다 — 과거 기록/캘린더 집계 그대로 유지됩니다.

-- 1) 시간대 컬럼
--    기존 약은 모두 'anytime'(알림 없음)으로 들어갑니다.
--    앱의 '약 관리'에서 약마다 시간대를 지정해야 알림이 울립니다.
alter table medications
  add column if not exists slot text not null default 'anytime';

alter table medications
  drop constraint if exists medications_slot_check;
alter table medications
  add constraint medications_slot_check
  check (slot in ('morning', 'lunch', 'dinner', 'night', 'anytime'));

create index if not exists medications_slot_idx on medications (slot) where active;

-- 2) 미복용 조회 RPC
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
