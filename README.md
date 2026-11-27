# 우리가족 비서실 🏢

숑미 님과 찬범 님, 두 비서(부자 · 찬범비서)가 함께 쓰는 가족 대시보드입니다.
정적 파일(index.html · styles.css · app.js · config.js)만으로 돌아가고, Supabase를 연결하면 두 분 기기에서 실시간으로 함께 씁니다.

## 메뉴

| 탭 | 내용 |
|---|---|
| 오피스 맵 | 클레이 3D 사무실 이미지 + 지휘실·회의실·라운지 뱃지, 비서 대기/작업중 상태 |
| 회의실 | 실시간 채팅, `@부자` `@찬범비서` `@all` 태그, 멘션 필터 |
| 작업실 | 부부 공동 할 일 보드 (대기 → 진행중 → 완료), 담당 비서·분류 표시 |
| 가계부 | 월별 합산·담당별·분류별 지출, 지출 기록 (민감정보 없이 날짜·항목·금액·분류·담당만) |
| 육아현황 | 아이별 돌봄·이유식·수면·일정 카드 (태명 튼튼이 · 쿵이 · 쾅이만 사용) |
| 공동 메모 | 장보기·육아·생활 메모, 상단 고정(📌) |
| 비서현황 | 최근 활동·상태·지금 하는 일, 연결 상태, 한도 절약 안내 |

## 처음 설정 (3단계)

### 1) Supabase 테이블 만들기
Supabase 프로젝트 → **SQL Editor** → `schema.sql` 전체를 붙여넣고 **Run**.
`agents`, `messages`, `tasks`, `ledger_entries`, `parenting_status`, `memos` 6개 테이블과
RLS 정책, 실시간 발행, 기본 비서 2명이 만들어집니다. (여러 번 실행해도 안전)

### 2) 접속 정보 넣기
`config.js` 의 `supabase` 값을 채웁니다. 이미 채워져 있습니다.

```js
supabase: {
  url: 'https://<프로젝트>.supabase.co',
  anonKey: '<publishable / anon key>'
}
```

> 키를 비우면 **데모 모드**(이 브라우저에만 저장)로 동작합니다. 화면은 그대로 쓸 수 있어요.
> 앱 안 ⚙ 설정에서도 URL·키를 넣고 뺄 수 있습니다(이 브라우저에만 적용).

### 3) GitHub Pages 켜기
저장소 → **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
1~2분 뒤 `https://<사용자>.github.io/pickle-office/` 에서 열립니다.

## PIN 잠금

- 첫 화면은 4자리 PIN 잠금입니다. **기본값 `3970`**.
- PIN은 `sha256(PIN + ':' + salt)` 해시로만 저장하며, 화면·코드에 평문으로 두지 않습니다.
- 바꾸는 방법
  1. 앱 오른쪽 위 **⚙ 설정 → 4자리 비밀번호 변경** (이 브라우저에 저장)
  2. 두 분이 함께 쓰려면 설정 화면에 표시되는 해시를 `config.js` 의 `pin.hash` 에 붙여넣고 다시 배포
- 5회 틀리면 30초 동안 입력이 잠깁니다.
- 한 번 풀면 그 탭에서는 유지되고, **🔒 잠금** 버튼으로 다시 잠급니다.

> ⚠️ 정적 사이트의 PIN은 화면을 가리는 잠금장치입니다. 페이지 소스를 보거나 anon 키로
> API를 직접 호출하면 데이터에 접근할 수 있으므로, **민감한 개인정보는 저장하지 않는 것**이
> 이 구조의 전제입니다. (실명·주소·전화번호·생년월일·계좌번호 금지)

## 개인정보 원칙

- 실명 대신 `숑미`, `찬범`, `부자`, `찬범비서` 호칭만 사용합니다.
- 아이는 태명 `튼튼이`, `쿵이`, `쾅이` 로만 표기합니다.
- 가계부는 날짜·항목·금액·분류·담당만 저장하고 계좌·카드 정보는 넣지 않습니다.
- 저장소가 공개(public)이므로 Pages 주소는 가족에게만 공유하세요.
  더 강한 보호가 필요하면 Supabase Auth(이메일 로그인)를 켜고 RLS 정책을
  `to authenticated` + `auth.uid() is not null` 로 바꾸는 것을 권장합니다. (schema.sql 주석 참고)

## 파일 구성

```
index.html      화면 구조 (잠금 화면 + 7개 탭 + 설정 모달)
styles.css      크림/우드 톤 반응형 스타일
app.js          잠금, 렌더링, Supabase 실시간 연동, 데모 모드
config.js       비서실 이름 · 호칭 · PIN 해시 · Supabase 키
schema.sql      Supabase 테이블 · RLS · 실시간 · 예시 데이터
assets/office-map.png   클레이 3D 오피스 맵
```

## 로컬에서 미리 보기

```bash
cd pickle-office
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```

`file://` 로 열면 브라우저에 따라 PIN 해시 계산이 제한될 수 있으니 로컬 서버 사용을 권장합니다.

## 테이블 요약

| 테이블 | 컬럼 |
|---|---|
| agents | id(text PK) · name · role · status(대기/작업중) · current_task · updated_at |
| messages | id(bigserial) · room · sender · sender_role · content · mentions(text[]) · created_at |
| tasks | id(bigserial) · title · assignee · status(대기/진행중/완료) · category · created_at |
| ledger_entries | id(bigserial) · entry_date · title · amount · category · owner · note · created_at |
| parenting_status | id(bigserial) · child_tag · category · title · detail · status_date · created_at |
| memos | id(bigserial) · title · content · author · pinned · updated_at |
