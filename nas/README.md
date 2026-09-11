# NAS 복약 알림 설정

시놀로지(DS920+)가 정해진 시각에 Supabase를 확인해서, **아직 체크되지 않은 약이 있을 때만** 아이폰으로 푸시를 보냅니다.

```
[DSM 작업 스케줄러]  아침 08:00 / 점심 12:30 / 저녁 17:30 / 자기 전 21:30
        ↓
[check-meds.sh <slot>]
        ├─ Supabase 로그인 → access_token
        ├─ pending_meds(slot) 조회
        └─ 미복용이 있으면 ↓
[ntfy.sh]  →  아이폰 ntfy 앱
```

전부 무료입니다. 새로 결제할 서비스는 없습니다.

## 0. 먼저 Supabase에 마이그레이션

Supabase 대시보드 > SQL Editor 에 저장소 루트의 **`migrate-slot.sql`** 전체를 붙여넣고 Run.
`intake_logs`는 건드리지 않으므로 과거 기록은 그대로 보존됩니다.

## 1. `.env` 채우기

NAS의 `/volume1/homes/hachori/morning-meds/.env` 를 열어 **비밀번호만** 채우면 됩니다.
나머지 값(Supabase URL·키·ntfy 토픽)은 이미 들어가 있습니다.

```bash
ssh nas
vi /volume1/homes/hachori/morning-meds/.env   # MEDS_EMAIL, MEDS_PASSWORD 입력
chmod 600 .env                                 # 이미 600이지만 확인
```

앱에 로그인할 때 쓰는 그 계정입니다. 파일은 `.gitignore`에 걸려 있어 커밋되지 않습니다.

## 2. 아이폰에 ntfy 설치·구독

1. App Store에서 **ntfy** 설치 (무료)
2. `+` → **Subscribe to topic**
3. `.env`의 `NTFY_TOPIC` 값을 그대로 입력
4. 알림 권한 허용

> **토픽 이름이 곧 비밀번호입니다.** ntfy.sh는 공개 릴레이라, 토픽을 아는 사람은 누구나 구독할 수 있습니다.
> 그래서 알림 본문에는 **약 이름을 넣지 않습니다** — 사람 이름과 개수만 보냅니다("나 — 저녁 약 2개가 아직 체크되지 않았어요").
> 약 이름은 NAS의 `check-meds.log`에만 남습니다.

## 3. 배선 테스트

구독까지 끝낸 뒤, 미복용 여부와 관계없이 알림을 한 번 쏴봅니다.

```bash
ssh nas
/volume1/homes/hachori/morning-meds/check-meds.sh dinner --test
```

아이폰에 알림이 뜨면 성공입니다. 알림을 탭하면 약 체크 앱이 열립니다.
그다음 `--test` 없이 실행해서 실제 동작도 확인하세요 — 오늘 저녁 약을 이미 체크했다면 **아무 일도 일어나지 않는 것이 정상**입니다.

```bash
/volume1/homes/hachori/morning-meds/check-meds.sh dinner
cat /volume1/homes/hachori/morning-meds/check-meds.log
```

## 4. DSM 작업 스케줄러 등록

**제어판 → 작업 스케줄러 → 생성 → 예약된 작업 → 사용자 정의 스크립트**

시간대마다 하나씩, 총 4개를 만듭니다.

| 작업 이름 | 시각 | 스크립트 |
|---|---|---|
| 약 알림 - 아침 | 08:00 | `/volume1/homes/hachori/morning-meds/check-meds.sh morning` |
| 약 알림 - 점심 | 12:30 | `/volume1/homes/hachori/morning-meds/check-meds.sh lunch` |
| 약 알림 - 저녁 | 17:30 | `/volume1/homes/hachori/morning-meds/check-meds.sh dinner` |
| 약 알림 - 자기 전 | 21:30 | `/volume1/homes/hachori/morning-meds/check-meds.sh night` |

각 작업마다:

- **일반 → 사용자**: `hachori` (root 아님 — `.env`를 읽어야 합니다)
- **스케줄**: 매일 반복, 위 표의 시각
- **작업 설정 → "실행 세부 정보를 이메일로 보내기"**: 체크하고, 바로 아래 **"비정상 종료된 경우에만 보내기"**도 체크

마지막 항목이 중요합니다. 복약 알림에서 가장 무서운 건 **조용한 실패**인데, 이걸 켜두면 스크립트가 죽었을 때 메일이 옵니다.

## 시간을 바꾸려면

두 곳을 같이 고쳐야 화면과 실제 알림이 어긋나지 않습니다.

1. DSM 작업 스케줄러의 시각 (실제 알림이 울리는 시각)
2. `app.js`의 `SLOTS` 배열에 있는 `time` 값 (앱 화면에 표시되는 시각)

## 문제가 생기면

```bash
tail -20 /volume1/homes/hachori/morning-meds/check-meds.log
```

| 로그/증상 | 원인 |
|---|---|
| `access_token 을 못 받았습니다` | `.env`의 이메일/비밀번호가 틀림 |
| `pending_meds 조회 실패` | `migrate-slot.sql`을 아직 안 돌림 |
| `ntfy 발송 실패` | NAS가 인터넷에 못 나감 |
| 로그는 정상인데 폰에 안 옴 | ntfy 앱의 토픽 오타, 또는 알림 권한 꺼짐 |
| 아무 로그도 안 남음 | 작업 스케줄러가 꺼져 있거나 사용자가 `hachori`가 아님 |

Supabase 무료 플랜은 7일간 요청이 없으면 일시정지되는데, 이 스크립트가 매일 찔러주므로 자동으로 깨어 있는 상태가 유지됩니다.
