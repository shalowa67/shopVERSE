# ShopVerse for Android

An Android app that opens the live ShopVerse marketplace
(<https://shopverse-mr72.onrender.com>) full-screen, with the ShopVerse icon and no
browser address bar. It uses Google's Trusted Web Activity: the app runs the real
website through Chrome, so it is always up to date and needs no separate updates.

GitHub builds two files:

| File            | Use it for                                                        |
|-----------------|-------------------------------------------------------------------|
| `ShopVerse.apk` | Direct download. People open it on their phone to install it.     |
| `ShopVerse.aab` | Uploading to the Google Play Store (Play Console).                |

## One-time setup: add the signing key to GitHub

The signing key lives on your computer in `C:\Users\ADMIN\shopverse-android-key\`,
outside the project and never on GitHub.

1. On GitHub, open the repository's **Settings → Secrets and variables → Actions →
   New repository secret**.
2. Add a secret named `ANDROID_KEYSTORE_BASE64`. Paste the entire contents of
   `keystore-base64.txt` as its value.
3. Add a secret named `ANDROID_KEYSTORE_PASSWORD`. Paste the contents of
   `password.txt` as its value.

**Back up that folder** (for example on a USB drive or in a password manager). If the
key is lost, phones with the app installed cannot receive updates. You would have to
publish a new app, and on Google Play you would lose the existing listing.

## Build

1. Open the **Actions** tab → **Build Android app** → **Run workflow**.
2. After about 5 minutes, `ShopVerse.apk` and `ShopVerse.aab` appear in the
   **android-app** release, and the Android download link on the website's `/install`
   page starts working.

For a new version, increase `versionCode` (by 1) and `versionName` in
`android/app/build.gradle`, push, and run the workflow again.

## Installing the APK

On an Android phone, open the download link and tap the downloaded file. The first
time, Android asks to allow installing apps from the browser. Turn that on and
continue.

## Publishing on Google Play

1. Create a Google Play developer account (one-time US$25).
2. In Play Console, create an app and upload `ShopVerse.aab`.
3. Google re-signs Play Store downloads with its own key. Copy the **SHA-256** from
   Play Console → **Setup → App signing** and add it to the
   `sha256_cert_fingerprints` list in `backend/assetlinks.json`, next to the existing
   one. Then deploy the website. Without this, the Play Store version shows an
   address bar.

## How the address bar is hidden

The website serves `/.well-known/assetlinks.json` (from `backend/assetlinks.json`)
with the app's package name and signing-key fingerprint. Android checks that file to
confirm the website and the app belong together.
