# 💊 약 체크

매일 먹는 약의 복용 현황을 보여주는 개인용 대시보드입니다.
터치 한 번으로 복용 체크, 다시 터치하면 취소. 기록은 캘린더로 확인할 수 있어요.

- **오늘**: 오늘 먹을 약 목록 + 진행 바. 카드를 터치하면 복용 완료(시각 기록), 다시 터치하면 취소
- **기록**: 월 캘린더 — 전부 복용 ●(초록) / 일부 ◐(노랑) / 미복용 ○(회색). 날짜를 누르면 상세
- **약 관리**: 약 추가/수정/삭제 (삭제해도 과거 기록은 보존)
- 폰/PC 반응형, 다크 모드 지원, 폰 홈 화면에 앱처럼 추가 가능

## 구조 (전부 무료)

- 프론트엔드: 정적 HTML/CSS/JS — GitHub Pages 또는 Netlify(무료)에 호스팅
- DB + 로그인: [Supabase](https://supabase.com) 무료 플랜 (Postgres)
- `config.js`가 비어 있으면 **데모 모드**로 동작 — 서버 없이 이 기기 브라우저(localStorage)에만 저장됩니다. 화면을 먼저 써보고 싶을 때 유용해요.

## 설정 방법

### 1. Supabase 준비 (약 10분, 무료)

1. https://supabase.com 가입 → **New project** 생성 (리전은 Northeast Asia (Seoul) 추천)
2. 왼쪽 메뉴 **SQL Editor** → 이 폴더의 `setup.sql` 내용 전체를 붙여넣고 **Run**
3. **Authentication → Users → Add user** 로 본인이 쓸 이메일/비밀번호 계정 1개 생성
   - "Auto Confirm User" 체크
4. **Authentication → Sign In / Providers** 에서 **"Allow new users to sign up" 을 꺼주세요** (중요 — 다른 사람이 가입해서 내 데이터를 보는 것을 막습니다)
5. **Project Settings → API** 에서 `Project URL`과 `anon public` 키를 복사해 `config.js`에 입력:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
};
```

### 2. 배포 (둘 중 하나)

**A. Netlify Drop (가장 쉬움, 계정만 있으면 드래그 한 번)**
1. https://app.netlify.com/drop 접속
2. 이 폴더를 통째로 드래그 → 몇 초 뒤 `https://xxx.netlify.app` 주소가 생깁니다

**B. GitHub Pages**
1. GitHub에 저장소 생성 후 이 폴더 파일들을 push
2. 저장소 **Settings → Pages** → Branch를 `main`으로 설정
3. `https://<아이디>.github.io/<저장소>/` 로 접속

### 3. 폰에서 쓰기

1. 폰 브라우저로 배포 주소 접속 → 로그인 (기기당 최초 1회)
2. **홈 화면에 추가** (iOS: 공유 → 홈 화면에 추가 / Android: 메뉴 → 앱 설치)

## 로컬에서 실행해 보기

```bash
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```

## 참고

- Supabase 무료 프로젝트는 **7일간 요청이 없으면 일시정지**됩니다. 매일 쓰면 문제 없고, 정지되면 Supabase 대시보드에서 Restore 클릭 한 번으로 재개됩니다.
- 날짜 기준은 기기의 로컬 시간대이며, 하루에 약별 1회 체크 모델입니다.
