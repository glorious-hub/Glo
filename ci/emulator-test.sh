#!/usr/bin/env bash
# Runs the debug app on the emulator: model load, a reply finished with the app in the background,
# the "새 채팅이 있습니다" notification, and a reply finished with the screen off and Doze forced.
set -uo pipefail
PKG=com.glok.app
OUT=ci-out
mkdir -p "$OUT"
APK=$(ls apk-test/*.apk | head -1)
fail=0
say() { echo "== $*"; echo "$*" >> "$OUT/summary.txt"; }
wait_log() {
  local pat="$1" t="$2" i=0
  while [ "$i" -lt "$t" ]; do
    if adb logcat -d -s GlokJS:I 2>/dev/null | grep -q "$pat"; then return 0; fi
    sleep 2; i=$((i + 2))
  done
  return 1
}
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }

adb wait-for-device
adb install -r -g "$APK" || { say "install failed"; exit 1; }
adb shell dumpsys deviceidle whitelist +$PKG
adb push "model/$MODEL_FILE" /data/local/tmp/m.gguf >/dev/null
adb shell "run-as $PKG mkdir -p files/models"
adb shell "cat /data/local/tmp/m.gguf | run-as $PKG sh -c 'cat > files/models/$MODEL_FILE'"
adb shell "run-as $PKG ls -l files/models"
adb shell rm -f /data/local/tmp/m.gguf
adb logcat -c

adb shell am start -W -n $PKG/.MainActivity --es selftest "$(base64 -w0 ci/selftest1.js)"
if wait_log "GLOK_SELFTEST loaded" 300; then say "model loaded"; else say "FAIL model did not load"; fail=1; fi
sleep 2; shot 01-loaded
if wait_log "GLOK_SELFTEST sent" 60; then
  sleep 1
  adb shell input keyevent KEYCODE_HOME
  say "app sent to the background while writing"
  if wait_log "GLOK_SELFTEST reply" 400; then say "reply finished in the background"; else say "FAIL no reply in the background"; fail=1; fi
  sleep 3
  adb shell dumpsys notification --noredact > "$OUT/notifications.txt"
  if grep -q "새 채팅이 있습니다" "$OUT/notifications.txt"; then say "chat notification posted"; else say "FAIL chat notification missing"; fail=1; fi
  adb shell cmd statusbar expand-notifications; sleep 2; shot 02-notification; adb shell cmd statusbar collapse
else
  say "FAIL message not sent"; fail=1
fi

adb shell am start -W -n $PKG/.MainActivity >/dev/null; sleep 3; shot 03-back-in-app

adb shell am start -W -n $PKG/.MainActivity --es selftest "$(base64 -w0 ci/selftest2.js)" >/dev/null
if wait_log "GLOK_SELFTEST sent2" 60; then
  sleep 1
  adb shell input keyevent KEYCODE_SLEEP
  adb shell dumpsys deviceidle force-idle
  say "screen off, Doze forced"
  if wait_log "GLOK_SELFTEST reply2" 400; then say "reply finished with the screen off"; else say "FAIL no reply with the screen off"; fail=1; fi
  adb shell dumpsys deviceidle unforce
  adb shell input keyevent KEYCODE_WAKEUP; sleep 1; adb shell wm dismiss-keyguard; sleep 3
else
  say "FAIL second message not sent"; fail=1
fi
shot 04-after-screen-off

adb logcat -d -s GlokJS:I GlokEngine:I glok:I llama:W GlokMain:W GlokKeeper:W GlokService:W GlokModels:W GlokBridge:W AndroidRuntime:E > "$OUT/glok-log.txt"
adb logcat -d > "$OUT/logcat-full.txt"
grep GLOK_SELFTEST "$OUT/glok-log.txt" | tee -a "$OUT/summary.txt"
if grep -q "GLOK_SELFTEST error" "$OUT/glok-log.txt"; then fail=1; fi
exit $fail
