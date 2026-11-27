#!/usr/bin/env bash
# android-emulator-runner "script" girdisi satir satir calistirir; bu yuzden tek dosya.
set -x
API="${1:-?}"
adb wait-for-device
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk
adb shell pm list packages | grep -i chrome || echo "UYARI: Chrome paketi yok"
adb shell dumpsys package com.android.chrome | grep -m2 versionName || true
python qa/android/run_android.py --api "$API" --out "qa-out/android-api${API}"
RC=$?
# Emulator ekran goruntusu (kanit)
adb exec-out screencap -p > "qa-out/android-api${API}/son-ekran.png" || true
adb logcat -d -t 400 > "qa-out/android-api${API}/logcat-son.txt" || true
exit $RC
