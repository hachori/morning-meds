-- 가족 기능 마이그레이션 (기존 운영 DB용)
-- persons 테이블을 추가하고 기존 약을 기본 구성원 '나'에게 연결합니다.

create table if not exists persons (
  id bigint generated always as identity primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table persons enable row level security;

create policy "authenticated full access" on persons
  for all to authenticated using (true) with check (true);

insert into persons (name) values ('나');

alter table medications add column if not exists person_id bigint references persons(id);

update medications
  set person_id = (select id from persons order by id limit 1)
  where person_id is null;

alter table medications alter column person_id set not null;
