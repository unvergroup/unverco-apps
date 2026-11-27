// Yerlesik ornek sonuclar ("Try a sample"): biri SHIP, biri DON'T SHIP. Depo adi ve hatalar ornektir (uydurma);
// bicim kitin gercek ciktisiyla aynidir: ortam etiketleri build_results.env_label, duzeltme talimatlari kitin
// report/fix_prompts.build_prompt fonksiyonuyla uretildi (28 Kasim 2026).
const NOTE = "Real devices are not used. Results come from desktop emulation, an Android emulator and the iOS Simulator.";

const COMMON = {
  tool: "unverco-app-tester",
  schema: 1,
  kit_version: "1.0.0",
  repo: "example-owner/example-app",
  commit: "a1b2c3d",
};

export const SAMPLE_DONT_SHIP = Object.freeze({
  ...COMMON,
  generated_at: "2026-11-28T10:00:00Z",
  summary: { verdict: "DONT_SHIP", passed: 590, failed: 4, warnings: 3, skipped: 2, duration_sec: 655 },
  environments: [
  {
    "id": "web-chromium",
    "kind": "desktop-emulation",
    "label": "Chrome engine (Chromium), 10 device profiles",
    "status": "failed",
    "passed": 150,
    "failed": 1,
    "run_url": ""
  },
  {
    "id": "web-firefox",
    "kind": "desktop-emulation",
    "label": "Firefox engine, 10 device profiles",
    "status": "passed",
    "passed": 151,
    "failed": 0,
    "run_url": ""
  },
  {
    "id": "web-webkit",
    "kind": "desktop-emulation",
    "label": "Safari engine (WebKit), 10 device profiles",
    "status": "failed",
    "passed": 150,
    "failed": 1,
    "run_url": ""
  },
  {
    "id": "android-emulator",
    "kind": "emulator",
    "label": "Android 14 (API 34) emulator, Chrome",
    "status": "failed",
    "passed": 32,
    "failed": 1,
    "run_url": ""
  },
  {
    "id": "ios-simulator",
    "kind": "simulator",
    "label": "iPhone 16 (iOS 18.5 simulator), Mobile Safari",
    "status": "failed",
    "passed": 107,
    "failed": 1,
    "run_url": ""
  }
],
  failures: [
  {
    "id": "F1",
    "priority": "P0",
    "level": "failed",
    "app": "Example App",
    "environment": "ios-simulator",
    "profile": "iPhone 16 (iOS 18.5 simulator) landscape",
    "check": "Main journey",
    "message": "[Welcome screen] expected element #start, not found after 30 s",
    "screenshot": "screenshots/ios-simulator-main-journey-landscape.png",
    "repro": "Environment: iOS Simulator / Mobile Safari / iPhone 16 (iOS 18.5 simulator) landscape. Open the app: run `python -m http.server 8000` in the repository root and open localhost port 8000 in the browser. Journey: Welcome screen.",
    "fix_prompt": "You are helping me fix a failure found by an automated test of my app \"Example App\".\n\nCheck: Main journey\nWhat this check means: A step of the user journey could not be completed (the page did not open, an element was missing, or it could not be tapped).\nEnvironment: iPhone 16 (iOS 18.5 simulator), Mobile Safari\nDevice profile: iPhone 16 (iOS 18.5 simulator) landscape\nExpected: this check passes.\nActual: [Welcome screen] expected element #start, not found after 30 s\nHow to reproduce: Environment: iOS Simulator / Mobile Safari / iPhone 16 (iOS 18.5 simulator) landscape. Open the app: run `python -m http.server 8000` in the repository root and open localhost port 8000 in the browser. Journey: Welcome screen.\n\nPossible causes to look at (a fixed checklist, not a diagnosis):\n- The selector in app-tester/config.json is outdated or the element was renamed or removed.\n- The element exists but is hidden, off-screen or covered by another element (fixed bar, banner, modal) at this screen size.\n- A script error stops the screen from rendering (check the console errors for this profile).\n- The first load is slow (large files, service worker install) and the element appears too late.\n- The control only reacts to real touch or pointer events, or is not reachable by scrolling on this viewport.\n- iPhone Safari specifics: 100vh includes the browser toolbar (try dynamic viewport units), safe-area insets (env safe-area-inset) for notches and the home bar, input text smaller than 16 px triggers zoom on focus, date inputs render differently.\n- The landscape tour is run on a second address (localhost), so check layout in landscape as well.\n\nPlease:\n1. Find the cause in my code and tell me which file and which lines you will change.\n2. Make the smallest change that fixes this problem.\n3. Keep all existing behavior unchanged.\n4. Add a regression test or check that fails before the fix and passes after it.\n5. Do not invent files, functions or APIs; use only what exists in my project. If you need to see a file first, ask me for it."
  },
  {
    "id": "F2",
    "priority": "P1",
    "level": "failed",
    "app": "Example App",
    "environment": "android-emulator",
    "profile": "Android 14 (API 34) emulator",
    "check": "Console errors",
    "message": "pageerror: TypeError: Cannot read properties of undefined (reading 'share') @ app.js:212",
    "screenshot": "screenshots/android-emulator-console-errors.png",
    "repro": "Environment: Android emulator / Chrome / Android 14 (API 34) emulator. Open the app: run `python -m http.server 8000` in the repository root and open localhost port 8000 in the browser. Journey: Welcome screen > Share.",
    "fix_prompt": "You are helping me fix a failure found by an automated test of my app \"Example App\".\n\nCheck: Console errors\nWhat this check means: The browser console reported errors, uncaught exceptions or failed requests while the app ran.\nEnvironment: Android 14 (API 34) emulator, Chrome\nDevice profile: Android 14 (API 34) emulator\nExpected: this check passes.\nActual: pageerror: TypeError: Cannot read properties of undefined (reading 'share') @ app.js:212\nHow to reproduce: Environment: Android emulator / Chrome / Android 14 (API 34) emulator. Open the app: run `python -m http.server 8000` in the repository root and open localhost port 8000 in the browser. Journey: Welcome screen > Share.\n\nPossible causes to look at (a fixed checklist, not a diagnosis):\n- Uncaught script exceptions: read the first error and its file and line.\n- Failed requests (404 or network errors) for scripts, images, fonts or icons, including the favicon.\n- Content Security Policy violations or mixed content.\n- Code that runs before the page is ready, or that uses a browser feature this engine does not provide.\n- Android Chrome specifics: viewport meta tag, address-bar resizing of the viewport, touch handling, and the system font size.\n\nPlease:\n1. Find the cause in my code and tell me which file and which lines you will change.\n2. Make the smallest change that fixes this problem.\n3. Keep all existing behavior unchanged.\n4. Add a regression test or check that fails before the fix and passes after it.\n5. Do not invent files, functions or APIs; use only what exists in my project. If you need to see a file first, ask me for it."
  },
  {
    "id": "F3",
    "priority": "P1",
    "level": "failed",
    "app": "Example App",
    "environment": "web-chromium",
    "profile": "iPhone 13",
    "check": "Offline launch",
    "message": "Reload with the server stopped shows the browser error page instead of #app",
    "screenshot": "screenshots/chromium-iphone-13-offline.png",
    "repro": "Environment: Desktop emulation / chromium / iPhone 13. Open the app: run `python -m http.server 8000` in the repository root and open localhost port 8000 in the browser. Open it once, stop the server, reload.",
    "fix_prompt": "You are helping me fix a failure found by an automated test of my app \"Example App\".\n\nCheck: Offline launch\nWhat this check means: With the local server stopped, the installed app should still open from its service worker cache; it did not.\nEnvironment: Chrome engine (Chromium), 10 device profiles\nDevice profile: iPhone 13\nExpected: this check passes.\nActual: Reload with the server stopped shows the browser error page instead of #app\nHow to reproduce: Environment: Desktop emulation / chromium / iPhone 13. Open the app: run `python -m http.server 8000` in the repository root and open localhost port 8000 in the browser. Open it once, stop the server, reload.\n\nPossible causes to look at (a fixed checklist, not a diagnosis):\n- No service worker is registered, or its scope does not cover the start page.\n- The pre-cache list misses the start page, scripts, styles or icons.\n- The fetch handler has no offline fallback for navigation requests.\n- The cache name is not versioned, so old caches are served or new files are never cached.\n- The manifest start_url points to a page that is not cached.\n\nPlease:\n1. Find the cause in my code and tell me which file and which lines you will change.\n2. Make the smallest change that fixes this problem.\n3. Keep all existing behavior unchanged.\n4. Add a regression test or check that fails before the fix and passes after it.\n5. Do not invent files, functions or APIs; use only what exists in my project. If you need to see a file first, ask me for it."
  },
  {
    "id": "F4",
    "priority": "P2",
    "level": "failed",
    "app": "Example App",
    "environment": "web-webkit",
    "profile": "Android small 360x640",
    "check": "Horizontal overflow",
    "message": "[Home screen] scrollWidth 412 > 360; table.price-list right=412",
    "screenshot": "screenshots/webkit-android-small-360x640-home.png",
    "repro": "Environment: Desktop emulation / webkit / Android small 360x640. Open the app: run `python -m http.server 8000` in the repository root and open localhost port 8000 in the browser. Journey: Home screen.",
    "fix_prompt": "You are helping me fix a failure found by an automated test of my app \"Example App\".\n\nCheck: Horizontal overflow\nWhat this check means: The page is wider than the screen, so the user can scroll sideways.\nEnvironment: Safari engine (WebKit), 10 device profiles\nDevice profile: Android small 360x640 (the same check also fails on 2 other profile(s) in this environment)\nExpected: this check passes.\nActual: [Home screen] scrollWidth 412 > 360; table.price-list right=412\nHow to reproduce: Environment: Desktop emulation / webkit / Android small 360x640. Open the app: run `python -m http.server 8000` in the repository root and open localhost port 8000 in the browser. Journey: Home screen.\n\nPossible causes to look at (a fixed checklist, not a diagnosis):\n- A fixed width larger than the screen (for example a wide box, table, image or pre-formatted text).\n- A missing or wrong viewport meta tag.\n- Images, tables or code blocks without a maximum width of 100 percent.\n- Using 100vw together with a vertical scrollbar, negative margins or absolutely positioned elements.\n- Very long unbroken words or URLs without wrapping rules.\n- Hiding the symptom with overflow-x hidden on the body is not a fix; find the element that is too wide.\n- Safari engine specifics: 100vh vs dynamic viewport units, safe-area insets, input zoom for text under 16 px, date inputs, and CSS or JavaScript features that are newer than this engine.\n\nPlease:\n1. Find the cause in my code and tell me which file and which lines you will change.\n2. Make the smallest change that fixes this problem.\n3. Keep all existing behavior unchanged.\n4. Add a regression test or check that fails before the fix and passes after it.\n5. Do not invent files, functions or APIs; use only what exists in my project. If you need to see a file first, ask me for it."
  }
],
  notes: [NOTE],
});

export const SAMPLE_SHIP = Object.freeze({
  ...COMMON,
  commit: "9f8e7d6",
  generated_at: "2026-11-28T12:30:00Z",
  summary: { verdict: "SHIP", passed: 594, failed: 0, warnings: 2, skipped: 2, duration_sec: 612 },
  environments: [
  {
    "id": "web-chromium",
    "kind": "desktop-emulation",
    "label": "Chrome engine (Chromium), 10 device profiles",
    "status": "passed",
    "passed": 151,
    "failed": 0,
    "run_url": ""
  },
  {
    "id": "web-firefox",
    "kind": "desktop-emulation",
    "label": "Firefox engine, 10 device profiles",
    "status": "passed",
    "passed": 151,
    "failed": 0,
    "run_url": ""
  },
  {
    "id": "web-webkit",
    "kind": "desktop-emulation",
    "label": "Safari engine (WebKit), 10 device profiles",
    "status": "passed",
    "passed": 151,
    "failed": 0,
    "run_url": ""
  },
  {
    "id": "android-emulator",
    "kind": "emulator",
    "label": "Android 14 (API 34) emulator, Chrome",
    "status": "passed",
    "passed": 33,
    "failed": 0,
    "run_url": ""
  },
  {
    "id": "ios-simulator",
    "kind": "simulator",
    "label": "iPhone 16 (iOS 18.5 simulator), Mobile Safari",
    "status": "passed",
    "passed": 108,
    "failed": 0,
    "run_url": ""
  }
],
  failures: [],
  notes: [NOTE],
});

export const SAMPLES = Object.freeze({ ship: SAMPLE_SHIP, dontship: SAMPLE_DONT_SHIP });
