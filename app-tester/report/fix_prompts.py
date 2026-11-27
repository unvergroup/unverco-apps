"""Builds a ready-to-paste AI fix prompt for one failure. Fixed hint table per check type; no invented code."""

CHECK_INFO = {
    "Main journey": (
        "A step of the user journey could not be completed (the page did not open, an element was missing, or it could not be tapped).",
        ["The selector in app-tester/config.json is outdated or the element was renamed or removed.",
         "The element exists but is hidden, off-screen or covered by another element (fixed bar, banner, modal) at this screen size.",
         "A script error stops the screen from rendering (check the console errors for this profile).",
         "The first load is slow (large files, service worker install) and the element appears too late.",
         "The control only reacts to real touch or pointer events, or is not reachable by scrolling on this viewport."]),
    "Blank screen": (
        "After loading, the main area of the page is empty or nearly empty (too little text or too few visible elements).",
        ["A script error at startup stops the app from rendering.",
         "A script, style or data file fails to load (wrong path, wrong file-name case, 404, wrong base path).",
         "The app relies on a feature this browser engine does not support yet.",
         "A service worker serves a stale or incomplete cache.",
         "The main_selector in app-tester/config.json points to an element that does not hold the app content."]),
    "Blank screen (image analysis)": (
        "The screenshot of the launched app looks blank (almost one color) when analyzed as an image.",
        ["A script error or a failed file load stops the app from rendering.",
         "The app shows a plain background while waiting for data that never arrives.",
         "On an emulator or simulator the browser may still show its own first-run screen; confirm with the screenshot."]),
    "Horizontal overflow": (
        "The page is wider than the screen, so the user can scroll sideways.",
        ["A fixed width larger than the screen (for example a wide box, table, image or pre-formatted text).",
         "A missing or wrong viewport meta tag.",
         "Images, tables or code blocks without a maximum width of 100 percent.",
         "Using 100vw together with a vertical scrollbar, negative margins or absolutely positioned elements.",
         "Very long unbroken words or URLs without wrapping rules.",
         "Hiding the symptom with overflow-x hidden on the body is not a fix; find the element that is too wide."]),
    "Clipped text": (
        "Text is cut off because its box is smaller than the text and overflow is hidden.",
        ["A fixed width or height with overflow hidden and no wrapping.",
         "white-space nowrap on text that can be long (translations, user input, larger system font sizes).",
         "Use wrapping, a minimum height or an intentional ellipsis instead of cutting the text."]),
    "Touch target 44px": (
        "A tappable element is smaller than 44 x 44 CSS pixels, which makes it hard to hit on a phone.",
        ["Give buttons, links, inputs and custom controls a minimum width and height of 44 px (or add padding).",
         "Icon-only buttons often need extra padding or an invisible larger hit area.",
         "Check the spacing between neighboring targets so they are not tapped by mistake.",
         "Custom checkboxes, radios and switches need the same minimum size."]),
    "Console errors": (
        "The browser console reported errors, uncaught exceptions or failed requests while the app ran.",
        ["Uncaught script exceptions: read the first error and its file and line.",
         "Failed requests (404 or network errors) for scripts, images, fonts or icons, including the favicon.",
         "Content Security Policy violations or mixed content.",
         "Code that runs before the page is ready, or that uses a browser feature this engine does not provide."]),
    "Offline launch": (
        "With the local server stopped, the installed app should still open from its service worker cache; it did not.",
        ["No service worker is registered, or its scope does not cover the start page.",
         "The pre-cache list misses the start page, scripts, styles or icons.",
         "The fetch handler has no offline fallback for navigation requests.",
         "The cache name is not versioned, so old caches are served or new files are never cached.",
         "The manifest start_url points to a page that is not cached."]),
    "Data persistence": (
        "Data entered during the test was not the same after the page was reloaded.",
        ["The state lives only in memory and is never written to storage.",
         "The write to localStorage or IndexedDB happens too late or is not awaited before the reload.",
         "Storage keys or data formats change between loads.",
         "Safari limits or clears website storage in some situations; confirm that the data is stored and read correctly."]),
    "Primary action reachable": (
        "The main action configured for the persistence test could not be performed.",
        ["The control is hidden, off-screen or covered by a fixed element at this screen size.",
         "The selector in app-tester/config.json is outdated.",
         "The control is smaller than 44 px or too close to another control.",
         "On iPhone, safe-area insets and the browser toolbar can cover bottom controls."]),
    "Print page count": (
        "The printed document does not have the expected number of pages.",
        ["Print styles (page size, margins, page breaks) do not match the paper size.",
         "Elements that should be hidden or shown in print are not handled in the print styles.",
         "Letter and A4 paper need different layouts; check both."]),
}

ENV_HINTS = {
    "ios-simulator": ["iPhone Safari specifics: 100vh includes the browser toolbar (try dynamic viewport units), safe-area insets (env safe-area-inset) for notches and the home bar, input text smaller than 16 px triggers zoom on focus, date inputs render differently.",
                      "The landscape tour is run on a second address (localhost), so check layout in landscape as well."],
    "web-webkit": ["Safari engine specifics: 100vh vs dynamic viewport units, safe-area insets, input zoom for text under 16 px, date inputs, and CSS or JavaScript features that are newer than this engine."],
    "android-emulator": ["Android Chrome specifics: viewport meta tag, address-bar resizing of the viewport, touch handling, and the system font size."],
    "web-firefox": ["Firefox engine specifics: some CSS and JavaScript features differ; test the same screen in this engine."],
}

DEFAULT_INFO = ("A check failed.", ["Read the detail text carefully and compare with the screenshot."])


def build_prompt(f):
    """f: dict with app, environment, env_label, profile, check, message, repro, level, extra_profiles (int)."""
    desc, causes = CHECK_INFO.get(f["check"], DEFAULT_INFO)
    kind = "warning" if f.get("level") == "warning" else "failure"
    L = [f"You are helping me fix a {kind} found by an automated test of my app \"{f['app']}\".",
         "",
         f"Check: {f['check']}",
         f"What this check means: {desc}",
         f"Environment: {f['env_label']}",
         f"Device profile: {f['profile']}" + (f" (the same check also fails on {f['extra_profiles']} other profile(s) in this environment)" if f.get("extra_profiles") else ""),
         f"Expected: this check passes.",
         f"Actual: {f['message'] or 'The check did not pass.'}",
         f"How to reproduce: {f['repro']}",
         "",
         "Possible causes to look at (a fixed checklist, not a diagnosis):"]
    L += [f"- {c}" for c in causes]
    for h in ENV_HINTS.get(f["environment"], []):
        L.append(f"- {h}")
    L += ["",
          "Please:",
          "1. Find the cause in my code and tell me which file and which lines you will change.",
          "2. Make the smallest change that fixes this problem.",
          "3. Keep all existing behavior unchanged.",
          "4. Add a regression test or check that fails before the fix and passes after it.",
          "5. Do not invent files, functions or APIs; use only what exists in my project. If you need to see a file first, ask me for it."]
    return "\n".join(L)
