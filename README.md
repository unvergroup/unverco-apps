# UNVERCO apps and guides

Site: https://unvergroup.github.io/unverco-apps/

## Free guide: test a website on iPhone Safari and Android Chrome without a Mac

https://unvergroup.github.io/unverco-apps/guide/test-website-iphone-safari-without-mac/

- GitHub Actions macOS runners include the iOS Simulator, which runs Mobile Safari. A workflow can boot an iPhone simulator, open your URL and take a screenshot (`xcrun simctl boot`, `xcrun simctl openurl`, `xcrun simctl io ... screenshot`).
- Android Chrome runs in an Android emulator on a Linux runner (for example `reactivecircus/android-emulator-runner`).
- Desktop device emulation changes screen size and user agent, not the browser engine. WebKit on Linux is not iOS Safari.
- Measured on our own repository: a full parallel run (web + Android + iOS) took about 10 to 13 minutes; a web-only check about 2 minutes.
- Simulators and emulators are not physical phones: no real hardware, push notifications or camera.

The `.github/workflows/qa-*.yml` files in this repository are the workflows we use for our own apps.

## Hosted apps

The folders in this repository are the hosted versions of UNVERCO apps sold on Etsy: https://www.etsy.com/shop/UNVERCO

- Blog: https://unvercoapps.blogspot.com/
- DEV: https://dev.to/unverco

UNVERCO is a trademark of Murat Ünver. iPhone and Safari are trademarks of Apple Inc. Android and Chrome are trademarks of Google LLC. GitHub is a trademark of GitHub, Inc.
