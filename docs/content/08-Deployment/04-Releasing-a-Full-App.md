---
title: Releasing a Full App
slug: releasing-a-full-app
id: releasing-a-full-app
---

# Releasing a Full App

This page takes a Catalyst app from a working debug build to a first release in Google Play internal testing and TestFlight. Follow it in order the first time. Later releases only need steps 3, 4 and 7.

## 1. Prepare the app

1. Deploy the web app over HTTPS.
2. In `config/config.json`, set `WEBVIEW_CONFIG.appId` to your own reverse-DNS id (not `com.example.`), `appName` to the name under the icon, and `url` to the deployed address, for example `https://shop.acme.com`. The id cannot change after the first upload.
3. Set the `version` in `package.json`, for example `1.0.0`.
4. Replace `public/icon.png` with your icon: square, opaque, at least 1024x1024 pixels.
5. For iOS, set `WEBVIEW_CONFIG.ios.developmentTeam` to your team ID.

See [Universal App Deployment](/content/Deployment/universal-app-deployment#configure-the-app) for what each key does.

## 2. Create the store records

Google Play:

1. In Play Console, choose Create app and fill in the name, language and the app or game and free or paid answers.
2. Under Test and release > Testing > Internal testing, create a tester list with your own Google account.

App Store Connect:

1. Under Certificates, Identifiers & Profiles on developer.apple.com, register an App ID with your `appId` as the bundle ID.
2. In App Store Connect, choose Apps > + > New App and pick that bundle ID.
3. For cloud signing, create an App Store Connect API key with the Admin role under Users and Access > Integrations, and download the `.p8`.

## 3. Build the Android release

```bash
npm run android:release
```

Run it in a terminal. The first time, answer yes to creating the upload key and no to "Has this app been uploaded to Google Play before". Then back up the key right away:

```bash
npx catalyst credentials:export android
```

Keep the printed value in a password manager. Without this key you cannot update the app.

The bundle is in `build-output/android/<version>-<build>/` with `upload_certificate.pem` next to it.

## 4. Upload to Google Play internal testing

1. In Play Console, open the app and go to Test and release > Testing > Internal testing, then Create new release.
2. Accept Play App Signing when asked. Google keeps the app signing key, and your key becomes the upload key.
3. Upload the `.aab`, add release notes, then review the release and roll it out.
4. Open the opt-in link from the Testers tab on your phone and install the app from Google Play.

Play Console checks the bundle after upload. App bundle explorer lists the target API level and warns about native libraries that do not support 16 KB memory pages; Catalyst's own libraries are aligned, so a warning there points at a library your app added.

## 5. Build the iOS release

1. Put the signing files in `credentials/ios/`: the `AuthKey_<KEYID>.p8` and a `signing.properties` with `ascIssuerId=<issuer id>` for cloud signing, or a `.p12`, its profile and `p12Password=` for local signing. [Building and Releasing a Catalyst iOS App](/content/Deployment/ios-production-release#2-add-the-signing-files) has the details.
2. Run `npm run ios:release`.
3. Back up the folder with `npx catalyst credentials:export ios`.

The IPA is in `build-output/ios/<version>-<build>/`.

## 6. Upload to TestFlight

1. Open Transporter, sign in with your Apple account, drag in the IPA and choose Deliver.
2. Wait for the email that the build has finished processing.
3. In App Store Connect, open the app's TestFlight tab, create an internal group with yourself in it, and add the build.
4. Install TestFlight on your iPhone and install the app from the invitation.

## 7. Check the installed apps

On a real phone from each store:

- the app opens your production site, not a dev server or an error page
- the name and icon on the home screen are right
- the version and build number in Play Console and App Store Connect match `build-output/<platform>/<version>-<build>/`
- sign-in, deep links, file pickers, the camera and notifications work, and their permission prompts appear
- with the network off, the offline page shows

## 8. Set up CI

1. Add `CATALYST_ANDROID_CREDENTIALS` and `CATALYST_IOS_CREDENTIALS` as repository secrets, from the two `credentials:export` commands above.
2. Copy the workflow template from [Native CI](/content/Deployment/universal-app-deployment#native-ci) to `.github/workflows/catalyst-native.yml`.
3. Push a `v*` tag, download the `android-aab` and `ios-ipa` artifacts, and upload them as in steps 4 and 6.

## Next releases

Bump the `version` in `package.json`, run the two release scripts (or push a tag), and upload. The build number rises by itself, and the same upload key and signing files are used every time.

Framework contributors can also check the 16 KB alignment of a bundle locally with `node scripts/native-release-check.mjs align <file.aab>` from the Catalyst repository. App developers can rely on Play Console's checks.
