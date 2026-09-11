#!/bin/bash
# 약 체크 — 시간대별 미복용 알림 (시놀로지 작업 스케줄러에서 호출)
#
#   사용법:  check-meds.sh <morning|lunch|dinner|night> [--test]
#   --test 는 미복용 여부와 무관하게 알림을 한 번 보낸다 (ntfy 배선 확인용).
#
# 설계 메모:
#  - jq 에 의존하지 않는다. DSM 에 기본 설치돼 있지 않은 경우가 있어서 sed/grep 으로 판다.
#  - ntfy 본문에 '약 이름'은 절대 넣지 않는다. 토픽이 추측 불가라도 ntfy.sh 는 공개 릴레이다.
#    약 이름은 NAS 로컬 로그에만 남긴다. 사람 이름(엄마/나 같은 별칭)은 의료정보가 아니라 포함한다.
#  - 실패하면 0이 아닌 코드로 죽는다 → DSM 작업 스케줄러의 "실패 시 메일 알림"이 걸린다.

set -euo pipefail

SLOT="${1:-}"
MODE="${2:-}"
case "$SLOT" in
  morning|lunch|dinner|night|anytime) ;;
  *) echo "사용법: $(basename "$0") <morning|lunch|dinner|night> [--test]" >&2; exit 2 ;;
esac

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"
[ -f "$ENV_FILE" ] || { echo "설정 파일이 없습니다: $ENV_FILE (.env.example 을 복사해서 채우세요)" >&2; exit 2; }
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${SUPABASE_URL:?}" "${SUPABASE_ANON_KEY:?}" "${MEDS_EMAIL:?}" "${MEDS_PASSWORD:?}" "${NTFY_TOPIC:?}"
APP_URL="${APP_URL:-https://hachori.github.io/morning-meds/}"
NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"
LOG_FILE="${LOG_FILE:-$DIR/check-meds.log}"

log() { printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$SLOT" "$*" >>"$LOG_FILE"; }
die() { log "실패: $*"; echo "check-meds($SLOT) 실패: $*" >&2; exit 1; }

case "$SLOT" in
  morning) LABEL="아침" ;;
  lunch)   LABEL="점심" ;;
  dinner)  LABEL="저녁" ;;
  night)   LABEL="자기 전" ;;
  anytime) LABEL="" ;;
esac

CURL=(curl --fail --silent --show-error --max-time 20)

# --- 1) 로그인 → access_token ---------------------------------------------
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

AUTH=$("${CURL[@]}" -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$(json_escape "$MEDS_EMAIL")\",\"password\":\"$(json_escape "$MEDS_PASSWORD")\"}") \
  || die "Supabase 로그인 요청 실패"

TOKEN=$(printf '%s' "$AUTH" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || die "access_token 을 못 받았습니다 (이메일/비밀번호 확인)"

# --- 2) 미복용 조회 --------------------------------------------------------
PENDING=$("${CURL[@]}" -X POST "$SUPABASE_URL/rest/v1/rpc/pending_meds" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"p_slot\":\"$SLOT\"}") || die "pending_meds 조회 실패"

# grep 은 매칭 0건이면 exit 1 을 낸다. 미복용 0건이 정상 경로이므로 `|| true` 로 흡수한다.
COUNT=$( { printf '%s' "$PENDING" | grep -o '"med_name": *"' || true; } | wc -l | tr -d ' ')

# 로컬 로그에만 약 이름을 남긴다 (ntfy 본문에는 넣지 않는다)
NAMES_LOG=$( { printf '%s' "$PENDING" | grep -o '"med_name": *"[^"]*"' || true; } \
  | sed 's/^"med_name": *"//; s/"$//' \
  | tr '\n' ',' | sed 's/,$//; s/,/, /g')

if [ "$COUNT" -eq 0 ] && [ "$MODE" != "--test" ]; then
  log "미복용 없음 — 알림 생략"
  exit 0
fi
log "미복용 ${COUNT}건: ${NAMES_LOG:-(없음)}"

# --- 3) ntfy 발송 ----------------------------------------------------------
PERSONS=$( { printf '%s' "$PENDING" | grep -o '"person_name": *"[^"]*"' || true; } \
  | sed 's/^"person_name": *"//; s/"$//' \
  | awk '!seen[$0]++' | tr '\n' ',' | sed 's/,$//; s/,/, /g')

if [ "$MODE" = "--test" ]; then
  BODY="[테스트] ${LABEL} 알림 배선 확인 — 미복용 ${COUNT}건"
elif [ -n "$PERSONS" ]; then
  BODY="${PERSONS} — ${LABEL} 약 ${COUNT}개가 아직 체크되지 않았어요"
else
  BODY="${LABEL} 약 ${COUNT}개가 아직 체크되지 않았어요"
fi

"${CURL[@]}" \
  -H "Title: 💊 ${LABEL} 약" \
  -H "Tags: pill" \
  -H "Click: $APP_URL" \
  -H "Priority: default" \
  -d "$BODY" \
  "$NTFY_SERVER/$NTFY_TOPIC" >/dev/null || die "ntfy 발송 실패"

log "알림 전송: $BODY"
