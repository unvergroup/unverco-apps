#!/usr/bin/env bash
# Tek komut telefon QA: web (Playwright 3 motor, 11 profil) + Android emulatoru (API 28/34) + iOS (WebKit + simulator).
# Kullanim:  qa/telefon-test.sh [app_ref]
#   app_ref  (istege bagli) uygulama klasorlerini bu commit/etiketten al (bos = main'in guncel hali)
# Ortam degiskenleri: QA_REF (dal, vars. main) QA_ONLY ("web,android,ios" alt kumesi) QA_TIMEOUT (sn, vars. 1500)
#   QA_QUEUE_LIMIT (macOS/runner kuyruk siniri sn, vars. 900) QA_MACOS (macos-latest|macos-15|macos-14) QA_REPO
# Cikis kodu: 0 hepsi gecti | 1 urun hatasi (KALDI) | 2 altyapi ya da zaman asimi. Gerekli: gh (giris yapmis), jq, python3.
set -u
REPO="${QA_REPO:-unvergroup/unverco-apps}"; REF="${QA_REF:-main}"; APP_REF="${1:-}"
ONLY="${QA_ONLY:-web,android,ios}"; TIMEOUT="${QA_TIMEOUT:-1500}"; QLIMIT="${QA_QUEUE_LIMIT:-900}"; MACOS="${QA_MACOS:-macos-latest}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ID="t$(date +%s)$$"; T0=$(date +%s); D="$(mktemp -d)"
declare -A FILE=([web]=qa-web.yml [android]=qa-android.yml [ios]=qa-ios.yml)
declare -A RUN=()
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
for t in gh jq python3; do command -v $t >/dev/null || { echo "Eksik arac: $t" >&2; exit 2; }; done

# 1) tetikle (REST dispatch; GraphQL gerekmez)
for k in ${ONLY//,/ }; do
  args=(-f "ref=$REF" -f "inputs[istek]=$ID" -f "inputs[app_ref]=$APP_REF")
  [ "$k" = ios ] && args+=(-f "inputs[macos_runner]=$MACOS")
  if gh api -X POST "repos/$REPO/actions/workflows/${FILE[$k]}/dispatches" "${args[@]}" >/dev/null 2>"$D/err"; then log "tetiklendi: $k (${FILE[$k]}, ref=$REF, app_ref=${APP_REF:-guncel})"
  else log "TETIKLENEMEDI $k: $(head -c 300 "$D/err")"; echo "tetiklenemedi: $(head -c 200 "$D/err")" > "$D/$k.not"; fi
done

# 2) run kimliklerini bul (run-name icinde ISTEK kimligi)
for k in ${ONLY//,/ }; do
  [ -f "$D/$k.not" ] && continue
  for i in $(seq 1 30); do
    id=$(gh api "repos/$REPO/actions/workflows/${FILE[$k]}/runs?event=workflow_dispatch&per_page=10" --jq ".workflow_runs[]|select(.display_title|contains(\"$ID\"))|.id" 2>/dev/null | head -1)
    [ -n "$id" ] && { RUN[$k]=$id; break; }; sleep 4
  done
  if [ -n "${RUN[$k]:-}" ]; then log "run $k = ${RUN[$k]}  https://github.com/$REPO/actions/runs/${RUN[$k]}"
  else log "run bulunamadi: $k"; echo "run bulunamadi (tetikleme gorunmedi)" > "$D/$k.not"; fi
done

# 3) bitene kadar yokla
declare -A DONE=(); last=0
while :; do
  now=$(date +%s); el=$((now-T0)); alldone=1
  for k in "${!RUN[@]}"; do
    [ -n "${DONE[$k]:-}" ] && continue
    id=${RUN[$k]}
    st=$(gh api "repos/$REPO/actions/runs/$id" --jq '[.status,.conclusion]|@tsv' 2>/dev/null) || { alldone=0; continue; }
    status=${st%%$'\t'*}
    if [ "$status" = completed ]; then DONE[$k]=1; log "bitti: $k (${st//$'\t'/ }) $((el/60))dk"; continue; fi
    alldone=0
    # kuyruk denetimi: bir is QLIMIT sn'den uzun suredir hic baslamadiysa altyapi sorunu
    q=$(gh api "repos/$REPO/actions/runs/$id/jobs?per_page=30" --jq "[.jobs[]|select(.status==\"queued\" or .status==\"waiting\")]|length" 2>/dev/null || echo 0)
    if [ "${q:-0}" -gt 0 ] && [ "$el" -gt "$QLIMIT" ]; then
      lbl="runner kuyruğu"; [ "$k" = ios ] && lbl="macOS kuyruğu"
      echo "altyapı: $lbl — $q iş ${QLIMIT}sn'den uzun süredir kuyrukta ($MACOS); koşu iptal edildi, ürün hatası sayılmaz" >> "$D/$k.not"
      log "ALTYAPI: $lbl ($k); koşu iptal ediliyor"; gh api -X POST "repos/$REPO/actions/runs/$id/cancel" >/dev/null 2>&1; sleep 10; DONE[$k]=1
    fi
  done
  [ "$alldone" = 1 ] && break
  if [ "$el" -gt "$TIMEOUT" ]; then
    for k in "${!RUN[@]}"; do [ -z "${DONE[$k]:-}" ] && { echo "altyapı: zaman aşımı (${TIMEOUT}sn); koşu iptal edildi" >> "$D/$k.not"; gh api -X POST "repos/$REPO/actions/runs/${RUN[$k]}/cancel" >/dev/null 2>&1; }; done
    sleep 15; break
  fi
  [ $((now-last)) -ge 60 ] && { last=$now; log "bekleniyor ($((el/60))dk): $(for k in "${!RUN[@]}"; do [ -z "${DONE[$k]:-}" ] && printf '%s ' "$k"; done)"; }
  sleep 20
done

# 4) gunlukleri topla (artifact gerekmez) ve tabloyu bas
for k in "${!RUN[@]}"; do
  id=${RUN[$k]}
  gh api "repos/$REPO/actions/runs/$id" > "$D/$k.run.json" 2>/dev/null
  gh api "repos/$REPO/actions/runs/$id/jobs?per_page=50" --jq '.jobs' > "$D/$k.jobs.json" 2>/dev/null
  gh run view "$id" -R "$REPO" --log > "$D/$k.log" 2>"$D/$k.logerr" || echo "günlük okunamadı: $(head -c 200 "$D/$k.logerr")" >> "$D/$k.not"
done
echo "Toplam bekleme: $(( ($(date +%s)-T0)/60 )) dk | istek=$ID | ref=$REF | app_ref=${APP_REF:-guncel}"
python3 -I "$HERE/report/telefon_ozet.py" "$D"; rc=$?
echo "Ham günlükler: $D"
exit $rc
