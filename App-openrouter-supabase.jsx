import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { LearningTracker, attachUnloadFlush } from "./analytics.js";
import TeacherDashboard from "./TeacherDashboard.jsx";
import { saveResult, supabaseReady, fetchResultsForTeacher } from "./supabaseClient.js";

/* ────────────────────────────────────────────────────────────
   다섯 사람의 눈  ·  통크한테 알려주기
   통합사회2 Ⅱ-2「자유주의와 공동체주의 정의관」
   1단계 사상가 이론으로 사례 설명 → 2단계 충돌 지점 → 3단계 나의 기준

   AI  : OpenRouter (anthropic/claude-3.5-sonnet)
   DB  : Supabase   (five_eyes_results)
   배포 : Vercel     (/api/chat, /api/results 서버리스 함수)
   ──────────────────────────────────────────────────────────── */

/* ── AI 호출 설정 ──────────────────────────────────────────────
   이 파일에는 API 키가 존재하지 않는다.

   브라우저 → /api/chat → OpenRouter
              (키 없음)   (키는 서버 환경변수에만)

   Vite 는 VITE_ 접두사가 붙은 값을 빌드 결과물에 그대로 박아 넣는다.
   따라서 API 키를 VITE_ 로 노출하는 경로는 아예 두지 않는다.
   모델 이름만 클라이언트가 지정할 수 있고, 실제 호출과 인증은
   서버리스 함수(api/chat.js)가 전담한다. */
const CHAT_API = "/api/chat";
const OPENROUTER_MODEL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_OPENROUTER_MODEL) ||
  "anthropic/claude-3.5-sonnet";

/* 학습분석 원자료 전송 경로(선택). 서버 함수를 경유하므로 키가 없다. */
const SHEET_ENDPOINT = "";

const THINKERS = [
  {
    id: "rawls",
    name: "롤스",
    josa: "는",
    school: "lib",
    need: 1,
    tag: "평등주의적 자유주의",
    concepts: [
      "평등주의적 자유주의",
      "원초적 입장",
      "무지의 베일",
      "공정으로서의 정의",
      "평등한 자유의 원칙",
      "차등의 원칙",
      "기회균등의 원칙",
      "국가의 역할 인정",
    ],
  },
  {
    id: "nozick",
    name: "노직",
    josa: "은",
    school: "lib",
    need: 1,
    tag: "자유 지상주의",
    concepts: [
      "자유 지상주의",
      "배타적 소유 권리 보장",
      "최소 국가",
      "소유 권리로서의 정의",
      "재분배 정책 반대",
      "취득의 원칙",
      "이전의 원칙",
      "교정의 원칙",
    ],
  },
  { id: "macintyre", name: "매킨타이어", josa: "는", school: "com", need: 1, tag: "전통과 덕", concepts: ["서사적 자아"] },
  { id: "sandel", name: "샌델", josa: "은", school: "com", need: 1, tag: "공동선", concepts: ["연고적 자아"] },
  { id: "walzer", name: "왈처", josa: "는", school: "com", need: 1, tag: "다원적 평등", concepts: ["복합 평등으로서의 정의"] },
];

const T = (id) => THINKERS.find((t) => t.id === id);

/* fit  = 이 사례에 실제로 적용되는 사상가 (사례 배치에 사용)
   cand = 학생에게 보여 줄 선택지. 안 맞는 사람도 섞여 있고, 고르면 통크가 되묻는다 */
const CASES = [
  {
    id: "rule", tag: "학교", title: "규칙을 언제 정할까",
    text: "동아리 부장을 뽑기로 했다. 한쪽은 \u201c후보가 누군지 다 알고 나서 규칙을 정하자\u201d고 하고, 다른 쪽은 \u201c누가 나올지 아무도 모를 때 규칙부터 정하자\u201d고 한다.",
    point: "규칙을 정하는 시점이 공정성을 바꿀까?",
    a: "후보를 다 알고 나서 규칙을 정하자", b: "누가 나올지 모를 때 규칙부터 정하자",
    fit: ["rawls"], cand: ["rawls", "nozick", "sandel"],
  },
  {
    id: "scholar", tag: "학교", title: "장학금 한 자리",
    text: "장학금 한 자리를 두고 학교가 고민한다. \u201c성적 1등에게 주자\u201d와 \u201c이 돈이 없으면 학교를 못 다니는 학생에게 주자\u201d가 맞선다.",
    point: "똑같이 안 나누는 게 정당해지는 조건은 뭘까?",
    a: "성적 1등에게 주자", b: "그 돈이 없으면 학교를 못 다니는 학생에게 주자",
    fit: ["rawls"], cand: ["rawls", "walzer", "macintyre"],
  },
  {
    id: "partjob", tag: "돈", title: "알바비에서 빠져나간 세금",
    text: "형이 방학 내내 알바해서 번 돈에서 세금이 빠졌다. 형은 \u201c내 시간 써서 번 돈인데 왜 떼가냐\u201d고 한다. 그 세금은 형편이 어려운 사람들의 병원비로 쓰인다.",
    point: "내가 번 돈을 국가가 가져가도 될까?",
    a: "번 돈에서 세금을 떼면 안 된다", b: "세금을 떼서 어려운 사람 병원비로 써도 된다",
    fit: ["nozick", "rawls"], cand: ["nozick", "rawls", "walzer"],
  },
  {
    id: "ring", tag: "물건", title: "할머니가 물려준 반지",
    text: "할머니가 아끼던 반지를 손녀 한 명에게 물려줬다. 사촌들은 \u201c우리도 다 손주인데 왜 혼자 갖냐\u201d고 한다. 반지는 할머니가 직접 사서 직접 건넸다.",
    point: "정당하게 건네받은 물건의 주인은 누구인가?",
    a: "물려받은 손녀 한 명이 갖는다", b: "손주들이 똑같이 나눠 갖는다",
    fit: ["nozick"], cand: ["nozick", "rawls", "sandel"],
  },
  {
    id: "speech", tag: "학교", title: "발언 기회를 두 배로",
    text: "학급 회의에서 성적 상위권 학생에게 발언 기회를 두 배 주자는 말이 나왔다. \u201c더 많이 아는 사람 말이 도움 되니까\u201d가 이유다.",
    point: "기본적인 자유는 사람마다 다르게 줘도 될까?",
    a: "성적 상위권에게 발언 기회를 두 배 준다", b: "누구나 똑같은 발언 기회를 갖는다",
    fit: ["rawls"], cand: ["rawls", "walzer", "macintyre"],
  },
  {
    id: "apply", tag: "학교", title: "지원 자격 제한",
    text: "학생회장 후보 자격을 \u20183학년, 내신 3등급 이내\u2019로 제한하자는 안이 올라왔다. \u201c아무나 나오면 학교가 엉망이 된다\u201d는 이유다.",
    point: "자리는 누구에게 열려 있어야 하는가?",
    a: "3학년·내신 3등급 이내로 제한한다", b: "누구나 후보로 나올 수 있게 한다",
    fit: ["rawls"], cand: ["rawls", "nozick", "sandel"],
  },
  {
    id: "police", tag: "국가", title: "국가는 어디까지 해야 하나",
    text: "C국은 국방과 치안만 하고 복지는 전혀 하지 않는다. D국은 세금을 많이 걷어 의료와 교육을 무료로 준다. 두 나라 국민 모두 자기 나라가 옳다고 한다.",
    point: "국가가 해야 할 일의 범위는 어디까지인가?",
    a: "국방과 치안만 하는 C국이 옳다", b: "의료와 교육까지 책임지는 D국이 옳다",
    fit: ["nozick", "rawls"], cand: ["nozick", "rawls", "macintyre"],
  },
  {
    id: "land", tag: "물건", title: "아무도 안 쓰던 공터",
    text: "10년째 버려져 있던 공터를 E씨가 혼자 치우고 밭으로 만들었다. 그러자 마을 사람들이 \u201c저긴 원래 우리 마을 땅\u201d이라며 나눠 쓰자고 한다.",
    point: "처음 손댄 사람이 주인이 되는가?",
    a: "치우고 밭을 만든 E씨의 것이다", b: "마을이 함께 나눠 쓴다",
    fit: ["nozick"], cand: ["nozick", "rawls", "sandel"],
  },
  {
    id: "transfer", tag: "공동체", title: "전학생과 30년 된 응원가",
    text: "F고에는 30년 이어온 응원가가 있다. 전학 온 학생이 \u201c난 이 학교 역사랑 상관없는데 왜 이걸 외워야 하냐\u201d고 묻는다.",
    point: "내가 고르지 않은 공동체가 나를 만들 수 있을까?",
    a: "안 외워도 된다, 내가 고른 역사가 아니다", b: "이 학교 학생이 됐으니 함께 이어간다",
    fit: ["macintyre"], cand: ["macintyre", "nozick", "rawls"],
  },
  {
    id: "sports", tag: "학교", title: "체육대회 연습에 안 나오는 친구",
    text: "G는 체육대회 연습에 안 나온다. \u201c난 참가 신청도 안 했고, 방과 후는 내 자유\u201d라고 한다. 반 친구들은 서운해한다.",
    point: "그 반의 일원이라는 것만으로 생기는 몫이 있을까?",
    a: "안 나가도 된다, 방과 후는 내 자유다", b: "반의 일원이니 함께 준비해야 한다",
    fit: ["sandel"], cand: ["sandel", "nozick", "walzer"],
  },
  {
    id: "election", tag: "권력", title: "간식 돌려서 된 학생회장",
    text: "H는 선거 기간에 전교생에게 간식을 돌렸고 학생회장이 됐다. 자기 용돈으로 샀고 교칙을 어긴 것도 아니다.",
    point: "돈이 통해도 되는 영역과 안 되는 영역이 따로 있을까?",
    a: "자기 용돈으로 산 간식이니 문제없다", b: "돈으로 표를 얻는 건 안 된다",
    fit: ["walzer"], cand: ["walzer", "nozick", "rawls"],
  },
  {
    id: "family", tag: "공동체", title: "3대째 국숫집",
    text: "3대째 이어온 국숫집을 물려받으라는 부모에게 L은 \u201c내 인생은 내가 고른다\u201d고 한다. 부모는 \u201c이 가게가 우리 집 이야기\u201d라고 한다.",
    point: "내 삶의 이야기는 어디서 시작될까?",
    a: "내 인생은 내가 고른다", b: "가업은 우리 집 이야기니 이어받는다",
    fit: ["macintyre"], cand: ["macintyre", "nozick", "walzer"],
  },
  {
    id: "hospital", tag: "권력", title: "수술 순서를 돈으로",
    text: "K병원이 기부금을 많이 낸 사람에게 수술 순서를 먼저 주기로 했다. \u201c돈 더 낸 사람이 먼저 받는 게 뭐가 문제냐\u201d는 말도 나온다.",
    point: "건강은 무엇에 따라 나눠야 할까?",
    a: "기부를 많이 한 사람이 먼저 받는다", b: "돈과 상관없이 급한 사람이 먼저 받는다",
    fit: ["walzer"], cand: ["walzer", "nozick", "macintyre"],
  },
  {
    id: "duty", tag: "복지", title: "봉사 시간 의무화",
    text: "M시가 소득이 일정 수준을 넘는 주민에게 지역 봉사 시간을 의무로 부과하려 한다. \u201c봉사는 마음에서 우러나야 한다\u201d와 \u201c이 도시에서 얻은 게 있으면 갚아야 한다\u201d가 맞선다.",
    point: "공동체에서 받은 게 있으면 갚을 의무가 생길까?",
    a: "봉사는 자발적이어야 하니 의무는 안 된다", b: "이 도시에서 얻은 게 있으니 갚아야 한다",
    fit: ["sandel", "nozick"], cand: ["sandel", "nozick", "walzer"],
  },
  {
    id: "stolen", tag: "역사", title: "20년 전 빼앗긴 가게",
    text: "I씨의 할아버지가 강제로 빼앗긴 가게를 지금은 다른 사람이 운영한다. I씨는 돌려달라 하고, 지금 주인은 \u201c나는 정당한 값을 주고 샀다\u201d고 한다.",
    point: "출발점이 잘못됐다면 지금 상태는 정당한가?",
    a: "지금 주인이 정당하게 샀으니 그대로 둔다", b: "빼앗긴 것이니 I씨에게 돌려준다",
    fit: ["nozick"], cand: ["nozick", "macintyre", "rawls"],
  },
  {
    id: "donation", tag: "입시", title: "기부하면 입학",
    text: "J대학이 거액을 기부한 사람의 자녀에게 입학 자격을 주려 한다. 그 돈으로 가난한 학생 장학금을 크게 늘릴 수 있다고 한다.",
    point: "돈으로 살 수 있는 것과 없는 것의 경계는 어디인가?",
    a: "기부금으로 장학금을 늘릴 수 있으니 허용한다", b: "입학 자격은 돈으로 사면 안 된다",
    fit: ["walzer", "rawls"], cand: ["walzer", "rawls", "macintyre"],
  },
  {
    id: "reparation", tag: "역사", title: "내가 하지 않은 잘못",
    text: "과거 국가가 저지른 잘못의 피해자에게 지금 세대의 세금으로 배상하자는 법안이 나왔다. \u201c내가 한 일이 아니다\u201d와 \u201c물려받은 것에는 빚도 있다\u201d가 부딪힌다.",
    point: "물려받는 것에 책임도 포함될까?",
    a: "내가 한 일이 아니니 배상하지 않는다", b: "물려받은 것에 빚도 있으니 배상한다",
    fit: ["macintyre", "sandel", "nozick"], cand: ["macintyre", "sandel", "nozick"],
  },
  {
    id: "relief", tag: "복지", title: "재난지원금, 누구에게",
    text: "재난지원금을 모두에게 똑같이 줄지, 형편이 가장 어려운 사람에게 몰아줄지 정부가 고민한다. 재원은 모두가 낸 세금이다.",
    point: "똑같이 나누는 것과 공정하게 나누는 것은 같을까?",
    a: "모두에게 똑같이 준다", b: "가장 어려운 사람에게 몰아준다",
    fit: ["rawls", "nozick"], cand: ["rawls", "nozick", "macintyre"],
  },
];

/* 서버 연결 없이 교사 대시보드 UI를 확인하기 위한 예시 데이터.
   실제 학생 데이터가 아니며, 대시보드에 '데모' 배너가 함께 표시된다. */
const DEMO_ROWS = [
  {
    sessionId: "demo-1", sid: "10312", name: "김통사",
    turnCount: 16, switchCount: 7, switchPerCase: 1.4,
    avgDwellMs: 92000, medianDwellMs: 74000, maxDwellMs: 372000,
    submitCount: 9, avgAnswerLen: 41, hintUsed: 3,
    challengeLevel: 1, challengeTitle: "양심적 병역 거부", challengeCompleted: true, challengeScore: 33,
    scaffoldTotal: 7, scaffoldEarlyRate: 0.8, scaffoldLateRate: 0.75, scaffoldFadeDelta: 0.05,
    scaffoldBuckets: [
      { label: "1~3차", rate: 1.0, n: 3 }, { label: "4~6차", rate: 0.67, n: 3 }, { label: "7~9차", rate: 0.67, n: 3 },
    ],
    turnsByThinker: { rawls: 2, nozick: 7, macintyre: 3, sandel: 2, walzer: 2 },
    hintsByThinker: { nozick: 2, walzer: 1 },
    maxTurnsForThinker: 7, longestThinker: "nozick", hardestThinker: "nozick",
    level1: "하", level2: "중", record: "사례에 사상가의 관점을 적용하려 시도함.",
    alerts: [
      { id: "cognitive_overload", label: "인지적 과부하 의심", severity: "high",
        detail: "힌트 3회 전부 소진 + 최장 6분 동안 입력을 시작하지 못함",
        action: "노직 개념을 오프라인에서 먼저 재설명한 뒤, 같은 사례를 다시 적용해 보게 하세요." },
      { id: "trial_and_error", label: "개념 변별 곤란", severity: "high",
        detail: "사상가 선택을 7회 번복함",
        action: "사상가 간 핵심 개념 대조표를 함께 만들어 보게 하세요." },
      { id: "scaffold_dependent", label: "스캐폴딩 미소거", severity: "mid",
        detail: "후반 시도의 75%에서 문장 예시에 의존",
        action: "예시 없이 한 문장을 먼저 말해 보게 하는 구술 연습이 필요합니다." },
    ],
  },
  {
    sessionId: "demo-2", sid: "10305", name: "이도약",
    turnCount: 11, switchCount: 2, switchPerCase: 0.3,
    avgDwellMs: 38000, medianDwellMs: 31000, maxDwellMs: 68000,
    submitCount: 9, avgAnswerLen: 96, hintUsed: 1,
    challengeLevel: 3, challengeTitle: "개발 제한 구역", challengeCompleted: true, challengeScore: 100,
    scaffoldTotal: 4, scaffoldEarlyRate: 0.8, scaffoldLateRate: 0.0, scaffoldFadeDelta: 0.8,
    scaffoldBuckets: [
      { label: "1~3차", rate: 1.0, n: 3 }, { label: "4~6차", rate: 0.33, n: 3 }, { label: "7~9차", rate: 0.0, n: 3 },
    ],
    turnsByThinker: { rawls: 2, nozick: 2, macintyre: 3, sandel: 2, walzer: 2 },
    hintsByThinker: { macintyre: 1 },
    maxTurnsForThinker: 3, longestThinker: "macintyre", hardestThinker: "macintyre",
    level1: "상", level2: "상", record: "무지의 베일과 서사적 자아를 사례에 정확히 적용하여 설명함.",
    alerts: [],
  },
  {
    sessionId: "demo-3", sid: "10320", name: "최속답",
    turnCount: 8, switchCount: 1, switchPerCase: 0.2,
    avgDwellMs: 4000, medianDwellMs: 3000, maxDwellMs: 9000,
    submitCount: 6, avgAnswerLen: 12, hintUsed: 0,
    challengeLevel: 1, challengeTitle: "양심적 병역 거부", challengeCompleted: false, challengeScore: 13,
    scaffoldTotal: 5, scaffoldEarlyRate: 1.0, scaffoldLateRate: 0.67, scaffoldFadeDelta: 0.33,
    scaffoldBuckets: [
      { label: "1~3차", rate: 1.0, n: 3 }, { label: "4~6차", rate: 0.67, n: 3 },
    ],
    turnsByThinker: { rawls: 3, nozick: 3, sandel: 2 },
    hintsByThinker: {},
    maxTurnsForThinker: 3, longestThinker: "rawls", hardestThinker: null,
    level1: "하", level2: "하", record: "사례를 읽고 사상가를 선택하는 활동에 참여함.",
    alerts: [
      { id: "surface_response", label: "표면적 응답", severity: "mid",
        detail: "평균 3초 만에 평균 12자로 응답",
        action: "사례를 소리 내어 읽고 근거 문장을 먼저 찾게 하세요." },
      { id: "scaffold_dependent", label: "스캐폴딩 미소거", severity: "mid",
        detail: "후반 시도의 67%에서 문장 예시에 의존",
        action: "예시 없이 한 문장을 먼저 말해 보게 하는 구술 연습이 필요합니다." },
    ],
  },
];

/* 난이도(level) 부여 기준 — 학생이 스스로 도전 수준을 고르게 하고(요구사항 2),
   그 선택 자체를 자기관리 역량(도전성)의 관찰 근거로 삼는다.
   1: 두 입장이 교과서에 그대로 대비되어 있어 대응이 명확
   2: 소유 권리와 공익이 정면으로 부딪혀 한쪽을 고르기 어려움
   3: 재산권·환경·미래 세대까지 얽혀 사상가 조합이 필요 */
const CONFLICTS = [
  {
    id: "conscience",
    title: "양심적 병역 거부",
    short: "신념의 자유 ↔ 국방의 의무",
    level: 1,
    levelName: "기본",
    why: "두 입장이 교과서에 또렷하게 대비돼 있어요. 처음 도전하기 좋아요.",
    est: "약 5분",
    text: "종교적 신념을 이유로 병역을 거부한 사람을 처벌해야 할까? 개인의 신념의 자유와, 공동체 구성원이 마땅히 져야 할 국방의 의무가 부딪힌다.",
  },
  {
    id: "excess",
    title: "초과 이윤세",
    short: "소유 권리 ↔ 공익 증진",
    level: 2,
    levelName: "도전",
    why: "'정당하게 번 돈'의 기준부터 따져야 해서 한 번 더 생각하게 돼요.",
    est: "약 8분",
    text: "예상 밖의 큰 이익을 낸 기업에 세금을 더 매겨야 할까? 정당하게 얻은 재산에 대한 소유 권리와, 공익 증진을 위한 구성원의 의무가 부딪힌다.",
  },
  {
    id: "greenbelt",
    title: "개발 제한 구역",
    short: "내 땅의 재산권 ↔ 환경 보호 의무",
    level: 3,
    levelName: "심화 쟁점",
    why: "재산권·환경·다음 세대까지 얽혀 있어 사상가 두 명 이상을 엮어야 해요.",
    est: "약 12분",
    text: "내 땅인데 국가가 개발을 막아도 될까? 토지를 소유한 개인의 권리와, 공동체의 환경을 지킬 의무가 부딪힌다.",
  },
];

/* 문장 완성형 프롬프트 (요구사항 3) — 하위권 학생의 인지적 과부하를 막는 발판.
   사용 여부를 추적해 '점진적 소거'가 일어났는지 확인한다. */
const SCAFFOLDS = {
  stage1: (thinkerName) => [
    `${thinkerName}는 이 사례에서 ___을 가장 중요하게 볼 것 같다. 왜냐하면 `,
    `${thinkerName}라면 A를 고를 것 같다. ___라는 이유 때문이다.`,
    `${thinkerName}의 '___'라는 생각으로 보면, 이 사례는 `,
  ],
  lib: [
    "자유주의는 개인의 ___을 먼저 보기 때문에 이 정책에 찬성/반대할 것 같다.",
    "롤스라면 ___라는 이유로 이 정책을 ___할 것이다.",
    "노직이라면 ___는 개인의 소유 권리를 침해하므로 ",
  ],
  com: [
    "공동체주의는 ___을 먼저 보기 때문에 이 정책에 찬성/반대할 것 같다.",
    "샌델이라면 공동체의 일원으로서 ___한 의무가 있으므로 ",
    "매킨타이어라면 우리가 물려받은 ___를 근거로 ",
  ],
};

const STAGE3_Q = `마지막이에요. 이번엔 제가 안 물어보고 ○○님 생각을 들을게요.

사회의 몫은 어떤 기준으로 나눠야 한다고 생각해요?
다섯 사람 중 누구 편을 들어도 좋고, ○○님만의 기준을 새로 만들어도 좋아요.

정답은 없어요. 왜 그렇게 생각하는지까지 정리해서 알려 주세요.`;

const SYSTEM_PROMPT = (student, st) => `당신은 대한민국 고등학교 '통합사회' 과목의 학습 도우미 '통크'입니다.

[학생 정보] 학번 ${student.sid} / 이름 ${student.name} / 부를 이름: ${student.nick} (반드시 이 이름으로 부릅니다)

[다루는 범위 — 오직 이것만]
통합사회2 Ⅱ단원 2. 자유주의와 공동체주의 정의관
- 자유주의: 롤스(평등주의적 자유주의, 원초적 입장, 무지의 베일, 공정으로서의 정의, 평등한 자유의 원칙, 차등의 원칙, 기회균등의 원칙, 개인의 자유와 사회·경제적 불평등을 최소화하려는 국가의 역할 인정) / 노직(자유 지상주의, 배타적 소유 권리 보장, 최소 국가, 소유 권리로서의 정의, 재분배 정책 반대, 취득의 원칙, 이전의 원칙, 교정의 원칙)
- 공동체주의: 매킨타이어(서사적 자아) / 샌델(연고적 자아) / 왈처(공동체의 문화와 특수성을 고려한 복합 평등으로서의 정의)
- 두 정의관의 충돌: 양심적 병역 거부, 초과 이윤세, 개발 제한 구역
- 권리와 의무, 사익과 공익의 조화

[역할 — 가장 중요]
이 활동의 주인은 학생입니다. 통크는 가르치는 사람이 아니라 학생에게 배우는 쪽입니다.
- "저는 헷갈리는데", "저한테 설명해 주실래요?" 같은 자세를 유지합니다.
- 통크가 개념을 정리해 주거나 요약해 주지 마세요. 학생의 몫을 빼앗는 일입니다.
- 학생이 설명하면 "제가 이해한 게 이거 맞나요?" 정도로 한 줄만 확인합니다.

[현재 진행 상황 — 매 턴 갱신]
- 현재 단계: ${st.stage}단계
- 사상가별 점검 현황: ${st.progress}
- 아직 남은 사상가: ${st.remaining || "없음"}
${st.caseTitle ? `- 지금 다루는 사례: ${st.caseTitle}\n- 이 사례에 실제로 적용되는 사상가: ${st.caseFit} (이 이름을 학생에게 절대 알려주지 않습니다)` : ""}${st.conflict ? `\n- 학생이 고른 충돌 지점: ${st.conflict}` : ""}

[1단계 운영 — 사상가 한 명당 딱 한 번씩, 빠르게]
학생이 [사례][사상가][설명] 형식으로 답을 보냅니다. 학생은 개념어를 고르지 않습니다. 자기 말로 설명합니다.

학생 설명이 그 사상가의 입장으로 성립하면, 반드시 이 순서로 답합니다.
1. 학생이 설명한 내용을 그 사상가의 핵심 개념어를 써서 한 번 다시 정리해 줍니다. 학생이 쓴 표현을 살리되 거기에 정확한 개념어를 얹습니다.
   예: "아, 그러니까 누가 후보인지 모르는 상태에서 규칙을 정해야 한다는 거죠? 그게 롤스가 말한 '무지의 베일' 속 '원초적 입장'이네요."
2. 덕분에 이해했다고 말합니다. "덕분에 이제 알겠어요", "이해됐어요" 같은 말.
3. cleared에 그 사상가와, 정리할 때 쓴 핵심 개념어를 넣습니다. 개념어는 한두 개면 충분합니다.
4. 이제 다른 사람 차례라고 한 줄로 묻습니다. 예: "이번엔 다른 사람으로 가 볼까요?"
   새 사례는 화면이 자동으로 띄워 줍니다. 통크가 사례를 직접 지어내거나 제시하지 마세요.
학생이 개념어를 몰라도 됩니다. 내용만 맞으면 통과이고, 개념어를 붙여 주는 건 통크의 몫입니다.

설명이 얕거나 사례와 연결되지 않으면 통과시키지 마세요. 그 사상가의 눈으로 이 사례의 무엇을 어떻게 보는지가 드러나야 통과입니다.

[학생이 안 맞는 사상가를 골랐을 때 — 아주 중요]
통크는 채점하는 사람이 아닙니다. 학생과 똑같이 갸웃하면서 되묻습니다.
- cleared는 비웁니다.
- 학생 설명에 맞는 부분이 있으면 딱 한 줄로만 인정합니다.
- 그다음 그 사상가로 이 사례가 설명되는지를 되묻습니다. 이런 식으로 씁니다.
  "근데 그 사람 이론으로 이 사례가 설명이 되나요?"
  "그건 다른 상황에 쓰는 말 아니에요?"
  "이 사례가 그런 상황이 맞아요?"
- 아래 표현은 절대 쓰지 않습니다. 채점하고 평가하는 말투라서 학생이 주눅 듭니다.
  "살짝 아쉬워요" / "정확하지 않아요" / "바로 연결되는 개념으로는 부족해요" / "조금 더 정확한 개념이 있어요"
- 개념의 뜻을 통크가 먼저 설명하지 않습니다. 예를 들어 "'평등주의적 자유주의'는 롤스의 전체 입장을 부르는 이름이라서" 같은 문장은 통크가 가르치는 것이므로 금지입니다. 개념어를 쓰는 건 오직 위 1번, 학생 설명이 맞았을 때 되짚어 줄 때뿐입니다.
- 맞는 사상가 이름을 절대 알려주지 않습니다. 학생이 스스로 다시 고르게 되묻고 끝냅니다.
- 다만 '이 사례에 실제로 적용되는 사상가' 목록에 없는 사람이라도, 학생 설명이 실제로 성립하면 인정하고 통과시킵니다.

[2단계 운영]
학생이 충돌 지점 하나를 골라 자유주의 입장과 공동체주의 입장을 각각 설명합니다.
- 두 입장이 모두 교과 내용에 맞으면 칭찬 후 next를 "stage3"으로 보냅니다.
- 한쪽이라도 어긋나면 그 쪽만 콕 집어 다시 묻고 next는 "stay"입니다. 되묻기는 최대 한 번입니다.

[3단계 운영]
학생이 분배에 관한 자기 기준을 정리해서 말합니다. 정답이 없습니다.
- 판정하지 말고, 학생 생각에서 눈에 띄는 지점 하나를 짚어 주고 활동을 마칩니다.
- 이때 반드시 final 객체를 채우고 complete를 true로 보냅니다.
- final.record는 학교생활기록부 과목별 세부능력 및 특기사항 문체로 씁니다. 즉 '~함', '~을 보임', '~을 설명함' 같은 개조식 서술형으로, 학생 이름이나 인칭은 쓰지 않고, 3~5문장, 250자 안팎으로 씁니다. 1단계에서 다룬 사상가와 개념, 2단계에서 고른 충돌 지점, 3단계에서 학생이 세운 기준을 구체적으로 녹여 씁니다.
- final.level1, final.level2는 각각 1단계와 2단계 수행 수준으로 "상", "중", "하" 중 하나입니다.
- final.praise는 학생에게 직접 건네는 격려 두 문장입니다. 수준이 '하'여도 반드시 긍정적으로 씁니다.

[질문 규칙]
질문은 언제나 구체적이어야 합니다. "어떻게 생각하세요?", "왜 그럴까요?" 같은 막연한 질문은 금지입니다.
대신 (a) ①②③ 선택지 제시 (b) 구체적 상황 제시 (c) 학생이 쓴 단어 지목 (d) 한 단어 답 요구 중 하나로 묻습니다.

[답변 구조 — 반드시 이 형식]
답변은 빈 줄 하나로 나뉜 두 덩어리로만 씁니다.
- 첫째 덩어리: 학생 말에 대한 반응. 통과일 때는 개념어를 얹어 되짚어 준 정리와 이해했다는 말. 통과가 아닐 때는 인정할 부분 한 줄. 최대 3문장.
- (빈 줄)
- 둘째 덩어리: 학생이 새로 해야 할 것. 되묻는 질문이거나 다음 사람으로 넘어가자는 안내. 1~2문장이며 반드시 물음표로 끝납니다.
둘째 덩어리에는 정리나 칭찬을 절대 섞지 않습니다. 반대로 첫째 덩어리에는 질문을 넣지 않습니다.
예시:
아, 누가 후보인지 모르는 상태에서 규칙을 정하자는 거죠? 그게 롤스의 '무지의 베일' 속 '원초적 입장'이네요. 덕분에 이해했어요.

이제 다른 사람으로 가 볼까요?

[분량]
- 첫째 덩어리 최대 3문장, 둘째 덩어리 최대 2문장. 한 문장 40자 안팎.
- 굵은 글씨, 목록 기호, 표, 이모지 금지.

[말투] 고1이 편하게 느낄 친근한 존댓말.

[출력 형식] 다른 말·코드펜스 없이 아래 JSON만 출력합니다.
{
  "reply": "학생에게 보여 줄 말",
  "cleared": [{"thinker":"rawls","concept":"차등의 원칙"}],
  "tilt": -100~100 정수. 학생의 설명이 자유주의 쪽이면 음수, 공동체주의 쪽이면 양수, 중립이면 0.
  "next": "stay" 또는 "stage3",
  "complete": false,
  "final": null
}
complete가 true일 때만 final을 {"level1":"상","level2":"중","record":"...","praise":"..."} 형태로 채웁니다.
cleared의 thinker는 rawls, nozick, macintyre, sandel, walzer 중 하나이고, concept는 위 범위에 적힌 개념 이름을 그대로 씁니다. 학생이 스스로 설명해 낸 것만 넣습니다.`;

/* ── 통크 ────────────────────────────────────────────────── */
function Tongkeu({ size = 44, mood = "idle" }) {
  const uid = useId().replace(/:/g, "");
  const clip = `tkclip-${uid}`;
  return (
    <div className={`tk tk-${mood}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 52 52">
        <defs>
          <clipPath id={clip}>
            <circle cx="26" cy="26" r="23.5" />
          </clipPath>
        </defs>
        <circle cx="26" cy="26" r="24.4" fill="#242844" stroke="var(--brass)" strokeWidth="2" />

        <g clipPath={`url(#${clip})`}>
          {/* 히마티온(그리스식 겉옷) */}
          <path d="M3 54 C5 45 15 41 26 41 C37 41 47 45 49 54 Z" fill="#D9D5C8" />
          <path d="M18.5 42.6 C20.4 47 22.2 50.4 22.6 54" fill="none" stroke="#B4AF9E" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M33.5 42.6 C31.6 47 29.8 50.4 29.4 54" fill="none" stroke="#B4AF9E" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M26 41.6 C24.2 45.4 23.4 49.6 23.4 54" fill="none" stroke="#B4AF9E" strokeWidth=".9" strokeLinecap="round" />
          {/* 목 */}
          <path d="M20.6 35 h10.8 v7 h-10.8 Z" fill="#E7C49E" />
          {/* 얼굴과 벗어진 이마 */}
          <ellipse cx="26" cy="23.2" rx="12.3" ry="13.7" fill="#F6D9B8" />
          <ellipse cx="26" cy="14.8" rx="8.2" ry="4.6" fill="#FCE8CF" opacity=".75" />
          {/* 옆머리 곱슬 */}
          <circle cx="13.9" cy="22.4" r="2.7" fill="#EFEDE6" />
          <circle cx="12.7" cy="26.2" r="2.7" fill="#EFEDE6" />
          <circle cx="14.0" cy="29.6" r="2.4" fill="#EFEDE6" />
          <circle cx="38.1" cy="22.4" r="2.7" fill="#EFEDE6" />
          <circle cx="39.3" cy="26.2" r="2.7" fill="#EFEDE6" />
          <circle cx="38.0" cy="29.6" r="2.4" fill="#EFEDE6" />
          {/* 덥수룩한 수염 */}
          <path
            d="M13.4 23.4 C12.3 32.6 13.8 39.8 17.8 43.4 C20.4 45.7 22.6 46.6 26 46.6 C29.4 46.6 31.6 45.7 34.2 43.4 C38.2 39.8 39.7 32.6 38.6 23.4 C36.2 29.8 31 31.6 26 31.6 C21 31.6 15.8 29.8 13.4 23.4 Z"
            fill="#EFEDE6"
          />
          <path d="M19.6 35.8 C21.4 40.4 23.4 42.8 26 43.4" fill="none" stroke="#D6D3C8" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M32.4 35.8 C30.6 40.4 28.6 42.8 26 43.4" fill="none" stroke="#D6D3C8" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M16.4 31.4 C17.2 35 18 37.4 19.4 39.4" fill="none" stroke="#D6D3C8" strokeWidth=".9" strokeLinecap="round" />
          <path d="M35.6 31.4 C34.8 35 34 37.4 32.6 39.4" fill="none" stroke="#D6D3C8" strokeWidth=".9" strokeLinecap="round" />
          {/* 콧수염 */}
          <path d="M18.8 27.2 Q22.6 31.2 26 29.5 Q29.4 31.2 33.2 27.2 Q29.6 33.2 26 31.3 Q22.4 33.2 18.8 27.2 Z" fill="#E3E1D8" />
          {/* 덥수룩한 눈썹 */}
          <path d="M15.4 19.4 Q19.6 15.7 23.9 18.9" fill="none" stroke="#EFEDE6" strokeWidth="3.3" strokeLinecap="round" />
          <path d="M28.1 18.9 Q32.4 15.7 36.6 19.4" fill="none" stroke="#EFEDE6" strokeWidth="3.3" strokeLinecap="round" />
          {/* 눈 */}
          <circle cx="20.2" cy="23.1" r="2.1" fill="#2A2438" />
          <circle cx="31.8" cy="23.1" r="2.1" fill="#2A2438" />
          <circle cx="21.0" cy="22.3" r=".75" fill="#fff" />
          <circle cx="32.6" cy="22.3" r=".75" fill="#fff" />
          {/* 들창코 */}
          <path d="M26 22.4 L26 25.6" fill="none" stroke="#D9AE85" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M23.1 26.3 Q26 29.4 28.9 26.3" fill="none" stroke="#D9AE85" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="23.4" cy="26.6" r=".55" fill="#C99B72" />
          <circle cx="28.6" cy="26.6" r=".55" fill="#C99B72" />
        </g>

        {/* 월계관 */}
        <path d="M11.6 14.8 Q26 4.8 40.4 14.8" fill="none" stroke="var(--brass)" strokeWidth="1.6" strokeLinecap="round" />
        <ellipse cx="14.4" cy="13.7" rx="2.6" ry="1.5" transform="rotate(-44 14.4 13.7)" fill="var(--brass)" />
        <ellipse cx="18.6" cy="10.6" rx="2.6" ry="1.5" transform="rotate(-28 18.6 10.6)" fill="var(--brass)" />
        <ellipse cx="23.3" cy="8.8" rx="2.5" ry="1.4" transform="rotate(-13 23.3 8.8)" fill="var(--brass)" />
        <ellipse cx="28.7" cy="8.8" rx="2.5" ry="1.4" transform="rotate(13 28.7 8.8)" fill="var(--brass)" />
        <ellipse cx="33.4" cy="10.6" rx="2.6" ry="1.5" transform="rotate(28 33.4 10.6)" fill="var(--brass)" />
        <ellipse cx="37.6" cy="13.7" rx="2.6" ry="1.5" transform="rotate(44 37.6 13.7)" fill="var(--brass)" />
      </svg>
    </div>
  );
}

function Bubble({ text, ai }) {
  if (!ai) return <div className="bubble">{text}</div>;
  const lines = text.split("\n");

  /* 빈 줄로 문단을 나누고, 물음표가 들어간 마지막 문단부터 끝까지를 '학생이 답할 부분'으로 본다 */
  const blockOf = [];
  let b = 0;
  let prevBlank = true;
  lines.forEach((ln) => {
    const blank = !ln.trim();
    if (blank) {
      blockOf.push(-1);
      prevBlank = true;
    } else {
      if (prevBlank) b += 1;
      blockOf.push(b);
      prevBlank = false;
    }
  });
  let askBlock = Infinity;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (blockOf[i] > 0 && lines[i].includes("?")) {
      askBlock = blockOf[i];
      break;
    }
  }
  /* 문단이 하나뿐이면 물음표가 있는 줄부터만 강조 */
  const single = b <= 1;
  let firstQLine = -1;
  if (single) for (let i = 0; i < lines.length; i++) if (lines[i].includes("?")) { firstQLine = i; break; }

  return (
    <div className="bubble">
      {lines.map((ln, i) => {
        if (!ln.trim()) return <div key={i} className="gap" />;
        const opt = /^\s*[①②③④⑤]/.test(ln);
        const isAsk = single ? firstQLine >= 0 && i >= firstQLine : blockOf[i] >= askBlock;
        return <div key={i} className={`ln${isAsk && !opt ? " q" : ""}${opt ? " opt" : ""}`}>{ln}</div>;
      })}
    </div>
  );
}

function ThoughtScale({ tilt }) {
  const t = Math.max(-100, Math.min(100, tilt));
  const angle = t * 0.13;
  const cx = 130, cy = 44, L = 80, drop = 22;
  const pan = (x, label) => {
    const y0 = cy + drop;
    return (
      <g transform={`rotate(${-angle} ${x} ${cy})`}>
        <line x1={x} y1={cy} x2={x} y2={y0} stroke="var(--brass)" strokeWidth="1.6" />
        <path d={`M ${x - 36} ${y0} Q ${x} ${y0 + 30} ${x + 36} ${y0} Z`} fill="rgba(255,201,60,.15)" stroke="var(--brass)" strokeWidth="2" strokeLinejoin="round" />
        <text x={x} y={y0 + 12} textAnchor="middle" className="pan-label">{label}</text>
      </g>
    );
  };
  return (
    <svg className="scale" viewBox="0 0 260 132" role="img" aria-label={`기울기 ${t}`}>
      <line x1={cx} y1={cy} x2={cx} y2={118} stroke="var(--brass)" strokeWidth="2.6" />
      <path d={`M ${cx - 26} 118 L ${cx + 26} 118`} stroke="var(--brass)" strokeWidth="3.4" strokeLinecap="round" />
      <g className="beam" style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
        <line x1={cx - L} y1={cy} x2={cx + L} y2={cy} stroke="var(--brass)" strokeWidth="2.6" strokeLinecap="round" />
        {pan(cx - L, "자유")}
        {pan(cx + L, "공동체")}
      </g>
      <circle cx={cx} cy={cy} r="5" fill="var(--brass)" />
    </svg>
  );
}

/* ── 우리 반 생각 대시보드 ──────────────────────────────────
   구글 시트 서버가 미리 집계한 비율만 받아 온다.
   이 화면은 누가 무엇을 답했는지는 절대 보여주지 않고,
   전체 인원 대비 비율만 보여준다. */
function ClassDashboard({ onBack }) {
  const [state, setState] = useState("loading"); // loading | ready | empty | off | error
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!SHEET_ENDPOINT) {
      setState("off");
      return;
    }
    let alive = true;
    fetch(`${SHEET_ENDPOINT}?stats=1`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d || d.ok !== true) {
          setState("error");
          return;
        }
        if (!d.enough) {
          setStats(d);
          setState("empty");
          return;
        }
        setStats(d);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  const LEAN_LABEL = { lib: "자유주의 쪽", mid: "균형", com: "공동체주의 쪽" };
  const LEAN_DESC = {
    lib: "개인의 자유와 권리를 먼저 봐요",
    mid: "상황에 따라 저울질해요",
    com: "공동체와 유대를 먼저 봐요",
  };
  const BAND_LABEL = ["강한 자유주의", "자유주의 쪽", "균형", "공동체주의 쪽", "강한 공동체주의"];
  const BAND_KEYS = ["sLib", "lib", "mid", "com", "sCom"];

  const leanTotal = stats && stats.enough ? stats.lean.lib + stats.lean.mid + stats.lean.com : 0;
  const pct = (n) => (leanTotal ? Math.round((n / leanTotal) * 100) : 0);

  const conflictList =
    stats && stats.enough && stats.conflicts
      ? Object.entries(stats.conflicts).sort((a, b) => b[1] - a[1])
      : [];
  const conflictMax = conflictList.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div className="board">
      <div className="board-in">
        <button className="backbtn" onClick={onBack}>← 돌아가기</button>

        <div className="board-head">
          <Tongkeu size={52} />
          <h1 className="disp">우리 반 생각 지도</h1>
          <p className="board-sub">
            지금까지 활동을 마친 친구들의 성향을 모아 봤어요.
            <br />
            학번이나 이름, 누가 무슨 말을 했는지는 여기에 나오지 않아요. 비율만 보여요.
          </p>
        </div>

        {state === "loading" && <div className="board-msg">모으는 중이에요...</div>}
        {state === "off" && <div className="board-msg">지금은 전체 결과를 불러올 수 없어요.</div>}
        {state === "error" && <div className="board-msg">잠깐 연결이 안 됐어요. 새로고침해 볼래요?</div>}
        {state === "empty" && (
          <div className="board-msg">
            아직 활동을 마친 친구가 {stats?.minNeeded || 5}명이 안 돼요.
            <br />
            {stats?.minNeeded || 5}명이 넘으면 그때부터 반 전체 비율이 열려요.
          </div>
        )}

        {state === "ready" && stats && (
          <>
            <div className="bpanel">
              <h3>자유주의 vs 공동체주의, 우리 반은?</h3>
              <p className="bcap">전체 {stats.total}명이 활동을 마쳤어요.</p>

              <div className="stackbar">
                {["lib", "mid", "com"].map((k) => (
                  <div
                    key={k}
                    className={`stackseg seg-${k}`}
                    style={{ width: `${pct(stats.lean[k])}%` }}
                    title={`${LEAN_LABEL[k]} ${pct(stats.lean[k])}%`}
                  />
                ))}
              </div>
              <div className="stacklegend">
                {["lib", "mid", "com"].map((k) => (
                  <div key={k} className={`legitem leg-${k}`}>
                    <span className="dot" />
                    <div>
                      <b>{LEAN_LABEL[k]} {pct(stats.lean[k])}%</b>
                      <span>{LEAN_DESC[k]} · {stats.lean[k]}명</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bpanel">
              <h3>조금 더 자세히 보면</h3>
              <p className="bcap">강한 쪽부터 강한 쪽까지, 다섯 구간으로 나눠 봤어요.</p>
              <div className="bandrows">
                {BAND_KEYS.map((k, i) => {
                  const n = stats.band[k] || 0;
                  const p = leanTotal ? Math.round((n / stats.total) * 100) : 0;
                  return (
                    <div key={k} className="bandrow">
                      <span className="bandname">{BAND_LABEL[i]}</span>
                      <div className="bandtrack">
                        <div className={`bandfill band-${k}`} style={{ width: `${p}%` }} />
                      </div>
                      <span className="bandpct">{p}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {conflictList.length > 0 && (
              <div className="bpanel">
                <h3>다들 어떤 주제로 부딪혀 봤을까</h3>
                <p className="bcap">2단계에서 고른 주제예요.</p>
                <div className="bandrows">
                  {conflictList.map(([title, n]) => (
                    <div key={title} className="bandrow">
                      <span className="bandname bandname-w">{title}</span>
                      <div className="bandtrack">
                        <div className="bandfill band-topic" style={{ width: `${conflictMax ? (n / conflictMax) * 100 : 0}%` }} />
                      </div>
                      <span className="bandpct">{n}명</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function FiveEyes() {
  const [screen, setScreen] = useState("role");   // role → intro(학생) | teacherMode(교사)
  const [form, setForm] = useState({ sid: "", name: "", nick: "" });
  const [student, setStudent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [phase, setPhase] = useState("warmup"); // warmup | work
  const [cleared, setCleared] = useState({ rawls: [], nozick: [], macintyre: [], sandel: [], walzer: [] });
  const [flash, setFlash] = useState(null);
  const [tilt, setTilt] = useState(0);
  const [tiltMoved, setTiltMoved] = useState(false);

  const [stage, setStage] = useState(1);
  const [curCase, setCurCase] = useState(null);
  const [usedCases, setUsedCases] = useState([]);
  const [conflict, setConflict] = useState(null);
  const [stage2Tries, setStage2Tries] = useState(0);
  const [final, setFinal] = useState(null);
  const [stage3Text, setStage3Text] = useState("");

  const [selT, setSelT] = useState(null);
  const [pick, setPick] = useState(null);
  const [draft, setDraft] = useState("");
  const [libText, setLibText] = useState("");
  const [comText, setComText] = useState("");
  const [hintsLeft, setHintsLeft] = useState(3);
  const [showScaffold, setShowScaffold] = useState(false);
  const [teacherMode, setTeacherMode] = useState(false);
  const [teacherPw, setTeacherPw] = useState("");
  const [teacherErr, setTeacherErr] = useState("");
  const [teacherBusy, setTeacherBusy] = useState(false);
  const [teacherKey, setTeacherKey] = useState("");
  const [teacherRows, setTeacherRows] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [dbState, setDbState] = useState("idle");   // idle | saving | ok | fail
  const [dbError, setDbError] = useState("");
  const trackerRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState(SHEET_ENDPOINT ? "idle" : "off");
  const pendingRef = useRef([]);

  const feedRef = useRef(null);
  const stateRef = useRef({});
  const clearedRef = useRef(cleared);
  const usedRef = useRef([]);
  const pendRef = useRef(null);
  const sessionRef = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);

  const doneOf = (t) => cleared[t.id].length >= t.need;
  const allDone = THINKERS.every(doneOf);
  const totalDone = THINKERS.filter(doneOf).length;

  useEffect(() => {
    stateRef.current = {
      stage,
      progress: THINKERS.map((t) => `${t.name} ${cleared[t.id].length}/${t.need}${doneOf(t) ? " 완료" : ""}`).join(" · "),
      remaining: THINKERS.filter((t) => !doneOf(t)).map((t) => t.name).join(", "),
      caseTitle: curCase ? curCase.title : null,
      caseFit: curCase ? curCase.fit.map((x) => T(x).name).join(", ") : null,
      conflict: conflict ? conflict.title : null,
    };
  });

  useEffect(() => void (clearedRef.current = cleared), [cleared]);
  useEffect(() => void (usedRef.current = usedCases), [usedCases]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (stage === 1 && allDone && phase === "work") {
      setStage(2);
      trackerRef.current?.setStage(2);
      setCurCase(null);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "다섯 사람 이론을 전부 저한테 알려 줬어요. 여기까지 정말 잘했어요.\n\n이제 두 정의관이 정면으로 부딪히는 자리를 볼게요.\n왼쪽에 세 가지가 떴어요. 하나만 골라 줄래요?",
          kind: "conflict",
        },
      ]);
    }
  }, [allDone, stage, phase]);

  /* ── 구글 시트 저장 ── */
  async function saveRow(row) {
    if (!SHEET_ENDPOINT) return;
    setSaveState("saving");
    try {
      await fetch(SHEET_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ session: sessionRef.current, ...row }),
      });
      setSaveState("ok");
    } catch (e) {
      pendingRef.current.push(row);
      setSaveState("fail");
    }
  }

  async function flushPending() {
    const q = pendingRef.current;
    pendingRef.current = [];
    for (const r of q) await saveRow(r);
  }

  const canStart = form.sid.trim() && form.name.trim() && form.nick.trim();

  function pickCase(clearedMap, used) {
    const rem = THINKERS.filter((t) => (clearedMap[t.id] || []).length < t.need).map((t) => t.id);
    let pool = CASES.filter((c) => !used.includes(c.id) && c.fit.some((x) => rem.includes(x)));
    if (!pool.length) pool = CASES.filter((c) => c.fit.some((x) => rem.includes(x)));
    if (!pool.length) pool = CASES.filter((c) => !used.includes(c.id));
    return pool[0] || CASES[0];
  }

  function postCase(c, extra) {
    /* 요구사항 1: 사례 카드 노출 시각 = 답변 지연 시간(Dwell) 측정의 기준점 */
    if (trackerRef.current) {
      trackerRef.current.markCaseShown(c.id, { title: c.title, tag: c.tag, fit: c.fit });
    }
    setShowScaffold(false);
    setCurCase(c);
    setUsedCases((u) => (u.includes(c.id) ? u : [...u, c.id]));
    setSelT(null);
    setPick(null);
    setDraft("");
    setMessages((m) => [
      ...m,
      ...(extra ? [{ role: "assistant", content: extra }] : []),
      { role: "assistant", content: `[사례] ${c.title}\n${c.text}\n[쟁점] ${c.point}\nA. ${c.a}\nB. ${c.b}`, kind: "case", data: c },
    ]);
  }

  /* 교사 코드 검증 — /api/results 가 서버 환경변수 TEACHER_KEY 와 대조한다.
     프런트에 코드를 박아 두면 소스만 열어도 뚫리므로 반드시 서버에서 판정한다.
     실패 원인(코드 불일치 / 네트워크 / 기타)을 구분해 안내한다. */
  async function enterTeacher() {
    const pw = teacherPw.trim();
    if (!pw || teacherBusy) return;
    setTeacherBusy(true);
    setTeacherErr("");

    const r = await fetchResultsForTeacher(pw);

    if (r.ok) {
      setTeacherKey(pw);
      setTeacherRows(r.rows);
      setTeacherMode(true);
    } else if (r.error === "unauthorized") {
      setTeacherErr("코드가 맞지 않아요.\n배포 환경변수의 TEACHER_KEY 값과 같은지 확인해 주세요.");
    } else if (r.error === "network") {
      setTeacherErr(
        "서버에 연결하지 못했어요.\n" +
        "· 이 미리보기 화면에서는 외부 연결이 막혀 있을 수 있어요.\n" +
        "· 배포된 실제 주소에서 다시 시도해 주세요."
      );
    } else {
      setTeacherErr(r.error || "조회에 실패했어요. 잠시 뒤 다시 시도해 주세요.");
    }
    setTeacherBusy(false);
  }

  /* 서버 없이 대시보드 UI만 확인하고 싶을 때 (수업 준비·시연용) */
  function enterTeacherDemo() {
    setTeacherRows(DEMO_ROWS);
    setTeacherKey("");
    setTeacherMode(true);
  }

  function start() {
    if (!canStart) return;
    const s = { sid: form.sid.trim(), name: form.name.trim(), nick: form.nick.trim() };
    setStudent(s);
    /* 학습분석 계측 시작 — 이 시점부터 모든 미시 행동이 기록된다 */
    trackerRef.current = new LearningTracker({
      endpoint: SHEET_ENDPOINT,
      student: s,
      onFlush: (st) => setSaveState(st === "ok" ? "ok" : "fail"),
    });
    attachUnloadFlush(trackerRef.current);
    setMessages([
      {
        role: "assistant",
        content: `${s.nick}님, 안녕하세요!\n\n똑같은 일인데 누구는 공정하다고 하고, 누구는 아니라고 하잖아요.\n\n자유주의랑 공동체주의를 알면 도움이 될 것 같은데... 저도 알려주세요!!`,
      },
    ]);
    setPhase("warmup");
    setScreen("room");
  }

  function beginWork(text) {
    const body = (text || draft).trim();
    if (!body) return;
    setMessages((m) => [...m, { role: "user", content: body }]);
    setDraft("");
    setPhase("work");
    const first = pickCase(cleared, []);
    setTimeout(() => {
      postCase(first, `고마워요! 그럼 사례를 하나 드릴게요.\n\n제가 사례를 주면, ${student.nick}님이 누구 눈으로 볼지 골라서 설명해 주면 돼요.`);
    }, 350);
  }

  const ask = useCallback(
    async (history) => {
      setBusy(true);
      setError(null);
      const snap = stateRef.current;
      try {
        /* OpenRouter 호출.
           프록시(/api/chat)를 먼저 쓰고, 없을 때만 직접 호출로 넘어간다. */
        const sysPrompt = SYSTEM_PROMPT(student, snap);
        const chatMessages = history.map((m) => ({ role: m.role, content: m.content }));

        /* 서버리스 함수가 대신 OpenRouter 를 호출한다.
           이 요청에는 인증 헤더가 없다 — 키는 서버에만 있다. */
        const res = await fetch(CHAT_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            max_tokens: 1000,
            system: sysPrompt,
            messages: chatMessages,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `요청 실패 (${res.status})`);
        }

        const data = await res.json();
        /* OpenRouter 응답은 OpenAI 형식: choices[0].message.content */
        const raw = String(data?.choices?.[0]?.message?.content || "").trim();
        let p = null;
        try {
          const clean = raw.replace(/```json|```/g, "").trim();
          p = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
        } catch (e) {
          p = null;
        }

        const replyText = p?.reply || raw || "답을 못 만들었어요. 다시 보내 줄래요?";
        setMessages((m) => [...m, { role: "assistant", content: replyText }]);
        /* 요구사항 1: 통크가 되물을 때마다 대화 턴 1 증가 (사상가별로도 누적) */
        trackerRef.current?.markAiTurn({
          cleared: (p && Array.isArray(p.cleared) ? p.cleared : []).map((c) => `${c.thinker}:${c.concept}`),
        });

        let mapAfter = clearedRef.current;

        if (p) {
          if (Array.isArray(p.cleared) && p.cleared.length) {
            const prev = clearedRef.current;
            const nx = { ...prev };
            let hit = null;
            const newlyDone = [];
            p.cleared.forEach(({ thinker, concept }) => {
              const th = T(thinker);
              if (!th || !concept || !nx[thinker]) return;
              const was = nx[thinker].length;
              const match =
                th.concepts.find((c) => c === concept) ||
                th.concepts.find((c) => concept.includes(c) || c.includes(concept)) ||
                concept;
              if (!nx[thinker].includes(match)) {
                nx[thinker] = [...nx[thinker], match];
                hit = { t: thinker, c: match };
              }
              if (was < th.need && nx[thinker].length >= th.need && !newlyDone.includes(thinker)) newlyDone.push(thinker);
            });
            setCleared(nx);
            mapAfter = nx;
            if (hit) {
              setFlash(hit);
              setTimeout(() => setFlash(null), 2200);
            }
            /* 사상가 한 명을 끝냈고 아직 남은 사람이 있으면, 다른 사상가용 새 사례를 이어서 준다 */
            const left = THINKERS.filter((t) => (nx[t.id] || []).length < t.need);
            if (newlyDone.length && stateRef.current.stage === 1 && left.length > 0) {
              setTimeout(() => postCase(pickCase(nx, usedRef.current)), 900);
            }
          }
          if (typeof p.tilt === "number") {
            setTilt(Math.max(-100, Math.min(100, p.tilt)));
            setTiltMoved(true);
            setTimeout(() => setTiltMoved(false), 1800);
          }
          if (stateRef.current.stage === 2 && (p.next === "stage3" || stage2Tries >= 1)) {
            /* 요구사항 2: 고른 난이도의 쟁점을 끝까지 완수 → 도전성 확정 */
            trackerRef.current?.markConflictComplete();
            trackerRef.current?.setStage(3);
            setStage(3);
            setMessages((m) => [...m, { role: "assistant", content: STAGE3_Q.replace(/○○/g, student.nick), kind: "final-q" }]);
          }
          if (p.complete === true) {
            const fin = p.final || {
              level1: "중",
              level2: "중",
              record: "자유주의와 공동체주의 정의관을 사례에 적용하여 설명함.",
              praise: "끝까지 자기 언어로 설명해 냈어요.",
            };
            setFinal(fin);

            /* ── 3단계 완료: Supabase 에 최종 결과 저장 ──────────
               학습분석 집계를 먼저 확정한 뒤, 그 지표까지 한 행에 담아
               한 번만 insert 한다. 저장이 실패해도 결과 화면은 정상
               표시되고, 학생은 결과지를 파일로 내려받을 수 있다. */
            const tk = trackerRef.current;
            const conflictMeta = CONFLICTS.find(
              (c) => c.id === (tk ? tk.challenge.picked : (conflict && conflict.id))
            );
            const finalTilt = typeof p.tilt === "number" ? p.tilt : tiltRefVal.current;

            const snapshot = tk
              ? await tk.finalize({
                  level1: fin.level1,
                  level2: fin.level2,
                  record: fin.record,
                  challengeTitle: conflictMeta ? conflictMeta.title : "",
                  clearedMap: clearedRef.current,
                  tilt: finalTilt,
                })
              : null;
            if (snapshot) setAnalytics(snapshot);

            setDbState("saving");
            const saved = await saveResult({
              sid: student.sid,
              name: student.name,
              nick: student.nick,
              clearedThinkers: clearedRef.current,
              conflictTitle: conflictMeta ? conflictMeta.title : null,
              conflictLevel: conflictMeta ? conflictMeta.level : null,
              tilt: finalTilt,
              stage3Text: stage3TextRef.current,
              level1: fin.level1,
              level2: fin.level2,
              recordText: fin.record,
              praiseText: fin.praise,
              messages: history.concat([{ role: "assistant", content: replyText }]),
              analytics: snapshot || {},
              sessionId: tk ? tk.sessionId : null,
            });
            setDbState(saved.ok ? "ok" : "fail");
            if (!saved.ok) setDbError(saved.error || "");
          }
        }
        /* 학생이 쓴 설명과 통크의 답을 시트에 남긴다 */
        const lastUser = [...history].reverse().find((m) => m.role === "user");
        const said = lastUser ? lastUser.content : "";
        const mt = said.match(/\[사상가\]\s*(.+)/);
        saveRow({
          type: "turn",
          ts: new Date().toISOString(),
          sid: student.sid,
          name: student.name,
          nick: student.nick,
          stage: snap.stage,
          caseTitle: snap.caseTitle || "",
          thinker: mt ? mt[1].trim() : "",
          student: said,
          tongkeu: replyText,
          cleared: (p && Array.isArray(p.cleared) ? p.cleared : [])
            .map((c) => `${(T(c.thinker) || {}).name || c.thinker}: ${c.concept}`)
            .join(" / "),
          progress: `${THINKERS.filter((t) => (mapAfter[t.id] || []).length >= t.need).length}/5`,
        });
      } catch (e) {
        setError("통크와 연결이 끊겼어요. 잠시 뒤 다시 보내 주세요.");
      } finally {
        setBusy(false);
      }
    },
    [student, stage2Tries]
  );

  function push(content) {
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    ask(next);
  }

  function submitStage1() {
    if (!selT || !draft.trim() || busy) return;
    /* 요구사항 1·3: 지연/작성 시간, 스캐폴딩 사용 여부를 이 시점에 확정한다 */
    trackerRef.current?.markSubmit({ text: draft.trim(), thinkerId: selT });
    setShowScaffold(false);
    push(`[사례] ${curCase.title}\n[사상가] ${T(selT).name}\n\n${draft.trim()}`);
    setDraft("");
  }

  function submitStage2() {
    if (!conflict || !libText.trim() || !comText.trim() || busy) return;
    trackerRef.current?.markSubmit({ text: libText.trim() + " " + comText.trim() });
    setStage2Tries((n) => n + 1);
    push(`[충돌 지점] ${conflict.title}\n\n[자유주의적 정의관은 이렇게 볼 거예요]\n${libText.trim()}\n\n[공동체주의적 정의관은 이렇게 볼 거예요]\n${comText.trim()}`);
    setLibText("");
    setComText("");
  }

  function submitStage3() {
    if (!draft.trim() || busy) return;
    setStage3Text(draft.trim());
    push(`[나의 분배 기준]\n${draft.trim()}`);
    setDraft("");
  }

  function useHint() {
    if (hintsLeft <= 0 || busy) return;
    trackerRef.current?.markHint();
    setHintsLeft((h) => h - 1);
    push("힌트 하나만 주세요. 답은 말고, 더 쉬운 선택지 질문으로 바꿔서 물어봐 주세요.");
  }

  function chooseConflict(c) {
    if (conflict && conflict.id === c.id) return;
    /* 요구사항 2: 고른 난이도 자체가 자기관리 역량(도전성)의 관찰 근거 */
    trackerRef.current?.markConflictSelect(c.id, c.level, c.title);
    trackerRef.current?.markCaseShown(c.id, { title: c.title, level: c.level, kind: "conflict" });
    setConflict(c);
    setMessages((m) => [...m, { role: "assistant", content: `[충돌 지점] ${c.title}\n${c.text}`, kind: "conflictcard", data: c }]);
  }

  function resultText() {
    const lines = [];
    lines.push("다섯 사람의 눈 — 최종 결과지");
    lines.push(`학번 ${student.sid} / 이름 ${student.name}`);
    lines.push("─".repeat(44));
    lines.push("");
    lines.push("[1단계] 사상가 이론으로 사례 설명");
    THINKERS.forEach((t) => lines.push(`  ${t.name} ${cleared[t.id].length ? "설명 완료" : "미점검"} — ${cleared[t.id].join(", ") || "-"}`));
    lines.push(`  수준: ${final?.level1 || "-"}`);
    lines.push("");
    lines.push(`[2단계] 충돌 지점: ${conflict ? conflict.title : "-"}`);
    lines.push(`  수준: ${final?.level2 || "-"}`);
    lines.push("");
    lines.push("[3단계] 나의 분배 기준");
    lines.push(`  ${stage3Text || "-"}`);
    lines.push("");
    lines.push("[과목별 세부능력 및 특기사항]");
    lines.push(`  ${final?.record || "-"}`);
    lines.push("");
    lines.push("─".repeat(44));
    lines.push("");
    lines.push("[전체 대화]");
    lines.push(messages.map((m) => `${m.role === "user" ? student.nick : "통크"}: ${m.content}`).join("\n\n"));
    return lines.join("\n");
  }

  function copyAll() {
    navigator.clipboard?.writeText(resultText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  function downloadAll() {
    const blob = new Blob([resultText()], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `다섯사람의눈_${student.sid}_${student.name}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* 활동이 끝나면 결과지 한 줄을 시트에 남긴다 */
  useEffect(() => {
    if (!final || !student) return;
    saveRow({
      type: "result",
      ts: new Date().toISOString(),
      sid: student.sid,
      name: student.name,
      nick: student.nick,
      level1: final.level1 || "",
      level2: final.level2 || "",
      rawls: cleared.rawls.join(", "),
      nozick: cleared.nozick.join(", "),
      macintyre: cleared.macintyre.join(", "),
      sandel: cleared.sandel.join(", "),
      walzer: cleared.walzer.join(", "),
      conflict: conflict ? conflict.title : "",
      mine: stage3Text,
      record: final.record || "",
      praise: final.praise || "",
      tilt,
      hints: 3 - hintsLeft,
    });
  }, [final]);

  const meterPct = ((Math.max(-100, Math.min(100, tilt)) + 100) / 2).toFixed(1);
  const lastIdx = messages.length - 1;

  const Rail = () => (
    <>
      <div className="card">
        <h3>지금 어디까지 왔지?</h3>
        <div className="prog">
          <div className={`prow ${stage === 1 ? "on" : ""} ${stage > 1 ? "fin" : ""}`}>
            <div className="phead">
              <span className="pnum">1</span>
              <span className="pname">다섯 사람 이론으로 설명</span>
              <span className="pcount">{totalDone}/5</span>
            </div>
            <div className="bar"><i style={{ width: `${(totalDone / 5) * 100}%` }} /></div>
            <div className="pstate">다섯 명 중 {totalDone}명 완료</div>
          </div>
          <div className={`prow ${stage === 2 ? "on" : ""} ${stage > 2 ? "fin" : ""}`}>
            <div className="phead"><span className="pnum">2</span><span className="pname">두 정의관의 충돌</span></div>
            <div className="pstate">{conflict ? conflict.title : stage < 2 ? "1단계를 마치면 열려요" : "주제를 고르세요"}</div>
          </div>
          <div className={`prow ${stage === 3 ? "on" : ""}`}>
            <div className="phead"><span className="pnum">3</span><span className="pname">나의 분배 기준</span></div>
            <div className="pstate">{stage3Text ? "정리 완료" : "마지막 단계"}</div>
          </div>
        </div>
      </div>

      {stage === 1 &&
        [
          { k: "lib", label: "자유주의적 정의관", sub: "개인의 자유와 권리" },
          { k: "com", label: "공동체주의적 정의관", sub: "공동선과 유대" },
        ].map((g) => (
          <div key={g.k} className={`card ${flash && T(flash.t).school === g.k ? "lit" : ""}`}>
            <h3>{g.label}</h3>
            <p className="cap">{g.sub}</p>
            <div className="legend">
              <span className="lgi"><span className="lgtick on">✓</span>설명 끝</span>
              <span className="lgi"><span className="lgtick" />아직 안 함</span>
              <em>한 사람당 한 번씩만 설명하면 돼요. 다섯 명 다 끝내면 2단계!</em>
            </div>
            <div className="thinkers">
              {THINKERS.filter((t) => t.school === g.k).map((t) => {
                const cs = cleared[t.id];
                const ok = cs.length >= t.need;
                return (
                  <div key={t.id} className={`thk${ok ? " ok" : ""}${flash && flash.t === t.id ? " flash" : ""}`}>
                    <div className="thk-top">
                      <span className="thk-tick">{ok ? "✓" : ""}</span>
                      <b>{t.name}</b>
                      <span className="thk-state">{ok ? "설명 끝" : "아직"}</span>
                    </div>
                    <div className="thk-sub">{t.tag}</div>
                    {cs.length > 0 && (
                      <div className="kchips">
                        {cs.map((c) => (<span key={c} className="kchip">{c}</span>))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {stage === 2 && (
        <div className="card">
          <h3>부딪히는 자리 세 곳</h3>
          <p className="cap">난이도를 보고 직접 골라 보세요. 어려운 걸 골라 끝내면 기록에 남아요.</p>
          <div className="cfrail">
            {CONFLICTS.map((c) => {
              const sel = conflict && conflict.id === c.id;
              const locked = conflict && stage2Tries > 0 && !sel;
              return (
                <button key={c.id} className={`cfr lv${c.level}${sel ? " sel" : ""}`} disabled={locked} onClick={() => chooseConflict(c)}>
                  <div className="cfr-lv">
                    <span className="flames">{"🔥".repeat(c.level)}</span>
                    <span className={`lvname lv${c.level}`}>{c.levelName}</span>
                    {c.level === 3 && <span className="badge-adv">심화 쟁점</span>}
                    <span className="est">{c.est}</span>
                  </div>
                  <b>{sel ? "✓ " : ""}{c.title}</b>
                  <span>{c.short}</span>
                  <em className="why">{c.why}</em>
                </button>
              );
            })}
          </div>
          {!conflict && <div className="cheer">고르면 시작해요!</div>}
        </div>
      )}

      {stage === 3 && (
        <div className={`card ${tiltMoved ? "lit" : ""}`}>
          <h3>내 생각 저울</h3>
          <p className="cap">지금까지 한 설명이 어느 쪽으로 기울었는지 보여줘요.</p>
          <ThoughtScale tilt={tilt} />
          <div className="meter">
            <div className="meter-track"><div className="meter-dot" style={{ left: `${meterPct}%` }} /></div>
            <div className="meter-marks"><span>자유주의</span><span>둘 다</span><span>공동체주의</span></div>
          </div>
        </div>
      )}
    </>
  );

  /* 교사 대시보드 — 주소 뒤에 ?teacher=1 을 붙이거나 첫 화면 하단 링크로 진입 */
  useEffect(() => {
    if (typeof window !== "undefined" && /[?&]teacher=1/.test(window.location.search)) {
      setScreen("teacherLogin");   // 주소로 들어와도 코드 확인은 거친다
    }
  }, []);

  if (teacherMode) {
    return (
      <TeacherDashboard
        endpoint={SHEET_ENDPOINT}
        teacherKey={teacherKey}
        initialRows={teacherRows}
        demo={teacherKey === "" && teacherRows === DEMO_ROWS}
        onExit={() => { setTeacherMode(false); setTeacherPw(""); setScreen("role"); }}
      />
    );
  }

  return (
    <div className="fx">
      <style>{`
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css');
@import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap');
.fx{--ink:#111225;--line:#2E3258;--brass:#FFC93C;--mint:#5BE9B9;--coral:#FF7A6B;--paper:#F2F1EC;--muted:#9AA0C4;
  --display:'Black Han Sans',sans-serif;--body:'Pretendard Variable',Pretendard,-apple-system,system-ui,sans-serif;
  font-family:var(--body);color:var(--paper);background:var(--ink);height:100vh;min-height:520px;
  position:relative;overflow:hidden;border-radius:14px;-webkit-font-smoothing:antialiased}
.fx *{box-sizing:border-box}
.fx::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(720px 340px at 50% -10%,rgba(255,201,60,.14),transparent 70%),
             radial-gradient(520px 300px at 92% 108%,rgba(91,233,185,.09),transparent 70%)}
.fx button{font-family:inherit}
.fx :focus-visible{outline:2px solid var(--mint);outline-offset:3px;border-radius:6px}
.disp{font-family:var(--display);font-weight:400;letter-spacing:-.015em}
.tk{flex:0 0 auto}.tk svg{width:100%;height:100%;display:block;overflow:visible}
.tk-think{animation:nod 1.3s ease-in-out infinite}
@keyframes nod{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-3px) rotate(4deg)}}

.gate{position:relative;z-index:1;height:100%;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:26px 20px}
.gate-card{width:100%;max-width:520px;text-align:center}
.eyebrow{display:inline-block;font-size:11px;letter-spacing:.14em;color:var(--brass);font-weight:800;
  border:1px solid rgba(255,201,60,.4);border-radius:999px;padding:6px 13px;margin-bottom:16px}
.title{font-size:clamp(40px,10vw,66px);line-height:.95;margin:0}
.title .q{color:var(--brass)}
/* 한 줄 제목 — 좁은 화면에서도 절대 줄바꿈되지 않도록 글자 크기를 폭에 맞춘다.
   9.2vw 는 '다섯 사람의 눈.' 8글자가 좌우 여백 안에 딱 들어가는 값이다. */
.title.oneline{font-size:clamp(28px,9.2vw,58px);white-space:nowrap;letter-spacing:-.02em;line-height:1.1}
.tagline{font-size:14.5px;color:var(--muted);margin:13px 0 0;font-weight:600;line-height:1.6}
.five{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin:14px 0 0}
.five span{font-size:11.5px;font-weight:800;padding:5px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.five span.l{border-color:rgba(91,233,185,.45);color:var(--mint)}
.five span.c{border-color:rgba(255,201,60,.45);color:var(--brass)}
.hi{display:flex;align-items:center;justify-content:center;gap:10px;margin:20px 0 18px;font-size:15.5px;font-weight:800}
.form{background:#1A1C33;border:1px solid var(--line);border-radius:18px;padding:18px;display:grid;gap:11px;text-align:left}
.field label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:700}
.field input{width:100%;background:#12142A;border:1px solid var(--line);border-radius:12px;padding:13px;
  color:var(--paper);font-size:15px;font-family:inherit;font-weight:600;transition:border-color .18s}
.field input::placeholder{color:#5A608B;font-weight:500}
.field input:focus{border-color:var(--brass);outline:none}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.cta{width:100%;padding:15px;border:none;border-radius:13px;font-size:16px;font-weight:800;cursor:pointer;
  background:var(--brass);color:#1F1705;transition:transform .14s,filter .18s;margin-top:3px}
.cta:hover:not(:disabled){filter:brightness(1.07);transform:translateY(-1px)}
.cta:disabled{background:#2A2E4E;color:#666C93;cursor:not-allowed}

.room{position:relative;z-index:1;height:100%;display:grid;grid-template-columns:minmax(214px,250px) minmax(0,1fr);gap:11px;padding:11px}
.rail{display:flex;flex-direction:column;gap:9px;min-height:0;overflow-y:auto;padding-right:3px}
.rail::-webkit-scrollbar{width:5px}.rail::-webkit-scrollbar-thumb{background:#2E3258;border-radius:6px}
.card{background:#1A1C33;border:1px solid var(--line);border-radius:15px;padding:12px;flex:0 0 auto;transition:box-shadow .4s,border-color .4s}
.card.lit{border-color:var(--brass);box-shadow:0 0 0 3px rgba(255,201,60,.16)}
.card h3{font-size:12.5px;color:var(--paper);margin:0 0 2px;font-weight:800;letter-spacing:-.01em}
.card .cap{font-size:10.5px;color:var(--muted);margin:0 0 8px;line-height:1.45}
.legend{display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:#12142A;border:1px dashed #333863;
  border-radius:9px;padding:7px 9px;margin-bottom:8px}
.legend .lgi{display:flex;align-items:center;gap:5px;font-size:10px;color:#9AA0C4;font-weight:800}
.lgtick{width:14px;height:14px;border-radius:50%;border:1.5px solid #3A3F68;display:grid;place-items:center;
  font-size:8px;font-weight:900;color:transparent}
.lgtick.on{border-color:var(--brass);background:var(--brass);color:#1F1705}
.thk-state{margin-left:auto;font-size:9.5px;font-weight:900;color:#5A608B}
.thk.ok .thk-state{color:var(--brass)}
.legend em{font-style:normal;font-size:9.5px;color:#8087B0;font-weight:700;line-height:1.4;flex-basis:100%}
.cfrail{display:flex;flex-direction:column;gap:7px}
.cfr{text-align:left;padding:10px 11px;border-radius:11px;border:1px solid var(--line);background:#12142A;
  color:var(--paper);cursor:pointer;transition:all .16s}
.cfr:hover:not(:disabled){border-color:var(--mint);transform:translateX(2px)}
.cfr.sel{border-color:var(--mint);background:rgba(91,233,185,.12)}
.cfr:disabled{opacity:.35;cursor:not-allowed}
.cfr b{display:block;font-size:12.5px;font-weight:900}
.cfr.sel b{color:var(--mint)}
.cfr span{display:block;font-size:10px;color:#7C82AB;margin-top:3px;font-weight:700;line-height:1.4}
.cfr-lv{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:5px}
.flames{font-size:10px;letter-spacing:-1px}
.lvname{font-size:9.5px;font-weight:900;border-radius:999px;padding:2px 7px}
.lvname.lv1{background:rgba(91,233,185,.16);color:var(--mint)}
.lvname.lv2{background:rgba(255,201,60,.16);color:var(--brass)}
.lvname.lv3{background:rgba(255,122,107,.18);color:var(--coral)}
.badge-adv{font-size:9px;font-weight:900;color:var(--coral);border:1px solid rgba(255,122,107,.5);
  border-radius:999px;padding:2px 6px}
.est{margin-left:auto;font-size:9px;color:#6D7399;font-weight:700}
.cfr .why{display:block;font-style:normal;font-size:9.5px;color:#6D7399;font-weight:600;
  line-height:1.5;margin-top:5px;padding-top:5px;border-top:1px dashed #2A2E4E}
.cfr.lv3{border-color:rgba(255,122,107,.35)}
.cfr.lv3:hover:not(:disabled){border-color:var(--coral)}
.scaffold{margin-bottom:9px}
.sc-toggle{width:100%;padding:9px;border-radius:11px;border:1px dashed #3A3F68;background:transparent;
  color:#8087B0;font-size:12px;font-weight:800;transition:all .16s}
.sc-toggle:hover{border-color:var(--mint);color:var(--mint)}
.sc-list{margin-top:7px;display:flex;flex-direction:column;gap:5px}
.sc-note{font-size:10px;color:#6D7399;font-weight:700;margin-bottom:2px}
.sc-item{text-align:left;padding:9px 11px;border-radius:9px;border:1px solid var(--line);
  background:#12142A;color:#D2D2E2;font-size:11.5px;font-weight:600;line-height:1.5;transition:all .14s}
.sc-item:hover{border-color:var(--mint);background:rgba(91,233,185,.08);color:var(--paper)}
.sc-mini{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}
.sc-mini button{font-size:10px;font-weight:700;padding:5px 9px;border-radius:8px;
  border:1px dashed #3A3F68;background:transparent;color:#7C82AB;transition:all .14s}
.sc-mini button:hover{border-color:var(--mint);color:var(--mint)}
.cheer{margin-top:9px;font-size:11px;color:var(--brass);font-weight:800;text-align:center}

.prog{display:flex;flex-direction:column;gap:7px;margin-top:6px}
.prow{border:1px solid var(--line);background:#12142A;border-radius:11px;padding:8px 10px;transition:all .35s}
.prow.on{border-color:var(--mint);background:rgba(91,233,185,.09)}
.prow.fin{opacity:.62}
.phead{display:flex;align-items:baseline;gap:6px}
.pnum{font-family:var(--display);font-size:14px;color:#6D7399;line-height:1}
.prow.on .pnum{color:var(--mint)}
.pname{font-size:11px;font-weight:800;color:#787EA8}
.prow.on .pname{color:var(--paper)}
.pcount{margin-left:auto;font-size:11px;font-weight:900;color:var(--mint)}
.bar{height:6px;border-radius:99px;background:#232742;margin-top:6px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:99px;background:var(--mint);transition:width .7s cubic-bezier(.22,1,.36,1)}
.pstate{font-size:10px;color:#6D7399;font-weight:700;margin-top:5px}

.thinkers{display:flex;flex-direction:column;gap:6px}
.thk{border:1px solid var(--line);background:#12142A;border-radius:11px;padding:8px 9px;transition:all .35s}
.thk.ok{border-color:var(--brass);background:rgba(255,201,60,.09)}
.thk.flash{animation:ring 2.2s ease-out}
@keyframes ring{0%{box-shadow:0 0 0 0 rgba(255,201,60,.55)}45%{box-shadow:0 0 0 8px rgba(255,201,60,0)}100%{box-shadow:0 0 0 0 rgba(255,201,60,0)}}
.thk-top{display:flex;align-items:center;gap:6px}
.thk-tick{width:14px;height:14px;flex:0 0 14px;border-radius:50%;border:1.5px solid #3A3F68;display:grid;place-items:center;
  font-size:8px;font-weight:900;color:transparent}
.thk.ok .thk-tick{border-color:var(--brass);background:var(--brass);color:#1F1705}
.thk b{font-size:12.5px;font-weight:900;color:#8087B0}
.thk.ok b{color:var(--paper)}
.slots{display:flex;gap:4px;margin-left:auto}
.slot{width:9px;height:9px;border-radius:50%;border:1.5px solid #3A3F68;display:block;transition:all .4s}
.slot.on{background:var(--brass);border-color:var(--brass)}
.thk-sub{font-size:9.5px;color:#6D7399;font-weight:700;margin-top:5px}
.thk-sub b{font-size:9.5px;color:var(--brass)}
.thk.ok .thk-sub b{color:var(--brass)}
.kchips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.kchip{font-size:9.5px;font-weight:700;padding:3px 7px;border-radius:999px;background:rgba(255,201,60,.16);color:var(--brass)}

.scale{width:100%;height:auto;display:block;max-height:100px}
.beam{transition:transform .8s cubic-bezier(.22,1,.36,1)}
.pan-label{font-family:var(--body);font-size:11.5px;font-weight:800;fill:var(--brass)}
.meter{margin-top:8px}
.meter-track{position:relative;height:7px;border-radius:99px;background:linear-gradient(90deg,rgba(91,233,185,.4),rgba(154,160,196,.3),rgba(255,201,60,.45))}
.meter-dot{position:absolute;top:50%;width:15px;height:15px;border-radius:50%;background:var(--paper);
  border:3px solid var(--ink);box-shadow:0 0 0 2px var(--brass);transform:translate(-50%,-50%);transition:left .8s cubic-bezier(.22,1,.36,1)}
.meter-marks{display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#7C82AB;font-weight:700}

.talk{display:flex;flex-direction:column;background:#1A1C33;border:1px solid var(--line);border-radius:15px;overflow:hidden;min-height:0}
.talk-top{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);background:#16182E;flex:0 0 auto}
.talk-top .who{font-size:14.5px;font-weight:900}
.talk-top .sub{font-size:11px;color:var(--muted);margin-top:1px;font-weight:600}
.live{margin-left:auto;font-size:10.5px;color:var(--mint);display:flex;align-items:center;gap:6px;font-weight:800}
.live i{width:6px;height:6px;border-radius:50%;background:var(--mint);display:block;animation:blip 1.9s infinite}
@keyframes blip{0%,100%{opacity:1}50%{opacity:.25}}
.feed{flex:1 1 auto;min-height:0;overflow-y:auto;padding:15px;display:flex;flex-direction:column;gap:13px}
.feed::-webkit-scrollbar{width:8px}.feed::-webkit-scrollbar-thumb{background:#2E3258;border-radius:8px}
.turn{display:flex;gap:10px;max-width:94%;animation:rise .34s cubic-bezier(.22,1,.36,1)}
@keyframes rise{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
.turn.me{margin-left:auto;flex-direction:row-reverse}
.col{display:flex;flex-direction:column;min-width:0}
.bubble{padding:12px 14px;border-radius:15px;font-size:14px;line-height:1.7;word-break:break-word;font-weight:500}
.turn.ai .bubble{background:#232742;border:1px solid var(--line);border-top-left-radius:5px}
.turn.me .bubble{background:rgba(255,201,60,.14);border:1px solid rgba(255,201,60,.34);border-top-right-radius:5px;white-space:pre-wrap}
.ln{margin:0}.ln.opt{font-weight:700;color:#E6E4DC}.ln.q{color:var(--brass);font-weight:800;line-height:1.6}.gap{height:9px}
.me-tag{width:32px;height:32px;flex:0 0 32px;border-radius:50%;background:#2A2E4E;display:grid;place-items:center;font-size:11.5px;font-weight:900;color:var(--brass)}
.dots{display:flex;gap:5px;padding:15px;background:#232742;border:1px solid var(--line);border-radius:15px;border-top-left-radius:5px}
.dots i{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:bounce 1.1s infinite}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}

.casecard{border:1px solid rgba(255,201,60,.4);background:rgba(255,201,60,.07);border-radius:14px;padding:13px 15px}
.casecard .ct{display:inline-block;font-size:10px;color:var(--brass);font-weight:800;border:1px solid rgba(255,201,60,.4);border-radius:999px;padding:3px 9px}
.casecard h4{font-family:var(--display);font-size:19px;margin:8px 0 6px;letter-spacing:-.01em}
.casecard p{margin:0;font-size:13px;line-height:1.75;color:#DCDAE8;font-weight:500}
.casecard .cpoint{margin-top:9px;padding:7px 10px;border-radius:9px;background:rgba(91,233,185,.1);
  border:1px solid rgba(91,233,185,.3);color:var(--mint);font-size:12px;font-weight:800;line-height:1.5}
.abbox{margin-top:9px;display:flex;flex-direction:column;gap:5px}
.abrow{display:flex;align-items:flex-start;gap:7px;font-size:12.5px;line-height:1.55;color:#E4E2EC;font-weight:600}
.abrow.sm{font-size:12px;color:#DCDAE8}
.abtag{flex:0 0 18px;height:18px;border-radius:6px;background:rgba(255,201,60,.2);color:var(--brass);
  display:grid;place-items:center;font-size:10.5px;font-weight:900;margin-top:1px}
.askbox{background:#12142A;border:1px solid rgba(91,233,185,.35);border-radius:12px;padding:10px 12px;margin-bottom:9px}
.askq{font-size:13px;font-weight:800;color:var(--mint);line-height:1.5;margin-bottom:7px}
.askwant{font-size:11.5px;color:#7C82AB;font-weight:700;margin-top:7px}
.casecard .ask{margin-top:11px;font-size:13.5px;color:var(--brass);font-weight:800}
.cand{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.candbtn{padding:8px 13px;border-radius:11px;border:1px solid rgba(255,201,60,.45);background:rgba(255,201,60,.1);
  color:var(--paper);font-size:13px;font-weight:800;cursor:pointer;transition:all .16s}
.candbtn:hover{background:rgba(255,201,60,.22);transform:translateY(-1px)}
.candbtn.sel{background:var(--brass);color:#1F1705;border-color:var(--brass)}
.candbtn small{display:block;font-size:9.5px;font-weight:700;color:var(--muted);margin-top:2px}
.candbtn.sel small{color:#6B5410}
.candnote{font-size:10.5px;color:#6D7399;font-weight:700;margin-top:7px}
.cfbtns{display:flex;flex-direction:column;gap:7px;margin-top:10px}
.cfbtn{text-align:left;padding:11px 13px;border-radius:12px;border:1px solid rgba(91,233,185,.4);background:rgba(91,233,185,.07);
  color:var(--paper);cursor:pointer;transition:all .16s}
.cfbtn:hover{background:rgba(91,233,185,.16);transform:translateX(2px)}
.cfbtn b{display:block;font-size:13.5px;font-weight:900}
.cfbtn span{display:block;font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.6;font-weight:500}

.compose{border-top:1px solid var(--line);padding:10px 13px 12px;background:#16182E;flex:0 0 auto}
.pk{display:flex;flex-direction:column;gap:7px;margin-bottom:9px}
.pkrow{display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap}
.pklabel{font-size:10.5px;color:#6D7399;font-weight:800;padding-top:6px;flex:0 0 66px}
.tbtn{padding:6px 11px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);
  font-size:11.5px;cursor:pointer;font-weight:800;transition:all .16s}
.tbtn:hover{border-color:var(--mint);color:var(--mint)}
.tbtn.sel{background:var(--mint);border-color:var(--mint);color:#0C231C}
.tbtn.ok{border-color:rgba(255,201,60,.5);color:var(--brass)}
.tbtn.ok.sel{background:var(--brass);color:#1F1705}
.cbtn{padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--muted);
  font-size:11px;cursor:pointer;font-weight:700;transition:all .16s}
.cbtn:hover{border-color:var(--brass);color:var(--brass)}
.cbtn.sel{background:var(--brass);border-color:var(--brass);color:#1F1705}
.cbtn.done{opacity:.45}
.two{display:grid;gap:8px;margin-bottom:9px}
.two label{font-size:11px;font-weight:800;color:var(--muted);display:block;margin-bottom:4px}
.two .lib label{color:var(--mint)}.two .com label{color:var(--brass)}
.entry{display:flex;gap:9px;align-items:flex-end}
textarea{width:100%;resize:none;background:#12142A;border:1px solid var(--line);border-radius:12px;padding:11px 13px;
  color:var(--paper);font-size:14px;font-family:inherit;line-height:1.6;font-weight:500}
textarea:focus{border-color:var(--brass);outline:none}
textarea::placeholder{color:#5A608B}
.send{padding:12px 18px;border:none;border-radius:12px;background:var(--brass);color:#1F1705;font-weight:900;font-size:14px;cursor:pointer;white-space:nowrap}
.send:disabled{background:#2A2E4E;color:#666C93;cursor:not-allowed}
.subrow{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
.chip{padding:6px 11px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);
  font-size:11.5px;cursor:pointer;transition:all .18s;font-weight:700}
.chip:hover:not(:disabled){border-color:var(--mint);color:var(--mint)}
.chip:disabled{opacity:.4;cursor:not-allowed}
.chip.go{border-color:rgba(255,201,60,.5);color:var(--brass)}
.chip.hint{margin-left:auto;border-style:dashed;border-color:#3A3F68;color:#7C82AB;font-size:11px}
.err{margin:0 15px 9px;padding:9px 12px;border-radius:10px;background:rgba(255,122,107,.1);border:1px solid rgba(255,122,107,.35);color:var(--coral);font-size:12px;font-weight:600}

.result{position:relative;z-index:1;height:100%;overflow-y:auto;padding:18px}
.rin{max-width:900px;margin:0 auto}
.rhead{text-align:center;margin-bottom:16px}
.rhead h1{font-family:var(--display);font-size:30px;margin:8px 0 4px}
.rhead .who{font-size:13px;color:var(--muted);font-weight:700}
.rgrid{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.rcard{background:#1A1C33;border:1px solid var(--line);border-radius:16px;padding:15px}
.rcard.full{grid-column:1/-1}
.rcard h3{font-size:12px;color:var(--brass);margin:0 0 10px;font-weight:900;letter-spacing:.04em}
.lvl{display:inline-block;font-family:var(--display);font-size:22px;color:var(--mint);margin-left:6px}
.rrow{display:flex;align-items:center;gap:6px;padding:7px 0;border-bottom:1px dashed #262A48;flex-wrap:wrap}
.rrow:last-child{border-bottom:none}
.rrow b{font-size:12.5px;font-weight:900;min-width:62px}
.rrow .n{font-size:11px;color:var(--brass);font-weight:900}
.record{font-size:13.5px;line-height:1.95;color:#E4E2EC;font-weight:500;background:#12142A;border:1px solid var(--line);border-radius:12px;padding:14px}
.mine{font-size:13.5px;line-height:1.85;color:#DCDAE8;font-weight:500;white-space:pre-wrap}
.praise{font-size:13.5px;line-height:1.8;color:var(--brass);font-weight:700;text-align:center;margin:14px 0 0}
.savechip{margin-left:8px;font-size:10px;font-weight:800;padding:4px 9px;border-radius:999px;
  border:1px solid var(--line);color:#7C82AB;white-space:nowrap}
.savechip.saving{border-color:rgba(255,201,60,.5);color:var(--brass)}
.savechip.ok{border-color:rgba(91,233,185,.45);color:var(--mint)}
.savechip.fail{border-color:rgba(255,122,107,.5);color:var(--coral)}
.savebar{margin-top:14px;padding:11px 14px;border-radius:12px;font-size:12.5px;font-weight:700;text-align:center;
  background:rgba(91,233,185,.09);border:1px solid rgba(91,233,185,.3);color:var(--mint)}
.savebar.fail{background:rgba(255,122,107,.1);border-color:rgba(255,122,107,.35);color:var(--coral)}
.racts{display:flex;gap:9px;justify-content:center;margin-top:16px;flex-wrap:wrap}
.racts button{padding:12px 18px;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;border:1px solid var(--line);background:#12142A;color:var(--paper)}
.racts button.primary{background:var(--brass);color:#1F1705;border-color:var(--brass)}

/* ── 인트로 하단 링크 ── */
.peekbtn{margin-top:14px;width:100%;padding:11px;border-radius:11px;background:transparent;
  border:1px dashed #3A3F68;color:var(--muted);font-size:12.5px;font-weight:700;cursor:pointer;transition:all .18s}
.peekbtn:hover{border-color:var(--mint);color:var(--mint)}
.teacherlink{margin-top:8px;width:100%;padding:9px;background:transparent;border:none;
  color:#5A608B;font-size:11.5px;font-weight:700;cursor:pointer}
.teacherlink:hover{color:var(--brass)}

/* ── 역할 선택 ── */
.role-card{max-width:560px}
.rolebtns{display:grid;gap:11px;margin:24px 0 16px;text-align:left}
.rolebtn{display:block;padding:20px;border-radius:18px;border:2px solid var(--line);
  background:#1A1C33;color:var(--paper);cursor:pointer;transition:all .18s}
.rolebtn:hover{transform:translateY(-3px)}
.rolebtn.student:hover{border-color:var(--mint);box-shadow:0 10px 28px rgba(91,233,185,.14)}
.rolebtn.teacher:hover{border-color:var(--brass);box-shadow:0 10px 28px rgba(255,201,60,.14)}
.rb-emoji{display:block;font-size:30px;margin-bottom:8px}
.rolebtn b{display:block;font-size:19px;font-weight:900;letter-spacing:-.01em;margin-bottom:5px}
.rb-desc{display:block;font-size:12.5px;color:var(--muted);font-weight:600;line-height:1.6;margin-bottom:11px}
.rb-go{display:block;font-size:12px;font-weight:800;padding-top:10px;border-top:1px dashed #2A2E4E}
.rolebtn.student .rb-go{color:var(--mint)}
.rolebtn.teacher .rb-go{color:var(--brass)}
.rolback{position:absolute;top:0;left:0;background:none;border:none;color:#6D7399;
  font-size:12px;font-weight:800;cursor:pointer;padding:4px 0}
.rolback:hover{color:var(--paper)}
.gate-card{position:relative;padding-top:26px}
.tlock{font-size:40px;margin-bottom:8px}
.title.sm{font-size:clamp(26px,7vw,36px)}
.tlerr{background:rgba(255,122,107,.12);border:1px solid rgba(255,122,107,.4);border-radius:11px;
  padding:11px 13px;color:var(--coral);font-size:12.5px;font-weight:700;line-height:1.6}
.tlnote{font-size:11px;color:#5A608B;font-weight:600;line-height:1.7;margin-top:14px}
.tlnote b{color:#7C82AB}
.tlerr div{margin-bottom:3px}
.tlerr div:last-child{margin-bottom:0}
.demobtn{margin-top:12px;width:100%;padding:12px;border-radius:12px;background:transparent;
  border:1px dashed #3A3F68;color:#8087B0;font-size:12.5px;font-weight:800;cursor:pointer}
.demobtn:hover{border-color:var(--mint);color:var(--mint)}

/* ── 우리 반 생각 대시보드 ── */
.board{position:relative;z-index:1;height:100%;overflow-y:auto;padding:24px 18px}
.board-in{max-width:640px;margin:0 auto}
.backbtn{background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:10px;
  padding:8px 14px;font-size:12.5px;font-weight:800;cursor:pointer;margin-bottom:18px}
.backbtn:hover{border-color:var(--mint);color:var(--mint)}
.board-head{text-align:center;margin-bottom:22px}
.board-head h1{font-size:28px;margin:10px 0 8px;letter-spacing:-.01em}
.board-sub{font-size:12.5px;color:var(--muted);line-height:1.75;font-weight:600;margin:0}
.board-msg{text-align:center;padding:34px 20px;color:var(--muted);font-size:13.5px;font-weight:700;line-height:1.8;
  background:#1A1C33;border:1px solid var(--line);border-radius:16px}

.bpanel{background:#1A1C33;border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:14px}
.bpanel h3{font-size:14px;margin:0 0 3px;font-weight:900;letter-spacing:-.01em}
.bpanel .bcap{font-size:11.5px;color:var(--muted);margin:0 0 14px;font-weight:600}

.stackbar{display:flex;height:34px;border-radius:11px;overflow:hidden;background:#12142A;border:1px solid var(--line)}
.stackseg{height:100%;transition:width .8s cubic-bezier(.22,1,.36,1);min-width:2px}
.seg-lib{background:var(--mint)}
.seg-mid{background:#565C86}
.seg-com{background:var(--brass)}
.stacklegend{display:flex;flex-direction:column;gap:9px;margin-top:14px}
.legitem{display:flex;align-items:center;gap:10px}
.legitem .dot{width:11px;height:11px;border-radius:50%;flex:0 0 11px}
.leg-lib .dot{background:var(--mint)}
.leg-mid .dot{background:#565C86}
.leg-com .dot{background:var(--brass)}
.legitem b{display:block;font-size:13px;font-weight:800}
.legitem span{display:block;font-size:11px;color:var(--muted);font-weight:600;margin-top:1px}

.bandrows{display:flex;flex-direction:column;gap:9px}
.bandrow{display:flex;align-items:center;gap:9px}
.bandname{flex:0 0 92px;font-size:11px;color:#9AA0C4;font-weight:700}
.bandname-w{flex:0 0 130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bandtrack{flex:1;height:10px;border-radius:99px;background:#12142A;border:1px solid var(--line);overflow:hidden}
.bandfill{height:100%;border-radius:99px;transition:width .8s cubic-bezier(.22,1,.36,1)}
.band-sLib, .band-lib{background:var(--mint)}
.band-mid{background:#565C86}
.band-com, .band-sCom{background:var(--brass)}
.band-topic{background:var(--coral)}
.bandpct{flex:0 0 40px;text-align:right;font-size:11.5px;font-weight:800;color:var(--paper)}

@media (max-width:640px){
  .fx{height:auto;min-height:100vh;overflow:visible}
  .room{grid-template-columns:1fr;height:auto}
  .rail{overflow:visible}
  .feed{height:52vh}
  .rgrid{grid-template-columns:1fr}
  .chip.hint{margin-left:0}
}
@media (prefers-reduced-motion:reduce){.fx *{animation:none!important;transition:none!important}}
      `}</style>

      {/* ── 0단계: 역할 선택 ─────────────────────────────────
          학생과 교사가 같은 주소로 들어오되 첫 화면에서 갈라진다.
          교사용은 코드를 요구하므로 학생이 눌러도 넘어갈 수 없다. */}
      {screen === "role" && (
        <div className="gate">
          <div className="gate-card role-card">
            <div className="eyebrow">통합사회 2 · Ⅱ-2 자유주의와 공동체주의 정의관</div>
            <h1 className="title disp oneline">다섯 사람의 눈<span className="q">.</span></h1>
            <p className="tagline">어떤 화면으로 들어갈까요?</p>

            <div className="rolebtns">
              <button className="rolebtn student" onClick={() => setScreen("intro")}>
                <span className="rb-emoji">🙋</span>
                <b>학생용</b>
                <span className="rb-desc">
                  AI 튜터 통크와 대화하며 다섯 사상가의 눈으로
                  현실 사례를 직접 설명해 봐요
                </span>
                <span className="rb-go">학번·이름 입력하고 시작 →</span>
              </button>

              <button className="rolebtn teacher" onClick={() => setScreen("teacherLogin")}>
                <span className="rb-emoji">📋</span>
                <b>교사용</b>
                <span className="rb-desc">
                  우리 반 학생들이 무엇을 어려워했는지 한눈에 보고,
                  다음 수업에서 누구에게 어떤 도움을 주면 좋을지 확인해요
                </span>
                <span className="rb-go">교사 코드 입력 필요 🔑</span>
              </button>
            </div>

            <button className="peekbtn" onClick={() => setScreen("dashboard")}>
              🗺️ 우리 반 생각 지도 먼저 보기
            </button>
          </div>
        </div>
      )}

      {/* ── 교사 로그인 ── */}
      {screen === "teacherLogin" && (
        <div className="gate">
          <div className="gate-card">
            <button className="rolback" onClick={() => { setScreen("role"); setTeacherPw(""); setTeacherErr(""); }}>
              ← 처음으로
            </button>
            <div className="tlock">🔑</div>
            <h1 className="title disp sm">교사용 대시보드</h1>
            <p className="tagline">
              학생 개인 데이터가 포함되어 있어 교사 코드가 필요합니다.
            </p>
            <div className="form">
              <div className="field">
                <label htmlFor="tpw">교사 코드</label>
                <input id="tpw" type="password" value={teacherPw}
                  onChange={(e) => { setTeacherPw(e.target.value); setTeacherErr(""); }}
                  onKeyDown={(e) => e.key === "Enter" && enterTeacher()}
                  placeholder="선생님이 설정한 코드" autoFocus />
              </div>
              {teacherErr && (
                <div className="tlerr">
                  {teacherErr.split("\n").map((ln, i) => <div key={i}>{ln}</div>)}
                </div>
              )}
              <button className="cta" disabled={!teacherPw.trim() || teacherBusy} onClick={enterTeacher}>
                {teacherBusy ? "확인하는 중…" : "들어가기"}
              </button>
            </div>
            <button className="demobtn" onClick={enterTeacherDemo}>
              🧪 데모 데이터로 화면 먼저 보기
            </button>
            <p className="tlnote">
              코드는 배포 환경변수(Vercel → Settings → Environment Variables)의
              <b> TEACHER_KEY</b> 값이에요.
              <br />바꾼 뒤에는 <b>다시 배포(Redeploy)</b>해야 적용됩니다.
            </p>
          </div>
        </div>
      )}

      {screen === "intro" && (
        <div className="gate">
          <div className="gate-card">
            <button className="rolback" onClick={() => setScreen("role")}>← 처음으로</button>
            <div className="eyebrow">통합사회 2 · Ⅱ-2 자유주의와 공동체주의 정의관</div>
            <h1 className="title disp oneline">다섯 사람의 눈<span className="q">.</span></h1>
            <p className="tagline">
              같은 사건도 누구의 눈으로 보느냐에 따라 답이 갈려요.
              <br />
              다섯 사람이 되어 통크에게 설명해 주세요.
            </p>
            <div className="five">
              <span className="l">롤스</span><span className="l">노직</span>
              <span className="c">매킨타이어</span><span className="c">샌델</span><span className="c">왈처</span>
            </div>
            <div className="hi"><Tongkeu size={44} /><span>안녕하세요, 통크예요.</span></div>
            <div className="form">
              <div className="row2">
                <div className="field">
                  <label htmlFor="sid">학번</label>
                  <input id="sid" value={form.sid} onChange={(e) => setForm({ ...form, sid: e.target.value })} placeholder="10312" inputMode="numeric" />
                </div>
                <div className="field">
                  <label htmlFor="name">이름</label>
                  <input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="김통사" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="nick">뭐라고 불러 줄까요?</label>
                <input id="nick" value={form.nick} onChange={(e) => setForm({ ...form, nick: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && start()} placeholder="예: 지민, 3반 반장" maxLength={14} />
              </div>
              <button className="cta" disabled={!canStart} onClick={start}>시작하기</button>
            </div>
            <button className="peekbtn" onClick={() => setScreen("dashboard")}>
              친구들은 어떻게 생각할까? 전체 결과 보기 →
            </button>
          </div>
        </div>
      )}

      {screen === "room" && !final && (
        <div className="room">
          <aside className="rail"><Rail /></aside>

          <main className="talk">
            <div className="talk-top">
              <Tongkeu size={38} mood={busy ? "think" : "idle"} />
              <div>
                <div className="who">통크</div>
                <div className="sub">{student.nick}님한테 배우는 중 · {stage}단계</div>
              </div>
              <div className="live"><i />{busy ? "생각 중" : "듣는 중"}</div>
              {saveState !== "off" && (
                <span className={`savechip ${saveState}`} title="구글 시트 저장 상태">
                  {saveState === "saving" ? "저장 중" : saveState === "fail" ? "저장 대기" : "자동 저장"}
                </span>
              )}
            </div>

            <div className="feed" ref={feedRef} aria-live="polite">
              {messages.map((m, i) => {
                const ai = m.role !== "user";
                if (m.kind === "case") {
                  const isLastCase = i === lastIdx || !messages.slice(i + 1).some((x) => x.kind === "case");
                  return (
                    <div key={i} className="turn ai">
                      <Tongkeu size={32} />
                      <div className="col">
                        <div className="casecard">
                          <span className="ct">사례 · {m.data.tag}</span>
                          <h4>{m.data.title}</h4>
                          <p>{m.data.text}</p>
                          {m.data.point && <div className="cpoint">쟁점 · {m.data.point}</div>}
                          <div className="abbox">
                            <div className="abrow"><span className="abtag">A</span>{m.data.a}</div>
                            <div className="abrow"><span className="abtag">B</span>{m.data.b}</div>
                          </div>
                          <div className="ask">이 사례는 누구 눈으로 보는 게 맞을까요?</div>
                          <div className="cand">
                            {m.data.cand.map((tid) => {
                              const t = T(tid);
                              const ok = doneOf(t);
                              return (
                                <button key={tid} className={`candbtn${isLastCase && selT === tid ? " sel" : ""}`}
                                  disabled={!isLastCase}
                                  onClick={() => { setSelT(tid); setPick(null); trackerRef.current?.markThinkerSelect(tid); }}>
                                  {ok ? "✓ " : ""}{t.name}
                                  <small>{t.tag}</small>
                                </button>
                              );
                            })}
                          </div>
                          <div className="candnote">셋 중에 안 맞는 사람도 있어요. 아래 ① 줄에서 다른 사람을 골라도 돼요.</div>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (m.kind === "conflictcard") {
                  return (
                    <div key={i} className="turn ai">
                      <Tongkeu size={32} />
                      <div className="col">
                        <div className="casecard">
                          <span className="ct">충돌 지점</span>
                          <h4>{m.data.title}</h4>
                          <p>{m.data.text}</p>
                          <div className="ask">두 정의관이 각각 어떻게 볼지 아래에 나눠서 적어 줄래요?</div>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className={`turn ${ai ? "ai" : "me"}`}>
                    {ai ? <Tongkeu size={32} /> : <div className="me-tag">{student.nick.slice(0, 2)}</div>}
                    <div className="col">
                      <Bubble text={m.content} ai={ai} />
                    </div>
                  </div>
                );
              })}
              {busy && (
                <div className="turn ai">
                  <Tongkeu size={32} mood="think" />
                  <div className="dots"><i /><i /><i /></div>
                </div>
              )}
            </div>

            {error && <div className="err">{error}</div>}

            <div className="compose">
              {phase === "warmup" && (
                <>
                  <div className="entry">
                    <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); beginWork(); } }}
                      placeholder="통크한테 답해 주세요. 아래 버튼을 눌러도 돼요." />
                    <button className="send" disabled={!draft.trim()} onClick={() => beginWork()}>보내기</button>
                  </div>
                  <div className="subrow">
                    <button className="chip go" onClick={() => beginWork("좋아, 내가 알려줄게!")}>좋아, 내가 알려줄게!</button>
                    <button className="chip" onClick={() => beginWork("나도 아직 헷갈리는데, 같이 해 보자.")}>나도 헷갈리는데 같이 해 보자</button>
                  </div>
                </>
              )}

              {phase === "work" && stage === 1 && (
                <>
                  <div className="pk">
                    <div className="pkrow">
                      <span className="pklabel">① 누구 눈으로</span>
                      {THINKERS.map((t) => (
                        <button key={t.id} className={`tbtn${selT === t.id ? " sel" : ""}${doneOf(t) ? " ok" : ""}`}
                          onClick={() => { setSelT(t.id); setPick(null); trackerRef.current?.markThinkerSelect(t.id); }}>
                          {doneOf(t) ? "✓ " : ""}{t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  {selT && curCase && (
                    <div className="askbox">
                      <div className="askq">
                        {T(selT).name}{T(selT).josa} 이 사례에 대해서 A와 B 중 어떻게 하자고 말할까요?
                      </div>
                      <div className="abrow sm"><span className="abtag">A</span>{curCase.a}</div>
                      <div className="abrow sm"><span className="abtag">B</span>{curCase.b}</div>
                      <div className="askwant">{T(selT).name}의 생각을 알고 싶어요.</div>
                    </div>
                  )}
                  {selT && (
                    <div className="scaffold">
                      <button className="sc-toggle" onClick={() => {
                        const nx = !showScaffold;
                        setShowScaffold(nx);
                        if (nx) trackerRef.current?.markScaffoldOpen("stage1");
                      }}>
                        ✍️ 어떻게 쓸지 모르겠어요 {showScaffold ? "▲" : "▼"}
                      </button>
                      {showScaffold && (
                        <div className="sc-list">
                          <div className="sc-note">문장을 눌러 시작만 하고, 나머지는 직접 채워 보세요.</div>
                          {SCAFFOLDS.stage1(T(selT).name).map((tpl, i) => (
                            <button key={i} className="sc-item" onClick={() => {
                              trackerRef.current?.markScaffoldInsert("stage1", tpl);
                              trackerRef.current?.markFirstKeystroke();
                              setDraft(tpl);
                            }}>{tpl}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="entry">
                    <textarea rows={3} value={draft}
                      onChange={(e) => { if (!draft && e.target.value) trackerRef.current?.markFirstKeystroke(); setDraft(e.target.value); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitStage1(); } }}
                      placeholder={selT ? `A인지 B인지 고르고, 왜 그렇게 말할지 알려 주세요. 개념어를 몰라도 내 말로 쓰면 돼요.` : "위에서 사상가를 먼저 골라 주세요."} />
                    <button className="send" disabled={busy || !selT || !draft.trim()} onClick={submitStage1}>알려주기</button>
                  </div>
                  <div className="subrow">
                    <button className="chip" disabled={busy} onClick={() => postCase(pickCase(cleared, usedCases))}>다른 사례 주세요</button>
                    <button className="chip hint" disabled={busy || hintsLeft <= 0} onClick={useHint}>
                      {hintsLeft > 0 ? `힌트 (${hintsLeft}번 남음)` : "힌트 다 썼어요"}
                    </button>
                  </div>
                </>
              )}

              {phase === "work" && stage === 2 && (
                conflict ? (
                  <>
                    <div className="two">
                      <div className="lib">
                        <label>자유주의적 정의관은 이렇게 볼 거예요</label>
                        <textarea rows={2} value={libText}
                          onChange={(e) => { if (!libText && e.target.value) trackerRef.current?.markFirstKeystroke(); setLibText(e.target.value); }}
                          placeholder="롤스나 노직의 개념을 써서 적어 주세요." />
                        <div className="sc-mini">
                          {SCAFFOLDS.lib.map((tpl, i) => (
                            <button key={i} onClick={() => {
                              trackerRef.current?.markScaffoldInsert("stage2-lib", tpl);
                              trackerRef.current?.markFirstKeystroke();
                              setLibText(tpl);
                            }}>✍️ {tpl.slice(0, 22)}…</button>
                          ))}
                        </div>
                      </div>
                      <div className="com">
                        <label>공동체주의적 정의관은 이렇게 볼 거예요</label>
                        <textarea rows={2} value={comText}
                          onChange={(e) => { if (!comText && e.target.value) trackerRef.current?.markFirstKeystroke(); setComText(e.target.value); }}
                          placeholder="매킨타이어, 샌델, 왈처의 개념을 써서 적어 주세요." />
                        <div className="sc-mini">
                          {SCAFFOLDS.com.map((tpl, i) => (
                            <button key={i} onClick={() => {
                              trackerRef.current?.markScaffoldInsert("stage2-com", tpl);
                              trackerRef.current?.markFirstKeystroke();
                              setComText(tpl);
                            }}>✍️ {tpl.slice(0, 22)}…</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <button className="send" style={{ width: "100%" }} disabled={busy || !libText.trim() || !comText.trim()} onClick={submitStage2}>
                      두 입장 알려주기
                    </button>
                  </>
                ) : (
                  <div className="subrow"><span className="pklabel">왼쪽에서 부딪히는 자리를 하나 골라 주세요.</span></div>
                )
              )}

              {phase === "work" && stage === 3 && (
                <div className="entry">
                  <textarea rows={3} value={draft}
                    onChange={(e) => { if (!draft && e.target.value) trackerRef.current?.markFirstKeystroke(); setDraft(e.target.value); }}
                    placeholder="정답은 없어요. 내 기준과 그 이유를 편하게 적어 주세요." />
                  <button className="send" disabled={busy || !draft.trim()} onClick={submitStage3}>정리해서 보내기</button>
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {final && screen === "room" && (
        <div className="result">
          <div className="rin">
            <div className="rhead">
              <Tongkeu size={64} />
              <h1 className="disp">활동을 모두 마쳤어요</h1>
              <div className="who">{student.sid} · {student.name}</div>
            </div>

            <div className="rgrid">
              <div className="rcard">
                <h3>1단계 · 다섯 사람 이론으로 설명<span className="lvl">{final.level1}</span></h3>
                {THINKERS.map((t) => (
                  <div key={t.id} className="rrow">
                    <b>{t.name}</b>
                    <span className="n">{cleared[t.id].length ? "설명 완료" : "미점검"}</span>
                    <div className="kchips">
                      {cleared[t.id].length ? cleared[t.id].map((c) => <span key={c} className="kchip">{c}</span>) : <span className="kchip">-</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rcard">
                <h3>2단계 · 두 정의관의 충돌<span className="lvl">{final.level2}</span></h3>
                <div className="mine">{conflict ? conflict.title : "-"}</div>
                <div style={{ height: 12 }} />
                <h3>내 생각 저울</h3>
                <ThoughtScale tilt={tilt} />
                <div className="meter">
                  <div className="meter-track"><div className="meter-dot" style={{ left: `${meterPct}%` }} /></div>
                  <div className="meter-marks"><span>자유주의</span><span>둘 다</span><span>공동체주의</span></div>
                </div>
              </div>

              <div className="rcard full">
                <h3>3단계 · 내가 세운 분배 기준</h3>
                <div className="mine">{stage3Text || "-"}</div>
              </div>

              <div className="rcard full">
                <h3>과목별 세부능력 및 특기사항</h3>
                <div className="record">{final.record}</div>
                {final.praise && <p className="praise">{final.praise}</p>}
              </div>
            </div>

            {dbState !== "idle" && (
              <div className={`savebar ${dbState === "fail" ? "fail" : ""}`}>
                {dbState === "saving" && "결과를 저장하는 중이에요…"}
                {dbState === "ok" && "✅ 선생님께 결과가 제출되었어요."}
                {dbState === "fail" && (
                  <>
                    아직 제출되지 않았어요{dbError ? ` (${dbError})` : ""}.
                    <br />아래 <b>결과지 저장하기</b>로 파일을 내려받아 선생님께 전달해 주세요.
                  </>
                )}
              </div>
            )}
            {!supabaseReady && (
              <div className="savebar fail">
                데이터베이스가 연결되지 않아 결과가 저장되지 않았어요.
                <br />아래 <b>결과지 저장하기</b>로 파일을 내려받아 주세요.
              </div>
            )}
            <div className="racts">
              <button className="primary" onClick={downloadAll}>결과지 저장하기</button>
              <button onClick={copyAll}>{copied ? "복사했어요" : "전체 복사하기"}</button>
              {saveState === "fail" && <button onClick={flushPending}>시트에 다시 보내기</button>}
            </div>
            <button className="peekbtn" style={{ marginTop: 14 }} onClick={() => setScreen("dashboard")}>
              우리 반은 어떻게 생각할까? 전체 결과 보기 →
            </button>
          </div>
        </div>
      )}

      {screen === "dashboard" && <ClassDashboard onBack={() => setScreen(student ? "room" : "role")} />}
    </div>
  );
}
