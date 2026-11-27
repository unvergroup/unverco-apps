// Yerlesik ornek sonuclar ("Try a sample"): biri SHIP, biri DON'T SHIP. Kitin gercek ciktisi DEGILDIR; depo adi uydurmadir.
const NOTE = "Real devices are not used. Results come from desktop emulation, an Android emulator and the iOS Simulator.";
const lines = (...a) => a.join("\n");

const COMMON = {
  tool: "unverco-app-tester",
  schema: 1,
  kit_version: "1.0.0",
  repo: "example-owner/example-app",
  commit: "a1b2c3d",
};

const FIX_IOS = lines(
  "You are fixing a bug in my web app (PWA). An automated check found a problem.",
  "",
  "What is broken: the main journey stops at the welcome screen on iPhone Safari.",
  "Environment: iOS Simulator, iPhone 16 (iOS 18.5 simulator), landscape.",
  "Check: Main journey",
  "Expected: element #start is visible and can be tapped.",
  "Actual: the element is not found, the welcome screen does not render.",
  "",
  "Possible causes to look at (these are hints, not a diagnosis):",
  "- iOS Safari: height set with 100vh hides content behind the address bar; try 100dvh or a safe-area aware layout.",
  "- Safe-area insets in landscape (notch) cut off the start button.",
  "- A script feature that Safari does not support yet, which throws before the screen renders.",
  "",
  "Make the smallest change that fixes it, keep existing behavior, and add a regression test for this check."
);
const FIX_TOUCH = lines(
  "You are fixing a bug in my web app (PWA). An automated check found a problem.",
  "",
  "What is broken: a tap target is smaller than 44 px.",
  "Environment: Android emulator, Pixel 7 (Android 14 emulator, Chrome).",
  "Check: Touch targets",
  "Expected: every button and link is at least 44 x 44 CSS px.",
  "Actual: the 'Close' icon button measures 32 x 32 px.",
  "",
  "Possible causes to look at (hints, not a diagnosis):",
  "- The control has no min-width / min-height; set both to 44px.",
  "- Padding was removed on small screens in a media query.",
  "",
  "Make the smallest change that fixes it, keep existing behavior, and add a regression test for this check."
);
const FIX_OVERFLOW = lines(
  "You are fixing a bug in my web app (PWA). An automated check found a problem.",
  "",
  "What is broken: the page scrolls sideways on a narrow phone screen.",
  "Environment: desktop emulation, Safari engine (WebKit), iPhone SE profile, portrait.",
  "Check: Horizontal overflow",
  "Expected: document width equals the viewport width (no horizontal scrollbar).",
  "Actual: the document is 412 px wide in a 375 px viewport.",
  "",
  "Possible causes to look at (hints, not a diagnosis):",
  "- A wide table, image or pre block without max-width: 100% or overflow handling.",
  "- A missing or wrong viewport meta tag.",
  "- Elements positioned with fixed widths larger than the screen.",
  "",
  "Make the smallest change that fixes it, keep existing behavior, and add a regression test for this check."
);
const FIX_OFFLINE = lines(
  "You are fixing a bug in my web app (PWA). An automated check found a problem.",
  "",
  "What is broken: the app does not open when the network is off.",
  "Environment: desktop emulation, Chromium engine, Pixel 7 profile.",
  "Check: Offline start",
  "Expected: after one online visit, reloading with the network off still shows the app.",
  "Actual: the second load shows the browser's offline error page.",
  "",
  "Possible causes to look at (hints, not a diagnosis):",
  "- The service worker scope does not cover the start page.",
  "- Some files are missing from the precache list.",
  "- The service worker is registered but never takes control of the page.",
  "",
  "Make the smallest change that fixes it, keep existing behavior, and add a regression test for this check."
);

export const SAMPLE_DONT_SHIP = Object.freeze({
  ...COMMON,
  generated_at: "2026-11-28T10:00:00Z",
  summary: { verdict: "DONT_SHIP", passed: 590, failed: 4, warnings: 3, skipped: 2, duration_sec: 655 },
  environments: [
    { id: "web-webkit", kind: "desktop-emulation", label: "Safari engine (WebKit), 11 device profiles", status: "failed", passed: 188, failed: 1, run_url: "" },
    { id: "web-chromium", kind: "desktop-emulation", label: "Chrome engine (Chromium), 11 device profiles", status: "failed", passed: 187, failed: 1, run_url: "" },
    { id: "android-emulator", kind: "emulator", label: "Android 14 emulator, Chrome", status: "failed", passed: 31, failed: 1, run_url: "" },
    { id: "ios-simulator", kind: "simulator", label: "iPhone 16 (iOS 18.5 simulator), Mobile Safari", status: "failed", passed: 184, failed: 1, run_url: "" },
  ],
  failures: [
    { id: "F1", priority: "P0", app: "Example App", environment: "ios-simulator", profile: "iPhone 16 (iOS 18.5 simulator) landscape", check: "Main journey", message: "Step 'Welcome screen': expected element #start", screenshot: "screenshots/ios-simulator-main-journey-landscape.png", repro: "1. Open the app in Mobile Safari on the iPhone 16 simulator.\n2. Rotate to landscape.\n3. Wait for the welcome screen.\n4. The #start button never appears.", fix_prompt: FIX_IOS },
    { id: "F2", priority: "P1", app: "Example App", environment: "android-emulator", profile: "Pixel 7 (Android 14 emulator) portrait", check: "Touch targets", message: "Close button is 32 x 32 px (minimum 44 x 44)", screenshot: "screenshots/android-touch-targets.png", repro: "1. Open the app in Chrome on the Android emulator.\n2. Open any dialog.\n3. Measure the Close button.", fix_prompt: FIX_TOUCH },
    { id: "F3", priority: "P1", app: "Example App", environment: "web-webkit", profile: "iPhone SE (WebKit emulation) portrait", check: "Horizontal overflow", message: "Document is 412 px wide in a 375 px viewport", screenshot: "screenshots/webkit-overflow-iphone-se.png", repro: "1. Open the app at 375 px width.\n2. Scroll right: the page moves sideways.", fix_prompt: FIX_OVERFLOW },
    { id: "F4", priority: "P2", app: "Example App", environment: "web-chromium", profile: "Pixel 7 (Chromium emulation) portrait", check: "Offline start", message: "Reload with the network off shows the browser error page", screenshot: "screenshots/chromium-offline-start.png", repro: "1. Open the app once online.\n2. Turn the network off.\n3. Reload the page.", fix_prompt: FIX_OFFLINE },
  ],
  notes: [NOTE],
});

export const SAMPLE_SHIP = Object.freeze({
  ...COMMON,
  commit: "9f8e7d6",
  generated_at: "2026-11-28T12:30:00Z",
  summary: { verdict: "SHIP", passed: 594, failed: 0, warnings: 2, skipped: 2, duration_sec: 612 },
  environments: [
    { id: "web-webkit", kind: "desktop-emulation", label: "Safari engine (WebKit), 11 device profiles", status: "passed", passed: 189, failed: 0, run_url: "" },
    { id: "web-chromium", kind: "desktop-emulation", label: "Chrome engine (Chromium), 11 device profiles", status: "passed", passed: 188, failed: 0, run_url: "" },
    { id: "android-emulator", kind: "emulator", label: "Android 14 emulator, Chrome", status: "passed", passed: 32, failed: 0, run_url: "" },
    { id: "ios-simulator", kind: "simulator", label: "iPhone 16 (iOS 18.5 simulator), Mobile Safari", status: "passed", passed: 185, failed: 0, run_url: "" },
  ],
  failures: [],
  notes: [NOTE],
});

export const SAMPLES = Object.freeze({ ship: SAMPLE_SHIP, dontship: SAMPLE_DONT_SHIP });
