-- ═══════════════════════════════════════════════════════════════
--  「다섯 사람의 눈」 Supabase 스키마
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. 결과 테이블 ────────────────────────────────────────────
create table if not exists public.five_eyes_results (
  id                bigint generated always as identity primary key,

  -- 학생 식별
  sid               text        not null,              -- 학번
  name              text        not null,              -- 이름
  nick              text,                              -- 통크가 부르는 호칭

  -- 1단계
  cleared_thinkers  jsonb       not null default '{}'::jsonb,
                                -- { "rawls": ["무지의 베일"], "nozick": [...] }

  -- 2단계
  conflict_title    text,                              -- 고른 충돌 지점
  conflict_level    smallint,                          -- 난이도 1~3

  -- 최종 성향
  tilt_value        smallint,                          -- -100(자유주의) ~ 100(공동체주의)

  -- 3단계
  stage3_text       text,                              -- 학생이 세운 분배 기준

  -- 평가
  level1            text,                              -- 상 / 중 / 하
  level2            text,                              -- 상 / 중 / 하
  record_text       text,                              -- 과목별 세부능력 및 특기사항
  praise_text       text,                              -- 통크의 격려 문구

  -- 전체 기록
  full_messages     jsonb       not null default '[]'::jsonb,
  analytics         jsonb       default '{}'::jsonb,   -- 학습분석 지표 + 알림
  session_id        text,

  created_at        timestamptz not null default now()
);

-- 조회 성능 (교사 대시보드에서 최신순·학번순 조회)
create index if not exists idx_five_eyes_created  on public.five_eyes_results (created_at desc);
create index if not exists idx_five_eyes_sid      on public.five_eyes_results (sid);

comment on table public.five_eyes_results is
  '통합사회2 Ⅱ-2 「다섯 사람의 눈」 학생 활동 결과';


-- ── 2. 행 수준 보안(RLS) ──────────────────────────────────────
--  이 앱은 브라우저에서 Supabase 를 직접 호출하지 않습니다.
--  저장·조회 모두 서버리스 함수(/api/submit, /api/results)가
--  service_role 키로 수행하므로, anon 에게는 아무 권한도 주지
--  않습니다. RLS 를 켜고 정책을 하나도 만들지 않으면 anon 은
--  이 테이블에 접근할 수 없습니다.
--
--  즉, 설령 누군가 anon 키를 알아내도 이 테이블은 열리지 않습니다.
--  (service_role 키는 RLS 를 우회하므로 서버 함수는 정상 동작합니다.)
alter table public.five_eyes_results enable row level security;

-- 이전 버전에서 만든 정책이 있다면 제거
drop policy if exists "students can insert own result" on public.five_eyes_results;
drop policy if exists "no anon select"                 on public.five_eyes_results;

--  정책을 만들지 않습니다. 이것이 의도한 상태입니다.
--
--  ※ 만약 브라우저에서 anon 키로 직접 INSERT 하는 구조로 바꾼다면
--    아래 정책을 추가해야 합니다. (현재 구조에서는 불필요)
--
--    create policy "anon can insert only"
--      on public.five_eyes_results for insert to anon
--      with check (char_length(sid) between 1 and 20
--              and char_length(name) between 1 and 20);


-- ── 3. 확인용 조회 (SQL Editor 에서 직접 실행) ────────────────
-- select sid, name, level1, level2, conflict_title, tilt_value, created_at
--   from public.five_eyes_results
--  order by created_at desc;

-- 학생별 최신 제출만 보기
-- select distinct on (sid, name) *
--   from public.five_eyes_results
--  order by sid, name, created_at desc;
