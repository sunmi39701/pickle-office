/*
 * 우리가족 비서실 — 설정 파일
 * ------------------------------------------------------------------
 * 여기 값만 바꾸면 사이트 전체가 바뀝니다. (실명·주소·연락처는 넣지 마세요)
 *
 * Supabase 프로젝트: pickle-office
 *   - SQL Editor 에서 schema.sql 을 실행하면 테이블 6개가 만들어집니다.
 *   - anon(publishable) 키는 브라우저에 공개되는 키입니다. RLS 정책은 schema.sql 참고.
 *
 * PIN 을 바꾸려면 앱 오른쪽 위 ⚙ 설정에서 바꾸는 것이 가장 쉽습니다.
 * (config.js 에 영구 반영하려면 설정 화면에 표시되는 해시 값을 아래 pin.hash 에 붙여넣으세요.)
 * 기본 PIN 4자리는 대화로만 안내합니다(공개 저장소에 평문으로 남기지 않음).
 */
window.PICKLE_OFFICE_CONFIG = {
  officeName: '우리가족 비서실',

  // 화면에 보이는 호칭 (실명 금지)
  family: { owner: '숑미', partner: '찬범' },
  agents: { owner: '부자', partner: '찬범비서' },

  // 4자리 PIN — sha256(PIN + ':' + salt)
  pin: {
    salt: 'pickle-office-v1',
    hash: 'd6100fb5ff4b586e6c8131536ad056268f8b065295ef871357e60d144d92a44d', // sha256(PIN + ':' + salt)
    digits: 4
  },

  supabase: {
    url: 'https://zmxbmyapzquqqnquoypk.supabase.co',
    anonKey: 'sb_publishable_wN82hV7R8YlYukhieM42XQ_gfwHWV05'
  }
};
