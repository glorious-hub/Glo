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

# ---- the model stays ready in the background and is never loaded again ----
loads() { adb logcat -d -s glok:I 2>/dev/null | grep -c ' loaded '; }
fgs() { adb shell dumpsys activity services $PKG 2>/dev/null | grep -q 'isForeground=true'; }
loads0=$(loads)
adb shell input keyevent KEYCODE_HOME
sleep 20
adb shell dumpsys activity services $PKG > "$OUT/services-idle.txt"
adb shell dumpsys notification --noredact > "$OUT/notifications-idle.txt"
if fgs; then say "idle in the background: the app keeps running for the model"; else say "FAIL idle in the background: no foreground service"; fail=1; fi
if grep -q "모델 상시 준비 중" "$OUT/notifications-idle.txt"; then say "status bar shows 모델 상시 준비 중"; else say "FAIL ready notification missing"; fail=1; fi
pid1=$(adb shell pidof $PKG | tr -d '\r')
adb shell am kill $PKG
sleep 3
pid2=$(adb shell pidof $PKG | tr -d '\r')
if [ -n "$pid1" ] && [ "$pid1" = "$pid2" ]; then say "survived Android's background clean-up (pid $pid1)"; else say "FAIL closed in the background ($pid1 -> $pid2)"; fail=1; fi

# the screen is closed and opened again (as after swiping the app away): same page, same model, nothing loaded again
adb shell settings put global always_finish_activities 1
adb shell am start -W -n $PKG/.MainActivity >/dev/null; sleep 2
adb shell input keyevent KEYCODE_HOME; sleep 3
adb shell am start -W -n $PKG/.MainActivity --es selftest "$(base64 -w0 ci/selftest3.js)" >/dev/null
adb shell settings put global always_finish_activities 0
if wait_log "GLOK_SELFTEST kept" 60; then
  k=$(adb logcat -d -s GlokJS:I | grep "GLOK_SELFTEST kept" | tail -1)
  if echo "$k" | grep -q "page=same model=ready"; then say "screen closed and opened again: same page, model ready"; else say "FAIL after reopening: $k"; fail=1; fi
else
  say "FAIL no answer from the reopened page"; fail=1
fi
sleep 2; shot 05-reopened
if [ "$(loads)" = "$loads0" ]; then say "model not loaded again (loads: $loads0)"; else say "FAIL model loaded again ($loads0 -> $(loads))"; fail=1; fi

# Android closes the app for memory: the service comes back by itself and loads the model before the app is opened
adb shell input keyevent KEYCODE_HOME; sleep 3
adb root >/dev/null 2>&1; sleep 3; adb wait-for-device
pid=$(adb shell pidof $PKG | tr -d '\r')
adb shell kill -9 "$pid"
say "process $pid killed (as Android does when memory runs out)"
i=0
while [ "$i" -lt 150 ] && [ "$(loads)" = "$loads0" ]; do sleep 3; i=$((i + 3)); done
if [ "$(loads)" != "$loads0" ]; then say "service restarted and loaded the model by itself after ${i}s"; else say "FAIL model not restored after the process was killed"; fail=1; fi
sleep 3
if fgs; then say "restored app runs in the foreground service again"; else say "FAIL restored app has no foreground service"; fail=1; fi
loads1=$(loads)
adb shell am start -W -n $PKG/.MainActivity --es selftest "$(base64 -w0 ci/selftest4.js)" >/dev/null
if wait_log "GLOK_SELFTEST restored" 150; then
  r=$(adb logcat -d -s GlokJS:I | grep "GLOK_SELFTEST restored" | tail -1 | sed -E 's/.*restored ([0-9.]+s).*/\1/')
  say "opened after the restore: model ready in $r"
else
  say "FAIL model not ready after the restore"; fail=1
fi
sleep 2; shot 06-after-restore
if wait_log "GLOK_SELFTEST sent4" 60; then
  sleep 1
  adb shell input keyevent KEYCODE_HOME
  if wait_log "GLOK_SELFTEST reply4" 400; then say "answered after the restore"; else say "FAIL no answer after the restore"; fail=1; fi
else
  say "FAIL message after the restore not sent"; fail=1
fi
if [ "$(loads)" = "$loads1" ]; then say "opening the app did not load the model again"; else say "FAIL opening the app loaded the model again"; fail=1; fi

adb logcat -d -s GlokJS:I GlokEngine:I glok:I llama:W GlokMain:W GlokKeeper:W GlokService:I GlokModels:W GlokBridge:W AndroidRuntime:E > "$OUT/glok-log.txt"
adb logcat -d > "$OUT/logcat-full.txt"
grep GLOK_SELFTEST "$OUT/glok-log.txt" | tee -a "$OUT/summary.txt"
if grep -q "GLOK_SELFTEST error" "$OUT/glok-log.txt"; then fail=1; fi
exit $fail
