# بناء التطبيق على GitHub (أندرويد + آيفون)

The workflow is `.github/workflows/build-apps.yml`. It runs on GitHub's own machines: Ubuntu for Android, macOS for iOS. No EAS account is needed.

## تشغيله

- **Manual:** GitHub → Actions → **build-apps** → Run workflow → choose `all`, `android` or `ios`.
- **Release:** push a tag, for example `git tag v1.0.0 && git push origin v1.0.0`. This builds both apps and creates a **draft GitHub Release** with the files attached.
- Download the files from the run page → **Artifacts** (`android`, `ios`). They are kept for 30 days.

The version comes from the tag (`v1.2.3` → `1.2.3`). The build number is the run number plus the `BUILD_NUMBER_OFFSET` variable. Use the offset if the store already has higher build numbers.

## What you get, step by step

| What you added | Android | iOS |
| --- | --- | --- |
| Nothing | APK + AAB signed with a **debug key**. The APK installs on any phone for testing. Not for the Play Store. | Simulator build (`.app` zip). Proves the app compiles; runs on the iOS Simulator only. |
| Signing secrets | APK + AAB signed with **your upload key**, ready for Play | Signed **IPA** |
| Store secrets | AAB uploaded to Play **internal testing** as a draft | IPA uploaded to **TestFlight** |

## Secrets (Settings → Secrets and variables → Actions → *Secrets*)

### Android signing (the upload key, created once and kept forever)

```bash
keytool -genkeypair -v -storetype JKS -keystore upload.jks -alias daftarak -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.jks   # paste the output as ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of `upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `daftarak` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | key password |
| `PLAY_SERVICE_ACCOUNT_JSON` | *(optional)* Google Play service-account JSON with release permission. The **first** upload to Play must be done by hand in Play Console. |

⚠️ Keep `upload.jks` and its passwords somewhere safe outside GitHub. If you lose it, you have to ask Google to reset the upload key.

### iOS (needs an Apple Developer account, $99/year)

1. In developer.apple.com, create:
   - the App ID `app.daftarak` with **Push Notifications** turned on;
   - an **Apple Distribution** certificate. Export it from Keychain as `.p12` with a password.
2. Create a provisioning profile:
   - **App Store** profile → TestFlight and the App Store;
   - **Ad Hoc** profile → install directly on registered iPhones.
3. To upload to TestFlight, go to App Store Connect → Users and Access → Integrations → create an **API key** (App Manager role) and download the `.p8` file.

| Secret | Value |
| --- | --- |
| `IOS_DIST_CERT_P12_BASE64` | `base64 -i cert.p12` |
| `IOS_DIST_CERT_PASSWORD` | the .p12 password |
| `IOS_PROVISION_PROFILE_BASE64` | `base64 -i Daftarak_AppStore.mobileprovision` |
| `ASC_KEY_P8_BASE64` | *(optional)* `base64 -i AuthKey_XXXX.p8` |
| `ASC_KEY_ID` | *(optional)* the key id |
| `ASC_ISSUER_ID` | *(optional)* the issuer id |

The workflow reads the profile itself to get the team, the profile name and the export type: App Store, or Ad Hoc when the profile lists devices. Signed builds turn on the production push environment (`IOS_APS_MODE=production`).

## App settings (Settings → Secrets and variables → Actions → *Variables*, not secret)

| Variable | Default when empty |
| --- | --- |
| `API_URL` | `https://daftarak-api.mallimerp.com` |
| `EAS_PROJECT_ID` | none (instant push needs it) |
| `ADMOB_ANDROID_APP_ID`, `ADMOB_IOS_APP_ID`, `ADMOB_BANNER_*`, `ADMOB_INTERSTITIAL_*` | Google's **test** IDs |
| `REVENUECAT_ANDROID_KEY`, `REVENUECAT_IOS_KEY` | in-app purchase hidden; activation codes still work |
| `GCP_PROJECT_NUMBER` | Play Integrity off |
| `SUPPORT_WHATSAPP`, `APP_STORE_ID` | empty |
| `BUILD_NUMBER_OFFSET` | `0` |

## Notes

- Before building, the workflow runs the type checks and the shared and mobile tests.
- The Android signing config is added by `apps/mobile/plugins/withReleaseSigning.js` during `expo prebuild`. Without a keystore, release builds use the debug key.
- `eas-release` (`release.yml`) is still there if you want Expo's servers instead. It also runs on `v*` tags and needs `EXPO_TOKEN`. Without that token it fails, which is harmless.
- The first App Store submission (listing, screenshots, review) and the first Play upload are done by hand in the store consoles. The texts are in `docs/store/`.
