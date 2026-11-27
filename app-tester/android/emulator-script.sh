#!/usr/bin/env bash
# android-emulator-runner runs the "script" input line by line, so everything lives in this single file.
set -x
API="${1:-?}"
adb wait-for-device
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk
adb shell pm list packages | grep -i chrome || echo "WARNING: Chrome package not found"
adb shell dumpsys package com.android.chrome | grep -m2 versionName || true
python app-tester/android/run_android.py --api "$API" --out "qa-out/android-api${API}"
RC=$?
mkdir -p "qa-out/android-api${API}"
# Exit code 2 = infrastructure problem (for example Chrome could not start); the report marks the environment as incomplete.
if [ "$RC" -ne 0 ]; then echo "$RC" > "qa-out/android-api${API}/infra-exit.txt"; fi
# Emulator screenshot (evidence)
adb exec-out screencap -p > "qa-out/android-api${API}/last-screen.png" || true
adb logcat -d -t 400 > "qa-out/android-api${API}/logcat-tail.txt" || true
exit $RC
