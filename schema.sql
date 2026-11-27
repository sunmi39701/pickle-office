-- =====================================================================
-- 우리가족 비서실 — Supabase 스키마 (v3)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
--
--   1. agents            (비서현황)
--   2. messages          (회의실)
--   3. tasks             (작업실)
--   4. ledger_entries    (가계부)
--   5. parenting_status  (육아현황)
--   6. memos             (공동 메모)
--   7. recipes           (🥣 이유식 레시피북)
--   8. baby_diary        (📖 육아일기)
--
-- ⚠️ 개인정보 금지: 실명·주소·전화번호·생년월일·계좌번호는 저장하지 않습니다.
--    호칭은 '숑미', '찬범', '부자', '찬범비서', 아이는 '다연'·'시준'·'시호'로 씁니다.
-- =====================================================================

-- ── 1. 비서현황 ───────────────────────────────────────────────────────
create table if not exists public.agents (
  id           text primary key,                    -- 'buja' | 'partner'
  name         text not null,
  role         text not null default '',
  status       text not null default '대기',          -- '대기' | '작업중'
  current_task text not null default '',
  updated_at   timestamptz not null default now()
);

-- ── 2. 회의실 ─────────────────────────────────────────────────────────
create table if not exists public.messages (
  id          bigserial primary key,
  room        text not null default 'office',
  sender      text not null,                        -- '숑미' | '찬범' | '부자' | '찬범비서'
  sender_role text not null default 'owner',        -- 'owner' | 'partner' | 'assistant' | 'assistant_partner'
  content     text not null,
  mentions    text[] not null default '{}',         -- ['부자'] | ['찬범비서'] | ['all']
  created_at  timestamptz not null default now()
);
create index if not exists messages_created_at_idx on public.messages (created_at desc);

-- ── 3. 작업실 ─────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id         bigserial primary key,
  title      text not null,
  assignee   text not null default '부자',            -- '부자' | '찬범비서' | '둘 다' | '직접'
  status     text not null default '대기',            -- '대기' | '진행중' | '완료'
  category   text not null default '기타',            -- 육아 | 집안일 | 장보기 | 일정 | 기타
  created_at timestamptz not null default now()
);
create index if not exists tasks_status_idx on public.tasks (status, created_at desc);

-- ── 4. 가계부 (날짜·항목·금액·분류·담당만, 민감정보 없음) ───────────────
create table if not exists public.ledger_entries (
  id         bigserial primary key,
  entry_date date not null default current_date,
  title      text not null,
  amount     integer not null check (amount >= 0),
  category   text not null default '기타',            -- 육아 | 식비 | 생활 | 교통 | 의료 | 기타
  owner      text not null default '공동',            -- '숑미' | '찬범' | '공동'
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ledger_entry_date_idx on public.ledger_entries (entry_date desc);

-- ── 5. 육아현황 ───────────────────────────────────────────────────────
create table if not exists public.parenting_status (
  id          bigserial primary key,
  child_tag   text not null default '다연',           -- '다연' | '시준' | '시호' | '가족'
  category    text not null default '이유식',         -- 이유식 | 수유 | 수면 | 일정 | 건강 | 놀이
  title       text not null,
  detail      text not null default '',
  status_date date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists parenting_status_date_idx on public.parenting_status (status_date desc);

-- ── 6. 공동 메모 ──────────────────────────────────────────────────────
create table if not exists public.memos (
  id         bigserial primary key,
  title      text not null,
  content    text not null default '',
  author     text not null default '',
  pinned     boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists memos_pinned_idx on public.memos (pinned desc, updated_at desc);

-- ── 7. 이유식 레시피북 ────────────────────────────────────────────────
create table if not exists public.recipes (
  id              bigserial primary key,
  day_num         integer,                          -- 생후 일수 (예: 231)
  recipe_date     date,
  title           text not null,                    -- 메뉴명
  main_ingredient text,                             -- '소고기' | '닭고기' | '생선' | '특식'
  ingredients     text,                             -- 재료와 분량
  portion         text,                             -- 1인 g / 칸 g, 물 ml
  tips            text,                             -- 조리 팁 · 영양 포인트
  reaction        text,                             -- 아이들 반응 메모
  created_at      timestamptz not null default now()
);
create index if not exists recipes_day_idx on public.recipes (day_num desc, recipe_date desc);

-- ── 8. 육아일기 ───────────────────────────────────────────────────────
create table if not exists public.baby_diary (
  id          bigserial primary key,
  diary_date  date not null default current_date,
  day_label   text,                                -- '생후 231일차 · 이유식 52일차'
  child_tag   text not null default '함께',         -- '다연' | '시준' | '시호' | '함께'
  title       text not null,
  content     text not null,
  author      text not null default '부자',         -- '숑미' | '찬범' | '부자'
  created_at  timestamptz not null default now()
);
create index if not exists baby_diary_date_idx on public.baby_diary (diary_date desc, created_at desc);

-- ── 기존에 만들어진 테이블의 컬럼 보정 (있으면 건너뜀) ─────────────────
alter table public.agents           add column if not exists role text not null default '';
alter table public.agents           add column if not exists status text not null default '대기';
alter table public.agents           add column if not exists current_task text not null default '';
alter table public.agents           add column if not exists updated_at timestamptz not null default now();

alter table public.messages         add column if not exists room text not null default 'office';
alter table public.messages         add column if not exists sender text;
alter table public.messages         add column if not exists sender_role text not null default 'owner';
alter table public.messages         add column if not exists content text;
alter table public.messages         add column if not exists mentions text[] not null default '{}';
alter table public.messages         add column if not exists created_at timestamptz not null default now();

alter table public.tasks            add column if not exists assignee text not null default '부자';
alter table public.tasks            add column if not exists status text not null default '대기';
alter table public.tasks            add column if not exists category text not null default '기타';
alter table public.tasks            add column if not exists created_at timestamptz not null default now();

alter table public.ledger_entries   add column if not exists entry_date date not null default current_date;
alter table public.ledger_entries   add column if not exists title text;
alter table public.ledger_entries   add column if not exists amount integer;
alter table public.ledger_entries   add column if not exists category text not null default '기타';
alter table public.ledger_entries   add column if not exists owner text not null default '공동';
alter table public.ledger_entries   add column if not exists note text not null default '';
alter table public.ledger_entries   add column if not exists created_at timestamptz not null default now();

alter table public.parenting_status add column if not exists child_tag text not null default '다연';
alter table public.parenting_status add column if not exists category text not null default '이유식';
alter table public.parenting_status add column if not exists title text;
alter table public.parenting_status add column if not exists detail text not null default '';
alter table public.parenting_status add column if not exists status_date date not null default current_date;
alter table public.parenting_status add column if not exists created_at timestamptz not null default now();

alter table public.memos            add column if not exists title text;
alter table public.memos            add column if not exists content text not null default '';
alter table public.memos            add column if not exists author text not null default '';
alter table public.memos            add column if not exists pinned boolean not null default false;
alter table public.memos            add column if not exists updated_at timestamptz not null default now();

alter table public.recipes          add column if not exists day_num integer;
alter table public.recipes          add column if not exists recipe_date date;
alter table public.recipes          add column if not exists title text;
alter table public.recipes          add column if not exists main_ingredient text;
alter table public.recipes          add column if not exists ingredients text;
alter table public.recipes          add column if not exists portion text;
alter table public.recipes          add column if not exists tips text;
alter table public.recipes          add column if not exists reaction text;
alter table public.recipes          add column if not exists created_at timestamptz not null default now();

alter table public.baby_diary       add column if not exists diary_date date not null default current_date;
alter table public.baby_diary       add column if not exists day_label text;
alter table public.baby_diary       add column if not exists child_tag text not null default '함께';
alter table public.baby_diary       add column if not exists title text;
alter table public.baby_diary       add column if not exists content text;
alter table public.baby_diary       add column if not exists author text not null default '부자';
alter table public.baby_diary       add column if not exists created_at timestamptz not null default now();

-- ── 권한(GRANT) — 웹앱의 anon 키가 읽고 쓸 수 있게 ──────────────────────
-- Supabase에서 SQL로 직접 만든 테이블은 anon 역할 권한이 빠져 있을 수 있습니다.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.agents, public.messages, public.tasks, public.ledger_entries,
  public.parenting_status, public.memos, public.recipes, public.baby_diary
to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- ── Row Level Security ────────────────────────────────────────────────
-- GitHub Pages 정적 사이트는 anon 키로 접속하므로, 가족 전용 대시보드를 전제로
-- anon/authenticated 역할에 읽기·쓰기를 허용합니다. (아래 '보안 강화' 참고)
alter table public.agents           enable row level security;
alter table public.messages         enable row level security;
alter table public.tasks            enable row level security;
alter table public.ledger_entries   enable row level security;
alter table public.parenting_status enable row level security;
alter table public.memos            enable row level security;
alter table public.recipes          enable row level security;
alter table public.baby_diary       enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['agents', 'messages', 'tasks', 'ledger_entries', 'parenting_status', 'memos', 'recipes', 'baby_diary']
  loop
    execute format('drop policy if exists "family read"   on public.%I', t);
    execute format('drop policy if exists "family write"  on public.%I', t);
    execute format('drop policy if exists "family update" on public.%I', t);
    execute format('drop policy if exists "family delete" on public.%I', t);
    execute format('create policy "family read"   on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "family write"  on public.%I for insert to anon, authenticated with check (true)', t);
    execute format('create policy "family update" on public.%I for update to anon, authenticated using (true) with check (true)', t);
    execute format('create policy "family delete" on public.%I for delete to anon, authenticated using (true)', t);
  end loop;
end $$;

-- 보안 강화(권장, 나중에): Supabase → Authentication 에서 Email 로그인을 켜고
--   두 분 계정을 만든 뒤, 위 정책의 `to anon, authenticated` 를 `to authenticated` 로,
--   조건은 `using (auth.uid() is not null)` 로 바꾸면 로그인한 사람만 읽고 쓸 수 있습니다.

-- ── 실시간(Realtime) 발행 ─────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['agents', 'messages', 'tasks', 'ledger_entries', 'parenting_status', 'memos', 'recipes', 'baby_diary']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- =====================================================================
-- 기본 비서 2명 (필수)
-- =====================================================================
insert into public.agents (id, name, role, status, current_task)
values
  ('buja',    '부자',     '숑미 님 전담 비서',   '대기', '오피스 맵 · 작업실 카드 정리'),
  ('partner', '찬범비서', '찬범 님 전담 비서', '대기', '장보기 메모 반영 완료')
on conflict (id) do nothing;

-- =====================================================================
-- (선택) 첫 화면 예시 데이터 — 필요 없으면 실행하지 않아도 됩니다.
-- =====================================================================
do $$
begin
  if not exists (select 1 from public.messages) then
    insert into public.messages (sender, sender_role, content, mentions, created_at) values
      ('부자', 'assistant', '좋은 아침이에요, 숑미 님! 오늘 일정이랑 준비물 정리해 두었어요 ☀️', '{}', now() - interval '6 hours'),
      ('찬범비서', 'assistant_partner', '@부자 확인했어요. 찬범 님 오전 일정은 비워 두었습니다.', array['부자'], now() - interval '5 hours 50 minutes'),
      ('숑미', 'owner', '@부자 어린이집 준비물 목록 작업실에 올려줘', array['부자'], now() - interval '5 hours'),
      ('부자', 'assistant', '네, 작업실에 "준비물 챙기기" 카드로 올려 두었어요 ✅', '{}', now() - interval '4 hours 55 minutes'),
      ('찬범', 'partner', '@찬범비서 저녁 장보기 목록 공동 메모에 붙여줘', array['찬범비서'], now() - interval '3 hours'),
      ('찬범비서', 'assistant_partner', '장보기 메모에 6개 항목 붙였습니다. 예산은 4만원으로 잡았어요.', '{}', now() - interval '2 hours 55 minutes');
  end if;

  if not exists (select 1 from public.tasks) then
    insert into public.tasks (title, assignee, status, category) values
      ('어린이집 준비물 챙기기', '부자', '대기', '육아'),
      ('주말 장보기 목록 확정', '찬범비서', '대기', '장보기'),
      ('다음 달 돌봄 일정 조정', '부자', '진행중', '일정'),
      ('이번 달 가계부 결산', '둘 다', '진행중', '기타'),
      ('겨울 내복 사이즈 확인', '찬범비서', '완료', '육아');
  end if;

  if not exists (select 1 from public.ledger_entries) then
    insert into public.ledger_entries (entry_date, title, amount, category, owner, note) values
      (current_date - 5, '기저귀', 32900, '육아', '숑미', '팬티형'),
      (current_date - 4, '이유식 재료', 24500, '식비', '숑미', '채소 · 단백질'),
      (current_date - 3, '분유', 41800, '육아', '찬범', ''),
      (current_date - 2, '생활용품', 18300, '생활', '공동', '세제 · 물티슈'),
      (current_date - 1, '주유', 60000, '교통', '찬범', '');
  end if;

  if not exists (select 1 from public.parenting_status) then
    insert into public.parenting_status (child_tag, category, title, detail, status_date) values
      ('다연', '이유식', '이유식 120ml 완식', '새 재료 없이 익숙한 메뉴', current_date),
      ('다연', '수면', '낮잠 1시간 20분', '', current_date),
      ('시준', '이유식', '단호박 첫 시도', '피부 반응 살피는 중 · 소량만', current_date),
      ('시준', '일정', '오전 돌봄 선생님 방문', '예정대로 진행', current_date),
      ('시호', '수유', '분유 180ml', '', current_date),
      ('시호', '건강', '체온 36.7도', '컨디션 좋음', current_date);
  end if;

  if not exists (select 1 from public.memos) then
    insert into public.memos (title, content, author, pinned) values
      ('장보기', '우유 2통 · 바나나 · 아보카도 · 물티슈(국산)', '찬범', true),
      ('육아', '어린이집 여벌옷 2벌 챙기기 / 주말에 이유식 큐브 만들기', '숑미', false),
      ('생활', '현관 센서등 교체 알아보기 · 분리수거는 금요일 저녁', '찬범', false),
      ('기타', '12월 가족사진 예약 알아보기', '숑미', false);
  end if;
end $$;
