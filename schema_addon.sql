-- =====================================================================
-- 우리가족 비서실 — 스키마 확장 (v3) · 이유식 레시피북 + 육아일기
-- ---------------------------------------------------------------------
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다. (테이블은 if not exists, 시드는 비어 있을 때만)
--
--   추가되는 테이블 2개
--     7. recipes     (🥣 이유식 레시피북)
--     8. baby_diary  (📖 육아일기)
--
--   · 권한(GRANT) · RLS(family read/write/update/delete) · Realtime 발행 포함
--   · 시드 데이터: 2026-11-07 ~ 11-26 실제 대화에서 확정한 레시피 28건,
--     육아일기 12건 (주소·연락처·생년월일·병원명 등은 넣지 않았습니다)
-- =====================================================================

-- ── 7. 이유식 레시피북 ────────────────────────────────────────────────
create table if not exists public.recipes (
  id             bigserial primary key,
  day_num        integer,                          -- 생후 일수 (예: 231)
  recipe_date    date,
  title          text not null,                    -- 메뉴명
  main_ingredient text,                            -- '소고기' | '닭고기' | '생선' | '특식'
  ingredients    text,                             -- 재료와 분량
  portion        text,                             -- 1인 g / 칸 g, 물 ml
  tips           text,                             -- 조리 팁 · 영양 포인트
  reaction       text,                             -- 아이들 반응 메모
  created_at     timestamptz not null default now()
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

-- ── 기존 테이블 컬럼 보정 (앞서 만든 적이 있어도 안전) ────────────────
alter table public.recipes add column if not exists day_num integer;
alter table public.recipes add column if not exists recipe_date date;
alter table public.recipes add column if not exists title text;
alter table public.recipes add column if not exists main_ingredient text;
alter table public.recipes add column if not exists ingredients text;
alter table public.recipes add column if not exists portion text;
alter table public.recipes add column if not exists tips text;
alter table public.recipes add column if not exists reaction text;
alter table public.recipes add column if not exists created_at timestamptz not null default now();

alter table public.baby_diary add column if not exists diary_date date not null default current_date;
alter table public.baby_diary add column if not exists day_label text;
alter table public.baby_diary add column if not exists child_tag text not null default '함께';
alter table public.baby_diary add column if not exists title text;
alter table public.baby_diary add column if not exists content text;
alter table public.baby_diary add column if not exists author text not null default '부자';
alter table public.baby_diary add column if not exists created_at timestamptz not null default now();

-- ── 권한(GRANT) — anon 키로 읽고 쓰기 ─────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.recipes, public.baby_diary to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- ── Row Level Security ────────────────────────────────────────────────
alter table public.recipes    enable row level security;
alter table public.baby_diary enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['recipes', 'baby_diary']
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

-- ── 실시간(Realtime) 발행 ─────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['recipes', 'baby_diary']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- =====================================================================
-- 시드 데이터 — 지금까지 확정한 실제 레시피 (28건)
--   이미 레시피가 한 건이라도 있으면 건너뜁니다(직접 추가한 기록 보호).
-- =====================================================================
do $$
begin
  if not exists (select 1 from public.recipes) then
    insert into public.recipes (day_num, recipe_date, title, main_ingredient, ingredients, portion, tips, reaction) values
      (212, '2026-11-07', '땅콩소스 두부', '특식', '두부 30g · 무첨가 100% 땅콩버터 소량', '간식 1회 · 두부 30g', '두부(대두) 첫 시도. 땅콩버터는 무첨가만 쓰고, 입 주변 발진·피부 반응을 30분 살핀다.', '5/10점 — 낯선 식감에 오묘한 표정, 절반 정도 먹음. 대두 알레르기 반응은 없었음.'),
      (213, '2026-11-09', '닭가슴살 사과 당근 오트밀 쌀죽', '닭고기', '중기쌀가루 15g · 퀵오트밀 15g · 닭가슴살 20g · 사과 20g · 당근 20g · 물 130ml', '1인 120g · 2인 240g (곡물 30g : 물 130ml)', '이유식·영양죽 모드로 4.3배죽. 사과 단맛이 당근 향을 부드럽게 잡아 준다.', '시준 120g · 시호 110g 완식. 둘 다 10/10점, 10~13분 만에 비움.'),
      (215, '2026-11-11', '한우 안심 케일 사과죽', '소고기', '한우 안심 40g · 케일 15g · 사과 20g · 중기쌀가루 25g · 물 150ml', '1인 120g · 칸 240g', '철분 집중 식단. 케일은 데쳐 다지고 계란은 뺀다 — 소고기 철분 흡수를 막지 않게.', '둘 다 120g 완밥 10/10점. 오전 240g 올클리어.'),
      (215, '2026-11-11', '닭고기 양배추 고구마 오트밀죽', '닭고기', '닭가슴살 20g · 계란 전란 1개 · 양배추 15g · 고구마 20g · 퀵오트밀 15g · 중기쌀가루 10g · 물 150ml', '1인 120g · 칸 240g', '전란은 취사 직전에 풀어 넣고 1인 1/2개. 저녁은 소화 편한 조합으로.', '둘 다 120g 완밥. 계란 알레르기 이상무, 하루 480g 올클리어.'),
      (217, '2026-11-12', '한우 안심 검정콩 사과 오트밀 쌀죽', '소고기', '한우 안심 20g · 검정콩 15g · 사과 20g · 오트밀죽 자투리 9g · 중기쌀가루 25g · 물 160ml', '1인 120g · 칸 240g', '시준 변비 케어 — 사과 펙틴 + 오트밀 베타글루칸. 전 재료 기검증, 계란 없음.', '둘 다 완밥. 다음 날 시준 쾌변 — 변비 해소 조합으로 등록.'),
      (217, '2026-11-12', '닭가슴살 고구마 비타민 오트밀 계란죽', '닭고기', '닭가슴살 20g · 계란 전란 1개 · 고구마 20g · 비타민 큐브 15g · 오트밀죽 큐브 34g · 중기쌀가루 15g · 물 140ml', '1인 120g · 칸 240g', '비타민 큐브 첫 시도. 남은 오트밀죽 큐브를 퐁당 넣어 농도를 맞췄다.', '신규 비타민·전란 알레르기 이상무, 선호도 10/10. 저녁도 120g 완밥.'),
      (218, '2026-11-13', '한우 안심 당근 양배추 오트밀 쌀죽', '소고기', '한우 안심 40g · 당근 15g · 양배추 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 150ml', '1인 120g · 칸 240g', '자투리 채소 소진 메뉴. 먹이기 직전 기버터 1g 또는 올리브유 1방울.', '바닥까지 완밥 — 둘 다 120g, 하루 480g 올클리어.'),
      (218, '2026-11-13', '순살 가자미살 단호박 배 오트밀 전란죽', '생선', '가자미살 25g · 계란 전란 1개 · 단호박 15g · 배 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 140ml', '1인 120g · 칸 240g', '배 큐브 첫 도입. 가자미는 저수은 흰살생선, 전란은 취사 직전에.', '둘 다 120g 완밥 — 배 알레르기 없이 통과.'),
      (219, '2026-11-14', '한우 안심 배 콜리플라워 오트밀 쌀죽', '소고기', '한우 안심 40g · 배 15g · 콜리플라워 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 150ml', '1인 120g · 칸 240g', '콜리플라워 비타민C + 배 유기산으로 철분 흡수를 돕는 조합. 계란 없음.', '개별 기록 없음 — 다음 날 전 메뉴를 잘 먹었다는 보고.'),
      (219, '2026-11-14', '닭가슴살 고구마 케일 오트밀 전란죽', '닭고기', '닭가슴살 20g · 계란 전란 1개 · 고구마 20g · 케일 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 140ml', '1인 120g · 칸 240g', '트립토판·콜린 조합으로 저녁 통잠을 노린 메뉴. 단호박 미보유라 케일로.', '개별 기록 없음.'),
      (220, '2026-11-15', '한우 안심 사과 비타민 오트밀 쌀죽', '소고기', '한우 안심 40g · 사과 15g · 비타민 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 150ml (취사 후 기버터 1g)', '1인 120g · 칸 240g · 하루 208kcal · 단백질 12.9g · 철분 1.9mg', '역대 1위 조합. 이날은 기버터를 깜빡하고 급여 — 다음 재등장 때는 완전체로.', '최고 반응 — 둘 다 지금까지 먹은 메뉴 중 가장 잘 먹음. 거부 없이 완밥.'),
      (220, '2026-11-15', '가자미 고구마 무 오트밀 전란죽', '생선', '가자미살 25g · 계란 전란 1개 · 고구마 20g · 무 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 140ml', '1인 120g · 칸 240g · 하루 208.1kcal', '일요일 안전 원칙 — 새 재료 0종. 무 소화 효소로 야간 부담을 줄인다.', '둘 다 거부 없이 잘 먹음. 계란·가자미·무 전 재료 이상 없음.'),
      (221, '2026-11-16', '한우 안심 사과 완두콩 오트밀 쌀죽', '소고기', '한우 안심 40g · 사과 15g · 완두콩 15g · 중기쌀가루·오트밀 30g · 물 150ml (기버터 1g)', '1인 120g · 칸 240g', '완두콩은 이미 통과한 재료. 사과 유기산으로 소고기 철분 흡수를 돕는다.', '시호 아침 125g 완밥 — 그릇을 뚝딱 비움. 시준·저녁 섭취는 기록 없음.'),
      (221, '2026-11-16', '닭가슴살 고구마 양배추 오트밀 전란죽', '닭고기', '닭가슴살 20g · 계란 전란 1개 · 고구마 20g · 양배추 15g · 중기쌀가루·오트밀 30g · 물 140ml', '1인 120g · 칸 240g', '애호박·당근 미보유로 양배추로 교체. 전란은 1인 1/2개.', '기록 없음.'),
      (222, '2026-11-17', '한우 안심 배 오이 오트밀 쌀죽', '소고기', '한우 안심 40g · 오이 15g · 배 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 150ml (기버터 1g)', '1인 120g · 칸 240g', '오이 첫 도전 — 껍질·씨 제거 후 다짐. 낮에 첫 급여하고 계란은 뺐다.', '급여 후 기록 없음.'),
      (222, '2026-11-17', '가자미 고구마 검정콩 오트밀 전란죽', '생선', '가자미살 25g · 계란 전란 1개 · 고구마 20g · 검정콩 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 145ml', '1인 120g · 칸 240g', '저녁은 새 재료 0종. 케일 배합안에서 검정콩 15g으로 교체.', '기록 없음.'),
      (223, '2026-11-18', '한우 사과 비타민 아보카도죽', '소고기', '한우 안심 40g · 사과 15g · 비타민 15g · 아보카도 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 150ml · 올리브유 1방울', '1인 120g · 칸 240g', '아보카도는 취사 후 따뜻할 때 으깨 섞기. 올레산이 지용성 영양 흡수를 돕는다.', '기록 없음 — 아보카도 첫 반응은 관찰 대기.'),
      (223, '2026-11-18', '닭가슴살 고구마 케일 오트밀 전란죽', '닭고기', '닭가슴살 20g · 계란 전란 1개 · 고구마 20g · 케일 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 140ml', '1인 120g · 칸 240g', '단호박·브로콜리 미보유로 케일 교체. 저녁 1인 118kcal.', '기록 없음.'),
      (226, '2026-11-21', '한우 사과 양배추 오트밀죽', '소고기', '한우 안심 40g · 사과 15g · 양배추 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 150ml · 올리브유 1방울', '1인 120g · 칸 240g', '당초 생선(가자미) 메뉴로 잡았다가 냉동고 사정으로 한우로 교체.', '반응 좋았음 — 11-22 보고.'),
      (226, '2026-11-21', '닭가슴살 당근 무 전란죽', '닭고기', '닭가슴살 20g · 계란 전란 1개 · 당근 20g · 무 15g · 중기쌀가루 15g · 퀵오트밀 15g · 물 140ml', '1인 120g · 칸 240g', '단호박 미보유로 당근 20g 교체. 무는 소화 효소로 야간 부담을 덜어 준다.', '반응 좋았음.'),
      (228, '2026-11-23', '한우 애호박 사과 오트밀죽', '소고기', '한우 안심 40g · 애호박 15g · 사과 15g · 중기쌀가루 17~18g · 퀵오트밀 17~18g · 물 160ml · 올리브유 1방울', '1인 130g · 칸 260g (120g → 130g 증량 첫날)', '증량 첫날. 물은 10ml 단위로만 잡고 곡물은 17~18g씩.', '기록 없음.'),
      (228, '2026-11-23', '닭가슴살 양송이 당근 전란죽', '닭고기', '닭가슴살 15g · 계란 전란 1개 · 양송이버섯 15g · 당근 20g · 중기쌀가루 17~18g · 퀵오트밀 17~18g · 물 150ml', '1인 130g · 칸 260g', '양송이버섯 첫 도전 — 잘게 다져 넣는다. 계란은 취사 직전.', '양송이 첫 급여 반응 무난함 (11-24 보고).'),
      (229, '2026-11-24', '한우 새송이 비타민 오트밀죽', '소고기', '한우 안심 40g · 새송이버섯 15g · 비타민 15g · 중기쌀가루 17~18g · 퀵오트밀 17~18g · 물 160ml · 올리브유 1방울 (취사 후 기버터 1g)', '1인 130g · 칸 260g', '새송이버섯 첫 도전. 식감이 질기지 않게 결 반대로 다진다.', '반응 기록 없음.'),
      (229, '2026-11-24', '대구살 고구마 양배추 전란죽', '생선', '대구살 25g · 계란 전란 1개 · 고구마 20g · 양배추 15g · 중기쌀가루 17~18g · 퀵오트밀 17~18g · 물 160ml', '1인 130g · 칸 260g', '저수은 흰살생선 대구로 단백질 순환. 계란은 취사 직전.', '기록 없음.'),
      (230, '2026-11-25', '한우 비트 양파 오트밀죽', '소고기', '한우 안심 40g · 비트 15g · 양파 15g · 중기쌀가루 17~18g · 퀵오트밀 17~18g · 물 160ml · 올리브유 1방울 (취사 후 기버터 1g)', '1인 130g · 칸 260g · 하루 221.5kcal · 단백질 12.8g · 철분 1.7mg', '비트 첫 도전. 색소 때문에 붉은 대소변이 나올 수 있다고 미리 알고 보기. 이날은 오후 4시 급여.', '반응 기록 없음 — 붉은 변 여부는 따로 확인하지 못함.'),
      (230, '2026-11-25', '닭가슴살 애호박 당근 전란죽', '닭고기', '닭가슴살 15g · 계란 전란 1개 · 애호박 15g · 당근 20g · 중기쌀가루 17~18g · 퀵오트밀 17~18g · 물 150ml', '1인 130g · 칸 260g', '기검증 재료만으로 짠 저녁. 애호박은 씨 제거 후 다짐.', '기록 없음.'),
      (231, '2026-11-26', '한우 가지 배 오트밀죽', '소고기', '한우 안심 40g · 가지 15g · 배 15g · 중기쌀가루 17~18g · 퀵오트밀 17~18g · 물 160ml · 올리브유 1방울 (취사 후 기버터 1g)', '1인 130g · 칸 260g · 아침 100kcal · 단백질 6.1g', '가지 첫 도전 — 껍질은 질겨서 벗겨 낸다. 배의 단맛으로 가지 향을 눌러 준다.', '기록 없음 — 첫 급여 반응 관찰 예정.'),
      (231, '2026-11-26', '대구살 고구마 당근 전란죽', '생선', '대구살 25g · 계란 전란 1개 · 고구마 20g · 당근 20g · 중기쌀가루 17~18g · 퀵오트밀 17~18g · 물 150ml', '1인 130g · 칸 260g · 저녁 130kcal · 단백질 7.3g', '기검증 재료 조합. 하루 단백질 13.4g을 맞춘 저녁 짝.', '기록 없음.');
  end if;
end $$;

-- =====================================================================
-- 시드 데이터 — 육아일기 (12건)
-- =====================================================================
do $$
begin
  if not exists (select 1 from public.baby_diary) then
    insert into public.baby_diary (diary_date, day_label, child_tag, title, content, author) values
      ('2026-11-26', '생후 231일차 · 이유식 52일차', '함께', '가지 하나로 시작한 52일째', E'오늘의 새 재료는 가지였어요. 껍질이 질길 수 있어서 벗겨 내고, 달큰한 배 15g과 한우 안심 40g에 섞었습니다. 하루에 새 재료는 하나씩 — 이 원칙을 지킨 지도 벌써 52일째예요.\n아침은 한우 가지 배 오트밀죽, 저녁은 대구살 고구마 당근 전란죽으로 단백질을 순환시켰어요. 가지 반응은 아직 기록 전이라, 입 주변 발진이나 대소변 변화가 있으면 알려 주세요.', '부자'),
      ('2026-11-25', '생후 230일차 · 이유식 51일차', '함께', '비트를 처음 만난 날', E'새 재료는 비트 15g. 부득이하게 오후 4시에 급여하게 되어, 붉은 색소 때문에 기저귀가 붉게 보일 수 있다는 점을 미리 적어 두었어요.\n아침 한우 비트 양파 오트밀죽, 저녁 닭가슴살 애호박 당근 전란죽. 하루 221.5kcal, 단백질 12.8g, 철분 1.7mg.', '부자'),
      ('2026-11-24', '생후 229일차 · 이유식 50일차', '시호', '이유식 직후 입가로 살짝', '아침에 생선 이유식을 먹이고 바로 직후에 시호가 입가로 게워냈어요. 분수처럼 뿜은 게 아니라 흘린 정도였고, 그 뒤로는 평소처럼 잘 놀았습니다. 130g으로 늘린 지 얼마 안 돼서 배가 찼던 것 같아요. 식후 20~30분은 세워 안고 있기로 했어요.', '숑미'),
      ('2026-11-22', '생후 227일차', '시호', '안방 강화마루 52cm, 그날 밤', E'낮 12시 21분, 시호가 침대에서 안방 강화마루로 떨어졌어요. 높이는 52cm.\n그날 밤엔 내가 잘못한 것 같아 잠을 못 잤습니다. 의식 이상도, 두개골 함몰도, 5초 이상 기절도 없었고 이마에 큰 멍이 든 것도 아니라서 2세 미만 기준으로는 머리 CT가 필요 없는 칸에 해당한다고 했어요. 48시간은 지켜보기로 하고, 침실은 바닥으로 바꾸기로 했습니다. 지금은 잘 먹고 잘 움직여요.', '숑미'),
      ('2026-11-21', '생후 226일차', '시호', '5일 만에 키가 1.3cm 줄었다?', E'동네 소아과에서 시호 65.7cm · 7.7kg. 5일 전에는 67.0cm였는데 1.3cm가 줄어 보여서 한참 들여다봤어요.\n같은 날 잰 게 아니라 자세와 측정 방식이 달라질 수 있고, 몸무게가 그대로인 걸 보면 급하게 자라다 멈춘 게 아니라 재는 자세 차이일 가능성이 커요. 다음 계측은 한 달 간격으로 천천히 보기로 했습니다.', '부자'),
      ('2026-11-18', '생후 223일차', '시호', '빨간 수납 스툴을 짚고 일어선 날', E'다연이가 바나나 먹는 걸 보다가, 시호가 빨간 수납 스툴을 두 손으로 짚고 스스로 일어났어요. 사진 두 장 남겼습니다.\n잡고 서는 것까지 왔으니 이제 잡고 걷는 날이 멀지 않았어요. 이날 아침 이유식은 한우 사과 비타민 아보카도죽.', '숑미'),
      ('2026-11-18', '생후 223일차', '시준', '엎드린 자세에서 엉덩이를 들기 시작', '시준이는 엎드린 자세에서 엉덩이를 들기 시작했어요. 네발기기로 넘어가는 신호라고 해서 사진을 남겨 두었습니다. 형은 조용히 순서대로 가는 편이에요.', '숑미'),
      ('2026-11-16', '생후 221일차', '함께', '8일 만의 계측 — 몸무게는 그대로, 키만', E'시준 65.0cm · 7.2kg, 시호 67.0cm · 7.7kg. 8일 전과 견줘 몸무게는 그대로고 키만 시준 +0.4cm, 시호 +0.1cm.\n백분위로는 시준 키 1.9%·몸무게 8.4%, 시호 키 12.2%·몸무게 22.0%. 숫자가 내려간 것처럼 보이는 건 일수만 늘었기 때문이라, 한 달 간격 추세로 보기로 했어요. 겨울 내복 80호에 잘 맞는다는 것도 확인했습니다.', '부자'),
      ('2026-11-15', '생후 220일차', '함께', '지금까지 먹은 메뉴 중 최고 반응', E'한우 안심 40g에 사과 15g, 비타민 15g을 넣은 아침 죽을 둘 다 거부 없이 완밥했어요. 지금까지 먹은 메뉴 중에 제일 잘 먹은 날이었습니다.\n다만 기버터 1g을 깜빡해서 지방 보강 없이 먹었다는 건 기록해 둬요. 다음에 다시 낼 때는 완전체로.', '부자'),
      ('2026-11-11', '생후 215일차', '함께', '하루 480g, 둘 다 동시 완밥', '아침 한우 케일 사과죽, 저녁 닭고기 양배추 고구마 오트밀죽. 네 끼 모두 120g씩, 하루 480g을 남김없이 비웠어요. 칸막이 밥솥 한 번으로 두 끼를 만드는 방식이 자리 잡힌 날입니다.', '부자'),
      ('2026-11-09', '생후 213일차', '함께', '10분 만에 싹 비운 첫 닭가슴살 죽', '닭가슴살 20g에 사과·당근 20g씩, 곡물 30g에 물 130ml. 시준이가 10분, 시호가 13분 만에 그릇을 비웠어요. 기상 후 1시간 반쯤 놀다 먹으면 식욕이 확 올라온다는 걸 알게 된 날입니다.', '부자'),
      ('2026-11-08', '생후 212일차', '함께', '휴지에 적어 온 첫 계측, 시준 7kg', E'소아과에서 급히 휴지에 적어 온 숫자: 시준 64.6cm · 7.2kg, 시호 66.9cm · 7.5kg.\n한 달 전과 견주면 시준이는 7kg을 처음 넘었고(체중 백분위 8.2% → 9.8%), 시호는 키가 2.6cm 자라(6.0% → 14.8%) 키 백분위가 크게 올랐어요. 체중이 정체였던 시준이가 앞자리를 바꾼 게 제일 반가웠습니다.', '부자');
  end if;
end $$;

-- 확인용
-- select count(*) as recipes from public.recipes;
-- select count(*) as diaries  from public.baby_diary;
