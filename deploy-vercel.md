# 설치 및 Vercel 배포 가이드

---

## 🔒 API 키는 코드에 들어가지 않습니다

이 프로젝트는 **브라우저로 내려가는 코드에 어떤 비밀값도 포함하지 않습니다.**

```
학생 브라우저 ──▶ /api/chat    ──▶ OpenRouter   (OPENROUTER_API_KEY)
              ──▶ /api/submit  ──▶ Supabase     (SERVICE_ROLE_KEY)
교사 브라우저 ──▶ /api/results ──▶ Supabase     (SERVICE_ROLE_KEY + TEACHER_KEY)
     ↑                              ↑
  키 없음                    키는 서버 환경변수에만
```

**왜 이렇게 했나요.** Vite 는 `VITE_` 접두사가 붙은 환경변수를 빌드 결과물에
문자열로 그대로 박아 넣습니다. `VITE_OPENROUTER_API_KEY` 를 쓰면 학생이
`F12 → Sources` 만 열어도 키가 보이고, 복사해 가면 선생님 계정으로 요금이
청구됩니다. Supabase `anon` 키도 마찬가지로, RLS 설정이 조금이라도
느슨하면 다른 학생의 세특까지 읽힙니다.

그래서 **키를 쓰는 코드를 전부 서버(`api/` 폴더)로 옮겼습니다.**

| 환경변수 | 위치 | 브라우저 노출 |
|---|---|---|
| `OPENROUTER_API_KEY` | 서버 | ❌ |
| `SUPABASE_URL` | 서버 | ❌ |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 | ❌ |
| `TEACHER_KEY` | 서버 | ❌ |
| `VITE_OPENROUTER_MODEL` | 클라이언트 | ⭕ (모델 이름일 뿐, 비밀값 아님) |

`VITE_` 가 붙은 변수는 **모델 이름 하나뿐**입니다.

### 직접 확인해 보기

배포 후 브라우저에서 `F12 → Sources → assets/index-*.js` 를 열고
`Ctrl+F` 로 `sk-or` 또는 `eyJhbGci` 를 검색해 보세요. 아무것도 나오지
않아야 정상입니다.

## 1. 설치

```bash
git clone https://github.com/<사용자명>/five-eyes.git
cd five-eyes
npm install
```

`npm install` 로 함께 설치되는 것:

```
react  react-dom  vite  @vitejs/plugin-react
```

Supabase 접근은 서버리스 함수가 `fetch` 로 직접 처리하므로
`@supabase/supabase-js` 패키지는 필요하지 않습니다.
설치할 의존성이 적을수록 학교 환경에서 빌드가 안정적입니다.

---

## 2. Supabase 준비

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성
2. 좌측 **SQL Editor** → **New query** → `supabase-schema.sql` 내용을 붙여넣고 **RUN**
3. **Project Settings → API** 에서 세 값을 복사

| 항목 | 어디에 쓰나 |
|---|---|
| `Project URL` | `VITE_SUPABASE_URL` |
| `anon public` | `VITE_SUPABASE_ANON_KEY` |
| `service_role` | `SUPABASE_SERVICE_ROLE_KEY` (⚠️ 서버 전용) |

> **`service_role` 키에는 절대 `VITE_` 를 붙이지 마세요.**
> 이 키는 RLS 를 우회하는 마스터 키라, 브라우저로 내려가면 누구나 전체
> 학생 데이터를 읽고 지울 수 있습니다.

---

## 3. 로컬 실행

```bash
cp .env.example .env
```

`.env` 를 열어 값을 채웁니다. 모두 서버 전용 변수입니다.

```bash
OPENROUTER_API_KEY=sk-or-v1-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
TEACHER_KEY=원하는코드
```

**서버리스 함수까지 함께 띄워야 동작합니다.** 화면만 띄우는
`npm run dev` 로는 `/api/chat` 이 없어 통크가 응답하지 않습니다.

```bash
npm i -g vercel
vercel dev          # http://localhost:3000
```

## 4. Vercel 배포

### 4-1. GitHub 에 올리기

```bash
git init
git add .
git commit -m "다섯 사람의 눈 - OpenRouter + Supabase"
git branch -M main
git remote add origin https://github.com/<사용자명>/five-eyes.git
git push -u origin main
```

`.gitignore` 가 `.env` 와 `node_modules` 를 제외하므로 키는 올라가지 않습니다.

### 4-2. Vercel 에 연결

1. [vercel.com](https://vercel.com) → **Add New → Project**
2. GitHub 저장소 선택 → **Import**
3. 빌드 설정은 `vercel.json` 에 있어 자동으로 채워집니다
   (Framework: Vite / Build: `npm run build` / Output: `dist`)
4. **Deploy** 를 누르기 전에 아래 환경변수를 먼저 등록합니다

### 4-3. 환경변수 등록 (필수)

**Settings → Environment Variables** 에서 등록합니다.
**`VITE_` 를 붙이는 것은 모델 이름 하나뿐**이라는 점에 주의하세요.

| Key | Value | 비고 |
|---|---|---|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | 서버 전용 |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | 서버 전용 |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` | 서버 전용 |
| `TEACHER_KEY` | 직접 정한 코드 | 서버 전용 |
| `SITE_URL` | 배포 주소 | 선택 |
| `VITE_OPENROUTER_MODEL` | `anthropic/claude-3.5-sonnet` | 선택, 공개되어도 무방 |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` 나 `OPENROUTER_API_KEY` 앞에 실수로
> `VITE_` 를 붙이면 그 즉시 브라우저에 노출됩니다. 반드시 접두사 없이
> 등록해 주세요.

환경변수는 **등록한 다음 배포부터** 적용됩니다. 이미 배포했다면
**Deployments → 맨 위 배포 → ⋯ → Redeploy** 를 눌러 주세요.

---

## 5. 동작 확인

1. 배포된 주소 접속 → 첫 화면에서 **🙋 학생용 / 📋 교사용** 이 보이는지
2. 학생용으로 들어가 학번·이름 입력 → 통크가 대답하면 **OpenRouter 연동 성공**
3. 3단계까지 마치면 결과 화면에 **"✅ 선생님께 결과가 제출되었어요"** 표시
4. Supabase → **Table Editor → five_eyes_results** 에 행이 쌓였는지 확인
5. 교사용으로 들어가 `TEACHER_KEY` 입력 → 학생 목록이 보이면 성공

### 잘 안 될 때

| 증상 | 확인할 것 |
|---|---|
| 통크가 대답하지 않음 | Vercel **Logs → Functions → chat** 에서 오류 확인. `OPENROUTER_API_KEY` 철자와 잔액 |
| "아직 제출되지 않았어요" | `VITE_SUPABASE_URL`·`ANON_KEY` 확인. `supabase-schema.sql` 의 RLS INSERT 정책이 적용됐는지 |
| 교사 코드가 안 먹힘 | `TEACHER_KEY` 를 등록하고 **재배포**했는지 |
| 교사 화면이 비어 있음 | `SUPABASE_SERVICE_ROLE_KEY` 확인. 학생 제출이 실제로 있는지 |
| 새로고침 시 404 | `vercel.json` 의 rewrites 가 적용됐는지 |

---

## 6. Netlify 를 쓰신다면

`api/` 폴더를 `netlify/functions/` 로 옮기고 시그니처만 바꾸면 됩니다.

```js
// Vercel
export default async function handler(req, res) { ... }

// Netlify
exports.handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  return { statusCode: 200, body: JSON.stringify(result) };
};
```

그리고 `netlify.toml` 을 추가합니다.

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## 7. 비용 관련

OpenRouter 는 사용량 과금입니다. `anthropic/claude-3.5-sonnet` 기준으로
학생 1명이 전체 활동(약 15~20턴)을 마치면 대략 **$0.05~0.15** 정도입니다.
30명 한 학급이면 **$2~5** 수준입니다.

- [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits) 에서
  **사용 한도(Credit limit)** 를 미리 걸어 두시길 권합니다
- 더 저렴한 모델로 바꾸려면 `VITE_OPENROUTER_MODEL` 값만 교체하면 됩니다
  (예: `anthropic/claude-3.5-haiku`, `google/gemini-flash-1.5`)
