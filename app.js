/* ==================================================================
 * 우리가족 비서실 — app.js
 * PIN 잠금 + 오피스맵 / 회의실 / 작업실 / 가계부 / 육아현황 / 공동 메모 / 비서현황
 * Supabase(@supabase/supabase-js v2) 실시간 연결, 키가 없거나 실패하면 데모 모드.
 *
 * 테이블 (schema.sql 과 동일)
 *   agents(id text, name, role, status, current_task, updated_at)
 *   messages(id bigserial, room, sender, sender_role, content, mentions[], created_at)
 *   tasks(id bigserial, title, assignee, status, category, created_at)
 *   ledger_entries(id bigserial, entry_date, title, amount, category, owner, note, created_at)
 *   parenting_status(id bigserial, child_tag, category, title, detail, status_date, created_at)
 *   memos(id bigserial, title, content, author, pinned, updated_at)
 * ================================================================== */
(function () {
  'use strict';

  /* ── 설정 ─────────────────────────────────────────────── */
  var CFG = Object.assign({
    officeName: '우리가족 비서실',
    family: { owner: '숑미', partner: '찬범' },
    agents: { owner: '부자', partner: '찬범비서' },
    pin: { salt: 'pickle-office-v1', hash: '', digits: 4 },
    supabase: { url: '', anonKey: '' }
  }, window.PICKLE_OFFICE_CONFIG || {});
  CFG.family = Object.assign({ owner: '숑미', partner: '찬범' }, CFG.family || {});
  CFG.agents = Object.assign({ owner: '부자', partner: '찬범비서' }, CFG.agents || {});
  CFG.pin = Object.assign({ salt: 'pickle-office-v1', hash: '', digits: 4 }, CFG.pin || {});

  var SALT = CFG.pin.salt;
  var DIGITS = CFG.pin.digits || 4;
  var LS = {
    pin: 'po.pinHash',
    supa: 'po.supabaseCfg',
    demo: 'po.demo.v3',
    me: 'po.me',
    seenChat: 'po.seenChat',
    unlocked: 'po.unlocked'
  };
  var TABLES = ['messages', 'tasks', 'ledger_entries', 'parenting_status', 'memos', 'agents'];
  var TASK_COLUMNS = ['대기', '진행중', '완료'];
  var STATUS_ALIAS = { todo: '대기', doing: '진행중', done: '완료', '대기중': '대기', '진행': '진행중', '작업중': '진행중' };
  var AGENT_STATUS_ALIAS = { online: '작업중', offline: '대기', active: '작업중', idle: '대기', busy: '작업중', '대기중': '대기' };

  /* ── 유틸 ─────────────────────────────────────────────── */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function nowIso() { return new Date().toISOString(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toDate(v) { return v instanceof Date ? v : new Date(v); }
  function dateKey(d) { d = toDate(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function monthKey(d) { d = toDate(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function fmtTime(v) { var d = toDate(v); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDay(v) {
    var d = toDate(v);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate();
  }
  function fmtDateLabel(v) {
    var d = toDate(v);
    if (isNaN(d)) return '';
    var t = new Date();
    if (dateKey(d) === dateKey(t)) return '오늘';
    if (dateKey(d) === dateKey(new Date(t.getTime() - 86400000))) return '어제';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  function relTime(v) {
    var d = toDate(v);
    if (isNaN(d)) return '-';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 0) return '방금 전';
    if (diff < 60) return '방금 전';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    if (diff < 86400 * 2) return '어제 ' + fmtTime(d);
    return fmtDay(d) + ' ' + fmtTime(d);
  }
  function won(n) { return '₩' + (Number(n) || 0).toLocaleString('ko-KR'); }
  function parseMentions(text) {
    var out = [], re = /@(부자|찬범비서|all)/g, m;
    while ((m = re.exec(text)) !== null) if (out.indexOf(m[1]) === -1) out.push(m[1]);
    return out;
  }
  function highlightMentions(text) {
    return esc(text).replace(/@(부자|찬범비서|all)/g, '<span class="mention">@$1</span>');
  }
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }
  function roleOf(name) {
    if (name === CFG.agents.owner) return 'assistant';
    if (name === CFG.agents.partner) return 'assistant_partner';
    if (name === CFG.family.owner) return 'owner';
    if (name === CFG.family.partner) return 'partner';
    return 'owner';
  }

  /* ── SHA-256 (crypto.subtle, 실패 시 순수 JS) ───────────── */
  function jsSha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32), result = '', words = [], i, j;
    var asciiBitLength = ascii.length * 8;
    var hash = jsSha256.h = jsSha256.h || [], k = jsSha256.k = jsSha256.k || [];
    var primeCounter = k.length, isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) +
            w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }
  function sha256(str) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }).catch(function () { return jsSha256(str); });
    }
    return Promise.resolve(jsSha256(str));
  }
  function pinHash(pin) { return sha256(pin + ':' + SALT); }

  /* ── 잠금 ─────────────────────────────────────────────── */
  var pinBuffer = '', pinFails = 0, pinLockUntil = 0;

  function effectivePinHash() { return localStorage.getItem(LS.pin) || CFG.pin.hash || ''; }
  function paintDots() {
    $all('#pinDots span').forEach(function (s, i) { s.classList.toggle('on', i < pinBuffer.length); });
  }
  function pinMessage(msg) { $('#pinMsg').textContent = msg || ''; }
  function shakeDots() {
    var el = $('#pinDots');
    el.classList.add('shake');
    setTimeout(function () { el.classList.remove('shake'); }, 420);
  }
  function unlockApp() {
    sessionStorage.setItem(LS.unlocked, '1');
    $('#lockScreen').hidden = true;
    $('#app').hidden = false;
    pinBuffer = '';
    paintDots();
    pinMessage('');
    bootData();
  }
  function lockApp() {
    sessionStorage.removeItem(LS.unlocked);
    $('#app').hidden = true;
    $('#lockScreen').hidden = false;
    pinBuffer = '';
    paintDots();
    pinMessage('');
  }
  async function submitPin() {
    if (Date.now() < pinLockUntil) {
      pinMessage('잠시 후 다시 시도해 주세요 (' + Math.ceil((pinLockUntil - Date.now()) / 1000) + '초)');
      return;
    }
    var stored = effectivePinHash();
    if (!stored) { pinMessage('설정된 비밀번호가 없어요. config.js 의 pin.hash 를 채워 주세요.'); return; }
    var h = await pinHash(pinBuffer);
    var hFallback = jsSha256(pinBuffer + ':' + SALT);
    if (h === stored || hFallback === stored) { pinFails = 0; unlockApp(); return; }
    pinFails++;
    pinBuffer = '';
    paintDots();
    shakeDots();
    if (pinFails >= 5) {
      pinLockUntil = Date.now() + 30000;
      pinFails = 0;
      pinMessage('5번 틀렸어요. 30초 뒤에 다시 시도해 주세요.');
    } else {
      pinMessage('비밀번호가 맞지 않아요 (' + pinFails + '/5)');
    }
  }
  function onKeyPad(key) {
    if (key === 'back') pinBuffer = pinBuffer.slice(0, -1);
    else if (key === 'clear') pinBuffer = '';
    else if (/^[0-9]$/.test(key) && pinBuffer.length < DIGITS) pinBuffer += key;
    pinMessage('');
    paintDots();
    if (pinBuffer.length === DIGITS) setTimeout(submitPin, 120);
  }

  /* ── 데모 데이터 ───────────────────────────────────────── */
  function demoSeed() {
    var t = Date.now();
    var at = function (minAgo) { return new Date(t - minAgo * 60000).toISOString(); };
    var m = monthKey(new Date());
    var pmDate = new Date(); pmDate.setMonth(pmDate.getMonth() - 1);
    var pm = monthKey(pmDate);
    var d = 0, ds = function (offset) { var x = new Date(); x.setDate(x.getDate() - offset); return dateKey(x); };
    return {
      messages: [
        { id: uid(), room: 'office', sender: CFG.agents.owner, sender_role: 'assistant', content: '좋은 아침이에요, ' + CFG.family.owner + ' 님! 오늘 일정이랑 준비물 정리해 두었어요 ☀️', mentions: [], created_at: at(400) },
        { id: uid(), room: 'office', sender: CFG.agents.partner, sender_role: 'assistant_partner', content: '@' + CFG.agents.owner + ' 확인했어요. ' + CFG.family.partner + ' 님 오전 일정은 비워 두었습니다.', mentions: [CFG.agents.owner], created_at: at(396) },
        { id: uid(), room: 'office', sender: CFG.family.owner, sender_role: 'owner', content: '@' + CFG.agents.owner + ' 어린이집 준비물 목록 작업실에 올려줘', mentions: [CFG.agents.owner], created_at: at(352) },
        { id: uid(), room: 'office', sender: CFG.agents.owner, sender_role: 'assistant', content: '네, 작업실에 "준비물 챙기기" 카드로 올려 두었어요 ✅', mentions: [], created_at: at(350) },
        { id: uid(), room: 'office', sender: CFG.family.partner, sender_role: 'partner', content: '@' + CFG.agents.partner + ' 저녁 장보기 목록 공동 메모에 붙여줘', mentions: [CFG.agents.partner], created_at: at(230) },
        { id: uid(), room: 'office', sender: CFG.agents.partner, sender_role: 'assistant_partner', content: '장보기 메모에 6개 항목 붙였습니다. 예산은 4만원으로 잡았어요.', mentions: [], created_at: at(228) },
        { id: uid(), room: 'office', sender: CFG.agents.owner, sender_role: 'assistant', content: '@all 이번 달 가계부는 30만원대예요. 육아 지출 비중이 제일 커요.', mentions: ['all'], created_at: at(95) },
        { id: uid(), room: 'office', sender: CFG.agents.partner, sender_role: 'assistant_partner', content: '@' + CFG.agents.owner + ' 쾅이 이유식 기록 업데이트했어요. 새 재료는 천천히 시작하는 중입니다.', mentions: [CFG.agents.owner], created_at: at(48) }
      ],
      tasks: [
        { id: uid(), title: '어린이집 준비물 챙기기', assignee: CFG.agents.owner, status: '대기', category: '육아', created_at: at(350) },
        { id: uid(), title: '주말 장보기 목록 확정', assignee: CFG.agents.partner, status: '대기', category: '장보기', created_at: at(228) },
        { id: uid(), title: '다음 달 돌봄 일정 조정', assignee: CFG.agents.owner, status: '진행중', category: '일정', created_at: at(600) },
        { id: uid(), title: '이번 달 가계부 결산', assignee: '둘 다', status: '진행중', category: '기타', created_at: at(700) },
        { id: uid(), title: '겨울 내복 사이즈 확인', assignee: CFG.agents.partner, status: '완료', category: '육아', created_at: at(1500) },
        { id: uid(), title: '분유 재고 정리', assignee: CFG.agents.owner, status: '완료', category: '생활', created_at: at(1600) }
      ],
      ledger_entries: [
        { id: uid(), entry_date: m + '-05', title: '기저귀', amount: 32900, category: '육아', owner: CFG.family.owner, note: '팬티형', created_at: at(3000) },
        { id: uid(), entry_date: m + '-06', title: '이유식 재료', amount: 24500, category: '식비', owner: CFG.family.owner, note: '채소 · 단백질', created_at: at(2900) },
        { id: uid(), entry_date: m + '-09', title: '분유', amount: 41800, category: '육아', owner: CFG.family.partner, note: '', created_at: at(2500) },
        { id: uid(), entry_date: m + '-12', title: '생활용품', amount: 18300, category: '생활', owner: '공동', note: '세제 · 물티슈', created_at: at(2000) },
        { id: uid(), entry_date: m + '-15', title: '주유', amount: 60000, category: '교통', owner: CFG.family.partner, note: '', created_at: at(1500) },
        { id: uid(), entry_date: m + '-18', title: '병원 진료', amount: 12000, category: '의료', owner: CFG.family.owner, note: '', created_at: at(900) },
        { id: uid(), entry_date: m + '-21', title: '배달 음식', amount: 21000, category: '식비', owner: CFG.family.partner, note: '', created_at: at(300) },
        { id: uid(), entry_date: pm + '-11', title: '기저귀', amount: 35900, category: '육아', owner: CFG.family.owner, note: '', created_at: at(30000) },
        { id: uid(), entry_date: pm + '-20', title: '장보기', amount: 46800, category: '식비', owner: '공동', note: '', created_at: at(28000) }
      ],
      parenting_status: [
        { id: uid(), child_tag: '튼튼이', category: '이유식', title: '이유식 120ml 완식', detail: '새 재료 없이 익숙한 메뉴', status_date: ds(0), created_at: at(180) },
        { id: uid(), child_tag: '튼튼이', category: '수면', title: '낮잠 1시간 20분', detail: '', status_date: ds(0), created_at: at(300) },
        { id: uid(), child_tag: '쿵이', category: '이유식', title: '단호박 첫 시도', detail: '피부 반응 살피는 중 · 소량만', status_date: ds(0), created_at: at(210) },
        { id: uid(), child_tag: '쿵이', category: '일정', title: '오전 돌봄 선생님 방문', detail: '예정대로 진행', status_date: ds(0), created_at: at(420) },
        { id: uid(), child_tag: '쾅이', category: '수유', title: '분유 180ml', detail: '', status_date: ds(0), created_at: at(150) },
        { id: uid(), child_tag: '쾅이', category: '건강', title: '체온 36.7도', detail: '컨디션 좋음', status_date: ds(1), created_at: at(360) },
        { id: uid(), child_tag: '가족', category: '일정', title: '주말 가족 외출 준비', detail: '기저귀 · 여벌옷 · 간식', status_date: ds(1), created_at: at(520) }
      ],
      memos: [
        { id: uid(), title: '장보기', content: '우유 2통 · 바나나 · 아보카도 · 물티슈(국산)', author: CFG.family.partner, pinned: true, updated_at: at(230) },
        { id: uid(), title: '육아', content: '어린이집 여벌옷 2벌 챙기기 / 주말에 이유식 큐브 만들기', author: CFG.family.owner, pinned: false, updated_at: at(350) },
        { id: uid(), title: '생활', content: '현관 센서등 교체 알아보기 · 분리수거는 금요일 저녁', author: CFG.family.partner, pinned: false, updated_at: at(1200) },
        { id: uid(), title: '기타', content: '12월 가족사진 예약 알아보기', author: CFG.family.owner, pinned: false, updated_at: at(2000) }
      ],
      agents: [
        { id: 'buja', name: CFG.agents.owner, role: CFG.family.owner + ' 님 전담 비서', status: '작업중', current_task: '오피스 맵 · 작업실 카드 정리 중', updated_at: at(3) },
        { id: 'partner', name: CFG.agents.partner, role: CFG.family.partner + ' 님 전담 비서', status: '대기', current_task: '장보기 메모 반영 완료', updated_at: at(26) }
      ]
    };
  }

  var demoCache = null;
  function demoData() {
    if (demoCache) return demoCache;
    var raw = localStorage.getItem(LS.demo);
    if (raw) { try { demoCache = JSON.parse(raw); } catch (e) { demoCache = null; } }
    if (!demoCache || !demoCache.messages) { demoCache = demoSeed(); demoPersist(); }
    return demoCache;
  }
  function demoPersist() { try { localStorage.setItem(LS.demo, JSON.stringify(demoCache)); } catch (e) {} }
  function demoInsert(table, row) {
    var data = demoData();
    row.id = row.id || uid();
    if (data[table].length && data[table][0].created_at !== undefined && !row.created_at) row.created_at = nowIso();
    data[table].push(row);
    demoPersist();
    return row;
  }
  function demoUpdate(table, id, patch) {
    var data = demoData(), out = null;
    data[table] = data[table].map(function (r) {
      if (String(r.id) !== String(id)) return r;
      out = Object.assign({}, r, patch);
      return out;
    });
    demoPersist();
    return out;
  }
  function demoRemove(table, id) {
    var data = demoData();
    data[table] = data[table].filter(function (r) { return String(r.id) !== String(id); });
    demoPersist();
  }

  /* ── 저장소 ───────────────────────────────────────────── */
  function supaCfg() {
    var base = CFG.supabase || {}, saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS.supa) || '{}'); } catch (e) {}
    return {
      url: (saved.url != null && saved.url !== '') ? saved.url : base.url,
      anonKey: (saved.anonKey != null && saved.anonKey !== '') ? saved.anonKey : base.anonKey
    };
  }

  var db = {
    client: null,
    online: false,
    init: function () {
      var c = supaCfg();
      if (!c.url || !c.anonKey) return;
      if (!window.supabase || !window.supabase.createClient) { console.warn('[비서실] supabase-js 없음'); return; }
      try {
        this.client = window.supabase.createClient(c.url, c.anonKey);
        this.online = true;
      } catch (e) { console.warn('[비서실] Supabase 초기화 실패', e); }
    },
    list: async function (table) {
      if (!this.online) return normalize(table, demoData()[table].slice());
      var res = await this.client.from(table).select('*');
      if (res.error) throw res.error;
      return normalize(table, res.data || []);
    },
    insert: async function (table, row) {
      if (!this.online) return demoInsert(table, row);
      var res = await this.client.from(table).insert(row).select();
      if (res.error) throw res.error;
      return res.data && res.data[0];
    },
    update: async function (table, id, patch) {
      if (!this.online) return demoUpdate(table, id, patch);
      var res = await this.client.from(table).update(patch).eq('id', id).select();
      if (res.error) throw res.error;
      return res.data && res.data[0];
    },
    remove: async function (table, id) {
      if (!this.online) return demoRemove(table, id);
      var res = await this.client.from(table).delete().eq('id', id);
      if (res.error) throw res.error;
    },
    watch: function (table, cb) {
      if (!this.online) return;
      this.client.channel('po-' + table + '-' + Math.random().toString(36).slice(2, 7))
        .on('postgres_changes', { event: '*', schema: 'public', table: table }, cb)
        .subscribe();
    }
  };

  function normalize(table, list) {
    return (list || []).map(function (r) {
      var o = Object.assign({}, r);
      if (o.id != null) o.id = String(o.id);
      if (table === 'tasks' && STATUS_ALIAS[o.status]) o.status = STATUS_ALIAS[o.status];
      if (table === 'agents') {
        if (AGENT_STATUS_ALIAS[o.status]) o.status = AGENT_STATUS_ALIAS[o.status];
        if (o.status !== '작업중') o.status = o.status || '대기';
      }
      return o;
    });
  }

  /* ── 상태 ─────────────────────────────────────────────── */
  var state = {
    tab: 'map',
    me: localStorage.getItem(LS.me) || 'owner',
    chatFilter: 'all',
    data: {},
    booted: false,
    connError: null,
    warned: false,
    ledgerMonth: monthKey(new Date()),
    seenChat: Number(localStorage.getItem(LS.seenChat) || 0)
  };

  function myName() { return state.me === 'partner' ? CFG.family.partner : CFG.family.owner; }
  function myRole() { return state.me === 'partner' ? 'partner' : 'owner'; }
  function agentIdFor(name) { return name === CFG.agents.partner ? 'partner' : 'buja'; }

  /* ── 로드 ─────────────────────────────────────────────── */
  async function loadAll() {
    var results = await Promise.all(TABLES.map(function (t) {
      return db.list(t).then(function (d) { return { t: t, d: d }; })
        .catch(function (e) { return { t: t, d: null, e: e }; });
    }));
    var fallback = demoSeed(), err = null;
    results.forEach(function (r) {
      if (r.d) state.data[r.t] = r.d;
      else { state.data[r.t] = fallback[r.t]; err = err || r.e; }
    });
    state.connError = err;
    if (err) {
      console.warn('[비서실] 읽기 실패', err);
      if (db.online && !state.warned) {
        state.warned = true;
        toast('Supabase 테이블을 읽지 못했어요. schema.sql 실행 여부를 확인해 주세요.');
      }
    }
    renderAll();
    setConnPill();
  }

  async function reload(table) {
    try { state.data[table] = await db.list(table); }
    catch (e) { console.warn('[비서실] 다시 읽기 실패', table, e); return; }
    renderAll();
  }

  function rows(table) { return Array.isArray(state.data[table]) ? state.data[table] : []; }
  function sortBy(list, key, desc) {
    return list.slice().sort(function (a, b) {
      var va = new Date(a[key] || 0), vb = new Date(b[key] || 0);
      return desc ? vb - va : va - vb;
    });
  }

  /* ── 연결 표시 ─────────────────────────────────────────── */
  function setConnPill() {
    var pill = $('#connPill'), text = $('#connText');
    pill.classList.remove('online', 'error');
    if (db.online && !state.connError) { pill.classList.add('online'); text.textContent = '실시간 연결'; }
    else if (db.online && state.connError) { pill.classList.add('error'); text.textContent = '연결 오류'; }
    else { text.textContent = '데모 모드'; }
    var foot = $('#footConn');
    if (foot) foot.textContent = db.online ? 'Supabase 실시간' : '데모 모드 · 이 브라우저에만 저장';
    renderConnDetail();
  }
  function renderConnDetail() {
    var el = $('#connDetail');
    if (!el) return;
    var c = supaCfg(), lines = [];
    if (db.online && !state.connError) {
      lines.push('✅ <b>Supabase 실시간 연결됨</b><br><code>' + esc((c.url || '').replace(/^https?:\/\//, '')) + '</code>');
      lines.push('메시지 · 할 일 · 가계부 · 육아현황 · 메모가 두 분 기기에서 실시간으로 함께 보여요.');
    } else if (db.online) {
      lines.push('⚠️ 연결은 됐지만 테이블을 읽지 못했어요.');
      lines.push('Supabase SQL Editor 에서 <code>schema.sql</code> 을 실행했는지 확인해 주세요.');
      lines.push('지금은 예시 데이터를 보여 주고 있습니다.');
    } else {
      lines.push('🧪 <b>데모 모드</b> — 지금은 이 브라우저에만 저장돼요.');
      lines.push('⚙ 설정에서 Supabase URL 과 anon key 를 넣으면 두 분이 실시간으로 함께 씁니다.');
      lines.push('먼저 Supabase에서 <code>schema.sql</code> 을 실행해 주세요.');
    }
    el.innerHTML = lines.map(function (l) { return '<p style="margin:0 0 7px">' + l + '</p>'; }).join('');
  }

  /* ── 오피스 맵 ─────────────────────────────────────────── */
  function agentOf(name) {
    var list = rows('agents'), id = agentIdFor(name);
    var byId = list.filter(function (a) { return a.id === id; })[0];
    if (byId) return byId;
    return list.filter(function (a) { return a.name === name; })[0] || null;
  }
  function avatarHtml(name) {
    var mint = name === CFG.agents.partner;
    return '<span class="avatar' + (mint ? ' mint' : '') + '" aria-hidden="true">' +
      '<i class="ear l"></i><i class="ear r"></i><i class="body"></i></span>';
  }
  function agentCardHtml(a, withControls) {
    var working = a.status === '작업중';
    var html = '<div class="card"><div class="agent-card">' + avatarHtml(a.name) +
      '<div class="agent-meta">' +
      '<div class="agent-name">' + esc(a.name) +
      '<span class="status-pill ' + (working ? 'working' : 'idle') + '">' + esc(a.status || '대기') + '</span></div>' +
      '<div class="agent-role">' + esc(a.role || '') + '</div>' +
      '<div class="agent-line">' + (a.current_task ? esc(a.current_task) : '지금 맡은 일은 없어요') + '</div>' +
      '<div class="agent-line" style="color:var(--ink-3);font-size:11.5px">최근 활동 · ' + esc(relTime(a.updated_at)) + '</div>';
    if (withControls) {
      html += '<div class="form-row" style="margin-top:10px">' +
        '<button class="chip" type="button" data-agent-status="' + esc(a.id) + '" data-status="대기">대기로</button>' +
        '<button class="chip" type="button" data-agent-status="' + esc(a.id) + '" data-status="작업중">작업중으로</button>' +
        '</div>' +
        '<input class="wide-input" type="text" maxlength="80" placeholder="지금 하는 일 (Enter 로 저장)" ' +
        'data-agent-task="' + esc(a.id) + '" value="' + esc(a.current_task || '') + '" />';
    }
    return html + '</div></div></div>';
  }
  function renderMap() {
    var agents = [CFG.agents.owner, CFG.agents.partner].map(agentOf);
    var positions = [{ left: 33, top: 43 }, { left: 68, top: 43 }];
    $('#mapPeople').innerHTML = agents.map(function (a, i) {
      if (!a) return '';
      return '<span class="person-chip' + (a.status === '작업중' ? ' busy' : '') + '" style="left:' + positions[i].left + '%;top:' + positions[i].top + '%">' +
        '<i class="p-dot"></i>' + esc(a.name) + ' · ' + esc(a.status || '대기') + '</span>';
    }).join('');

    var tasks = rows('tasks');
    var doing = tasks.filter(function (t) { return t.status === '진행중'; }).length;
    var todo = tasks.filter(function (t) { return (t.status || '대기') === '대기'; }).length;
    var monthTotal = rows('ledger_entries').filter(function (e) { return (e.entry_date || '').slice(0, 7) === monthKey(new Date()); })
      .reduce(function (s, e) { return s + Number(e.amount || 0); }, 0);
    var todayCare = rows('parenting_status').filter(function (p) { return p.status_date === dateKey(new Date()); }).length;

    $('#mapSummary').innerHTML =
      '<div class="sum-card"><span>대기 중인 일</span><b>' + todo + '개</b></div>' +
      '<div class="sum-card"><span>진행 중인 일</span><b>' + doing + '개</b></div>' +
      '<div class="sum-card"><span>이번 달 지출</span><b>' + won(monthTotal) + '</b></div>' +
      '<div class="sum-card"><span>오늘 육아 기록</span><b>' + (todayCare ? todayCare + '건' : '아직 없음') + '</b></div>';

    $('#mapCards').innerHTML = agents.map(function (a) { return a ? agentCardHtml(a, false) : ''; }).join('');
  }

  /* ── 회의실 ───────────────────────────────────────────── */
  function renderChat() {
    var log = $('#chatLog');
    var list = sortBy(rows('messages'), 'created_at', false);
    var filter = state.chatFilter;
    if (filter === 'buja') list = list.filter(function (m) { return (m.mentions || []).indexOf(CFG.agents.owner) !== -1; });
    if (filter === 'partner') list = list.filter(function (m) { return (m.mentions || []).indexOf(CFG.agents.partner) !== -1; });
    if (filter === 'any') list = list.filter(function (m) { return (m.mentions || []).length > 0; });

    if (!list.length) {
      log.innerHTML = '<div class="msg empty">' +
        (filter === 'all' ? '아직 메시지가 없어요.<br>@부자 · @찬범비서 · @all 로 말을 걸어 보세요.' : '조건에 맞는 메시지가 없어요.') +
        '</div>';
      return;
    }
    var html = '', lastDay = '';
    list.forEach(function (m) {
      var dk = dateKey(m.created_at);
      if (dk !== lastDay) { html += '<div class="chat-day">' + esc(fmtDateLabel(m.created_at)) + '</div>'; lastDay = dk; }
      var role = m.sender_role || roleOf(m.sender);
      var cls = 'msg';
      if ((role === 'owner' && state.me === 'owner') || (role === 'partner' && state.me === 'partner')) cls += ' mine';
      else if (role === 'assistant') cls += ' agent';
      else if (role === 'assistant_partner') cls += ' partner-agent';
      html += '<div class="' + cls + '">' +
        '<span class="who">' + esc(m.sender) + '</span>' +
        '<div class="bubble">' + highlightMentions(m.content || '') + '</div>' +
        '<span class="time">' + esc(fmtTime(m.created_at)) + '</span>' +
        '</div>';
    });
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
  }
  function chatUnreadCount() {
    return rows('messages').filter(function (m) {
      return m.sender_role !== myRole() && m.sender !== myName() && new Date(m.created_at).getTime() > state.seenChat;
    }).length;
  }

  /* ── 작업실 ───────────────────────────────────────────── */
  function tagClass(assignee) {
    if (assignee === CFG.agents.owner) return 'buja';
    if (assignee === CFG.agents.partner) return 'partner';
    if (assignee === '둘 다') return 'both';
    return '';
  }
  function renderTasks() {
    var tasks = sortBy(rows('tasks'), 'created_at', true);
    $('#kanban').innerHTML = TASK_COLUMNS.map(function (col, ci) {
      var items = tasks.filter(function (t) { return (t.status || '대기') === col; });
      var head = ['⏳ ', '🛠️ ', '✅ '][ci] + col;
      return '<div class="kanban-col">' +
        '<div class="kcol-head"><h3>' + head + '</h3><span class="count-badge">' + items.length + '</span></div>' +
        (items.length ? items.map(function (t) {
          return '<div class="task-card' + (t.status === '완료' ? ' done' : '') + '">' +
            '<div class="t-title">' + esc(t.title) + '</div>' +
            '<div class="t-foot"><div class="t-tags">' +
            '<span class="tag ' + tagClass(t.assignee) + '">' + esc(t.assignee || '미정') + '</span>' +
            (t.category ? '<span class="tag">' + esc(t.category) + '</span>' : '') +
            '</div><div class="t-actions">' +
            (ci > 0 ? '<button class="t-btn" type="button" data-task-move="' + esc(t.id) + '" data-dir="-1" aria-label="이전 단계">←</button>' : '') +
            (ci < TASK_COLUMNS.length - 1 ? '<button class="t-btn" type="button" data-task-move="' + esc(t.id) + '" data-dir="1" aria-label="다음 단계">→</button>' : '') +
            '<button class="t-btn" type="button" data-task-del="' + esc(t.id) + '" aria-label="삭제">✕</button>' +
            '</div></div></div>';
        }).join('') : '<div class="empty-col">' + (ci === 0 ? '대기 중인 일이 없어요.' : ci === 1 ? '진행중인 일이 없어요.' : '완료된 일이 없어요.') + '</div>') +
        '</div>';
    }).join('');
  }

  /* ── 가계부 ───────────────────────────────────────────── */
  function renderLedger() {
    var month = state.ledgerMonth;
    var monthRows = sortBy(rows('ledger_entries').filter(function (e) { return (e.entry_date || '').slice(0, 7) === month; }), 'entry_date', true);
    var total = monthRows.reduce(function (s, e) { return s + Number(e.amount || 0); }, 0);
    var byOwner = {};
    monthRows.forEach(function (e) { var k = e.owner || '기타'; byOwner[k] = (byOwner[k] || 0) + Number(e.amount || 0); });

    $('#ledgerStats').innerHTML =
      '<div class="stat"><span>이 달 합계</span><b>' + won(total) + '</b></div>' +
      '<div class="stat"><span>' + esc(CFG.family.owner) + ' 님</span><b>' + won(byOwner[CFG.family.owner] || 0) + '</b></div>' +
      '<div class="stat"><span>' + esc(CFG.family.partner) + ' 님</span><b>' + won(byOwner[CFG.family.partner] || 0) + '</b></div>' +
      '<div class="stat"><span>공동</span><b>' + won(byOwner['공동'] || 0) + '</b></div>';

    var cats = {};
    monthRows.forEach(function (e) { var k = e.category || '기타'; cats[k] = (cats[k] || 0) + Number(e.amount || 0); });
    var catKeys = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    var max = catKeys.length ? cats[catKeys[0]] : 0;
    $('#ledgerCats').innerHTML = catKeys.length ? catKeys.map(function (k) {
      var pct = max ? Math.round(cats[k] / max * 100) : 0;
      return '<div class="cat-row"><span>' + esc(k) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><b>' + won(cats[k]) + '</b></div>';
    }).join('') : '<div class="empty">이 달에 기록된 지출이 없어요.</div>';

    $('#ledgerList').innerHTML = monthRows.length ? monthRows.map(function (e) {
      return '<div class="led-row">' +
        '<span class="led-date">' + esc((e.entry_date || '').slice(5).replace('-', '/')) + '</span>' +
        '<span class="led-item">' + esc(e.title) + (e.note ? ' <span style="color:var(--ink-3);font-size:11px">· ' + esc(e.note) + '</span>' : '') + '</span>' +
        '<span class="tag">' + esc(e.category || '기타') + '</span>' +
        '<span class="led-amt">' + won(e.amount) + '</span>' +
        '<button class="t-btn" type="button" data-ledger-del="' + esc(e.id) + '" aria-label="삭제">✕</button>' +
        '</div>';
    }).join('') : '<div class="empty">아직 지출 기록이 없어요. 위에서 첫 기록을 남겨 보세요.</div>';
  }

  /* ── 육아현황 ─────────────────────────────────────────── */
  var KID_ORDER = [
    { name: '튼튼이', emoji: '🌱', cls: '' },
    { name: '쿵이', emoji: '🍀', cls: 'k2' },
    { name: '쾅이', emoji: '⭐', cls: 'k3' },
    { name: '가족', emoji: '🏠', cls: 'k4' }
  ];
  function renderParenting() {
    var list = rows('parenting_status').slice().sort(function (a, b) {
      var da = (a.status_date || '') + ' ' + (a.created_at || '');
      var db2 = (b.status_date || '') + ' ' + (b.created_at || '');
      return db2 > da ? 1 : db2 < da ? -1 : 0;
    });
    var names = KID_ORDER.map(function (k) { return k.name; });
    list.forEach(function (p) { if (names.indexOf(p.child_tag) === -1 && p.child_tag) names.push(p.child_tag); });

    $('#kidGrid').innerHTML = names.map(function (name) {
      var meta = KID_ORDER.filter(function (k) { return k.name === name; })[0] || { emoji: '🐣', cls: '' };
      var items = list.filter(function (p) { return p.child_tag === name; });
      var latest = items[0];
      return '<div class="kid-card">' +
        '<div class="kid-head"><span class="kid-emoji ' + meta.cls + '">' + meta.emoji + '</span>' +
        '<div><h3>' + esc(name) + '</h3><small>' + (latest ? '최근 기록 ' + esc(latest.status_date === dateKey(new Date()) ? '오늘' : fmtDay(latest.status_date)) + ' · ' + items.length + '건' : '기록 없음') + '</small></div></div>' +
        (items.length ? items.slice(0, 6).map(function (p) {
          var isToday = p.status_date === dateKey(new Date());
          return '<div class="kid-item">' +
            '<span class="kid-cat">' + esc(p.category) + '</span>' +
            '<div class="kid-body"><div class="kid-title">' + esc(p.title) + '</div>' +
            (p.detail ? '<div class="kid-detail">' + esc(p.detail) + '</div>' : '') +
            '<div class="kid-meta">' + esc(fmtDay(p.status_date)) + (isToday ? ' (오늘)' : '') + '</div></div></div>';
        }).join('') : '<div class="empty" style="padding:14px 4px">아직 기록이 없어요.</div>') +
        '</div>';
    }).join('');
  }

  /* ── 공동 메모 ────────────────────────────────────────── */
  function renderMemos() {
    var list = rows('memos').slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
    $('#memoBoard').innerHTML = list.length ? list.map(function (m) {
      return '<div class="memo-card' + (m.pinned ? ' pinned' : '') + '">' +
        '<div class="memo-head"><b>' + esc(m.title) + '</b>' +
        '<div class="memo-tools">' +
        '<button class="memo-pin' + (m.pinned ? '' : ' off') + '" type="button" data-memo-pin="' + esc(m.id) + '" aria-label="고정">📌</button>' +
        '<button class="memo-del" type="button" data-memo-del="' + esc(m.id) + '" aria-label="삭제">✕</button>' +
        '</div></div>' +
        (m.content ? '<div class="memo-content">' + esc(m.content) + '</div>' : '') +
        '<div class="memo-foot">' + esc(m.author || '') + ' · ' + esc(relTime(m.updated_at)) + '</div>' +
        '</div>';
    }).join('') : '<div class="empty">아직 메모가 없어요. 장보기·육아·생활 메모를 붙여 보세요.</div>';
  }

  /* ── 비서현황 ─────────────────────────────────────────── */
  function renderAgents() {
    var names = [CFG.agents.owner, CFG.agents.partner];
    $('#agentGrid').innerHTML = names.map(function (n) {
      var a = agentOf(n) || {
        id: agentIdFor(n), name: n, role: '', status: '대기', current_task: '', updated_at: nowIso()
      };
      return agentCardHtml(a, true);
    }).join('');
  }

  /* ── 전체 렌더 ─────────────────────────────────────────── */
  function renderAll() {
    if (!state.booted) return;
    renderMap(); renderChat(); renderTasks(); renderLedger(); renderParenting(); renderMemos(); renderAgents();
    setConnPill();
    updateBadges();
  }
  function updateBadges() {
    var unread = chatUnreadCount();
    var bChat = $('#badgeChat');
    bChat.hidden = unread <= 0;
    bChat.textContent = unread > 9 ? '9+' : unread;
    var todo = rows('tasks').filter(function (t) { return (t.status || '대기') === '대기'; }).length;
    var bTasks = $('#badgeTasks');
    bTasks.hidden = todo <= 0;
    bTasks.textContent = todo;
  }

  function switchTab(tab) {
    state.tab = tab;
    $all('.tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === tab); });
    $all('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + tab); });
    if (tab === 'chat') {
      state.seenChat = Date.now();
      localStorage.setItem(LS.seenChat, String(state.seenChat));
      setTimeout(function () {
        var log = $('#chatLog');
        log.scrollTop = log.scrollHeight;
        if (window.matchMedia('(min-width:760px)').matches) $('#chatInput').focus();
      }, 40);
    }
    updateBadges();
  }

  /* ── 동작들 ───────────────────────────────────────────── */
  async function sendChat() {
    var input = $('#chatInput');
    var body = input.value.trim();
    if (!body) return;
    var btn = $('#chatForm button[type=submit]');
    btn.disabled = true;
    try {
      await db.insert('messages', {
        room: 'office',
        sender: myName(),
        sender_role: myRole(),
        content: body,
        mentions: parseMentions(body)
      });
      input.value = '';
      input.style.height = 'auto';
      state.seenChat = Date.now();
      localStorage.setItem(LS.seenChat, String(state.seenChat));
      await reload('messages');
      switchTab('chat');
    } catch (e) {
      console.error(e);
      toast('메시지를 보내지 못했어요. 연결 상태를 확인해 주세요.');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  async function addTask(ev) {
    ev.preventDefault();
    var title = $('#taskTitle').value.trim();
    if (!title) return;
    try {
      await db.insert('tasks', {
        title: title,
        assignee: $('#taskAssignee').value,
        status: '대기',
        category: $('#taskCategory').value
      });
      $('#taskTitle').value = '';
      await reload('tasks');
      toast('작업 카드를 추가했어요.');
    } catch (e) { console.error(e); toast('카드를 추가하지 못했어요.'); }
  }
  async function moveTask(id, dir) {
    var t = rows('tasks').filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var idx = TASK_COLUMNS.indexOf(t.status || '대기');
    var next = TASK_COLUMNS[Math.max(0, Math.min(TASK_COLUMNS.length - 1, idx + Number(dir)))];
    try { await db.update('tasks', id, { status: next }); await reload('tasks'); }
    catch (e) { console.error(e); toast('상태를 바꾸지 못했어요.'); }
  }
  async function delTask(id) {
    try { await db.remove('tasks', id); await reload('tasks'); }
    catch (e) { console.error(e); toast('삭제하지 못했어요.'); }
  }

  async function addLedger(ev) {
    ev.preventDefault();
    var title = $('#ledgerItem').value.trim();
    var amount = Number($('#ledgerAmount').value);
    var date = $('#ledgerDate').value;
    if (!title || !amount || !date) return;
    try {
      await db.insert('ledger_entries', {
        entry_date: date,
        title: title,
        amount: amount,
        category: $('#ledgerCategory').value,
        owner: $('#ledgerPayer').value,
        note: $('#ledgerNote').value.trim()
      });
      $('#ledgerItem').value = '';
      $('#ledgerAmount').value = '';
      $('#ledgerNote').value = '';
      state.ledgerMonth = date.slice(0, 7);
      $('#ledgerMonth').value = state.ledgerMonth;
      await reload('ledger_entries');
      toast('가계부에 기록했어요.');
    } catch (e) { console.error(e); toast('기록하지 못했어요.'); }
  }
  async function delLedger(id) {
    try { await db.remove('ledger_entries', id); await reload('ledger_entries'); }
    catch (e) { console.error(e); toast('삭제하지 못했어요.'); }
  }

  async function addParenting(ev) {
    ev.preventDefault();
    var title = $('#parentingTitle').value.trim();
    if (!title) return;
    try {
      await db.insert('parenting_status', {
        child_tag: $('#parentingSubject').value,
        category: $('#parentingCategory').value,
        title: title,
        detail: $('#parentingDetail').value.trim(),
        status_date: $('#parentingDate').value || dateKey(new Date())
      });
      $('#parentingTitle').value = '';
      $('#parentingDetail').value = '';
      await reload('parenting_status');
      toast('육아 기록을 남겼어요.');
    } catch (e) { console.error(e); toast('기록하지 못했어요.'); }
  }

  async function addMemo(ev) {
    ev.preventDefault();
    var title = $('#memoTitle').value.trim();
    if (!title) return;
    try {
      await db.insert('memos', {
        title: title,
        content: $('#memoBody').value.trim(),
        author: myName(),
        pinned: false
      });
      $('#memoTitle').value = '';
      $('#memoBody').value = '';
      await reload('memos');
    } catch (e) { console.error(e); toast('메모를 붙이지 못했어요.'); }
  }
  async function togglePin(id, pinned) {
    try { await db.update('memos', id, { pinned: pinned, updated_at: nowIso() }); await reload('memos'); }
    catch (e) { console.error(e); }
  }
  async function delMemo(id) {
    try { await db.remove('memos', id); await reload('memos'); }
    catch (e) { console.error(e); }
  }

  async function setAgentStatus(id, status) {
    try { await db.update('agents', id, { status: status, updated_at: nowIso() }); await reload('agents'); await reload('messages'); }
    catch (e) { console.error(e); toast('상태를 바꾸지 못했어요.'); }
  }
  async function setAgentTask(id, task) {
    try { await db.update('agents', id, { current_task: task, updated_at: nowIso() }); await reload('agents'); }
    catch (e) { console.error(e); toast('저장하지 못했어요.'); }
  }

  /* ── 설정 ─────────────────────────────────────────────── */
  function openSettings() {
    var c = supaCfg();
    $('#supaUrl').value = c.url || '';
    $('#supaKey').value = c.anonKey || '';
    $('#pinHint').textContent = '현재 PIN은 config.js 기본값 또는 이 브라우저에서 바꾼 값입니다.';
    $('#settingsModal').hidden = false;
  }
  function closeSettings() { $('#settingsModal').hidden = true; }

  async function changePin() {
    var cur = $('#pinCurrent').value.trim();
    var n1 = $('#pinNew').value.trim(), n2 = $('#pinNew2').value.trim();
    if (!/^\d{4}$/.test(n1)) return toast('새 PIN은 숫자 4자리로 정해 주세요.');
    if (n1 !== n2) return toast('새 PIN 두 개가 서로 달라요.');
    var curHash = await pinHash(cur);
    if (curHash !== effectivePinHash()) return toast('현재 PIN이 맞지 않아요.');
    var h = await pinHash(n1);
    localStorage.setItem(LS.pin, h);
    $('#pinCurrent').value = ''; $('#pinNew').value = ''; $('#pinNew2').value = '';
    $('#pinHint').textContent = '이 브라우저에 저장했어요. 두 분이 함께 쓰려면 config.js 의 pin.hash 에 아래 값을 넣고 다시 배포하세요: ' + h;
    toast('비밀번호를 바꿨어요.');
  }
  function saveSupa() {
    var url = $('#supaUrl').value.trim().replace(/\/+$/, '');
    var key = $('#supaKey').value.trim();
    if (!url || !key) return toast('URL과 anon key를 모두 넣어 주세요.');
    if (!/^https:\/\/.+\.supabase\.co$/.test(url)) return toast('URL 형식을 확인해 주세요 (https://xxxx.supabase.co).');
    localStorage.setItem(LS.supa, JSON.stringify({ url: url, anonKey: key }));
    toast('저장했어요. 새로고침합니다.');
    setTimeout(function () { location.reload(); }, 700);
  }
  function clearSupa() {
    localStorage.removeItem(LS.supa);
    toast('연결을 해제했어요. 새로고침합니다.');
    setTimeout(function () { location.reload(); }, 700);
  }
  function resetDemo() {
    if (db.online) return toast('Supabase 연결 중에는 예시 데이터를 초기화하지 않아요.');
    localStorage.removeItem(LS.demo);
    demoCache = null;
    toast('예시 데이터를 초기화했어요.');
    setTimeout(function () { location.reload(); }, 600);
  }

  /* ── 이벤트 ───────────────────────────────────────────── */
  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(130, el.scrollHeight) + 'px';
  }

  function bindEvents() {
    $('#keypad').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-key]');
      if (btn) onKeyPad(btn.dataset.key);
    });
    document.addEventListener('keydown', function (e) {
      if ($('#lockScreen').hidden) return;
      if (/^[0-9]$/.test(e.key)) onKeyPad(e.key);
      else if (e.key === 'Backspace') onKeyPad('back');
      else if (e.key === 'Escape') onKeyPad('clear');
    });

    $('#tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (b) switchTab(b.dataset.tab);
    });
    $('#btnLock').addEventListener('click', lockApp);
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnOpenSettings').addEventListener('click', openSettings);
    $('#btnCloseSettings').addEventListener('click', closeSettings);
    $('#settingsModal').addEventListener('click', function (e) { if (e.target.id === 'settingsModal') closeSettings(); });
    $('#btnChangePin').addEventListener('click', changePin);
    $('#btnSaveSupa').addEventListener('click', saveSupa);
    $('#btnClearSupa').addEventListener('click', clearSupa);
    $('#btnResetDemo').addEventListener('click', resetDemo);

    $('#chatFilter').addEventListener('change', function (e) { state.chatFilter = e.target.value; renderChat(); });
    $all('.chip[data-mention]').forEach(function (b) {
      b.addEventListener('click', function () {
        var input = $('#chatInput');
        var mention = b.dataset.mention + ' ';
        var start = input.selectionStart != null ? input.selectionStart : input.value.length;
        input.value = input.value.slice(0, start) + mention + input.value.slice(start);
        input.focus();
        input.selectionStart = input.selectionEnd = start + mention.length;
        autoGrow(input);
      });
    });
    $('#chatForm').addEventListener('submit', function (e) { e.preventDefault(); sendChat(); });
    var chatInput = $('#chatInput');
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
    });
    chatInput.addEventListener('input', function () { autoGrow(chatInput); });

    $('#taskForm').addEventListener('submit', addTask);
    $('#kanban').addEventListener('click', function (e) {
      var mv = e.target.closest('[data-task-move]');
      if (mv) return moveTask(mv.dataset.taskMove, mv.dataset.dir);
      var del = e.target.closest('[data-task-del]');
      if (del) return delTask(del.dataset.taskDel);
    });

    $('#ledgerForm').addEventListener('submit', addLedger);
    $('#ledgerMonth').addEventListener('change', function (e) {
      state.ledgerMonth = e.target.value || monthKey(new Date());
      renderLedger();
    });
    $('#ledgerList').addEventListener('click', function (e) {
      var del = e.target.closest('[data-ledger-del]');
      if (del) delLedger(del.dataset.ledgerDel);
    });

    $('#parentingForm').addEventListener('submit', addParenting);

    $('#memoForm').addEventListener('submit', addMemo);
    $('#memoBoard').addEventListener('click', function (e) {
      var pin = e.target.closest('[data-memo-pin]');
      if (pin) {
        var m = rows('memos').filter(function (x) { return x.id === pin.dataset.memoPin; })[0];
        if (m) togglePin(m.id, !m.pinned);
        return;
      }
      var del = e.target.closest('[data-memo-del]');
      if (del) delMemo(del.dataset.memoDel);
    });

    $('#agentGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-agent-status]');
      if (b) setAgentStatus(b.dataset.agentStatus, b.dataset.status);
    });
    $('#agentGrid').addEventListener('change', function (e) {
      var inp = e.target.closest('[data-agent-task]');
      if (inp) setAgentTask(inp.dataset.agentTask, inp.value.trim());
    });
    $('#agentGrid').addEventListener('keydown', function (e) {
      var inp = e.target.closest('[data-agent-task]');
      if (inp && e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    });

    var asSel = $('#chatAs');
    asSel.value = myName();
    asSel.addEventListener('change', function (e) {
      state.me = e.target.value === CFG.family.partner ? 'partner' : 'owner';
      localStorage.setItem(LS.me, state.me);
      renderAll();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.booted) updateBadges();
    });
  }

  /* ── 부트 ─────────────────────────────────────────────── */
  async function bootData() {
    if (state.booted) { await loadAll(); return; }
    state.booted = true;

    $('#officeName').textContent = CFG.officeName;
    $('#ledgerMonth').value = state.ledgerMonth;
    $('#ledgerDate').value = dateKey(new Date());
    $('#parentingDate').value = dateKey(new Date());
    $('#chatAs').value = myName();

    db.init();
    setConnPill();
    await loadAll();

    TABLES.forEach(function (t) { db.watch(t, function () { reload(t); }); });
  }

  function init() {
    bindEvents();
    paintDots();
    if (!effectivePinHash()) pinMessage('config.js 의 pin.hash 값이 비어 있어요.');
    if (sessionStorage.getItem(LS.unlocked) === '1') {
      $('#lockScreen').hidden = true;
      $('#app').hidden = false;
      bootData();
    }
    var h = (location.hash || '').replace('#', '');
    if (['map', 'chat', 'tasks', 'ledger', 'parenting', 'memos', 'agents'].indexOf(h) !== -1) {
      setTimeout(function () { if (!$('#app').hidden) switchTab(h); }, 350);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.OfficeApp = { state: state, db: db, reload: reload, loadAll: loadAll, sha256: sha256, jsSha256: jsSha256 };
})();
