# iOS physical-device test: web AI stack (#635 + #636)

You are testing the on-device AI features on a **real iPhone**. Everything in the automated tests runs on a simulator or a Mac; the items below
are the ones that only a real device can show. Plan about 90 minutes plus the model downloads.

**What to send back:** this file with the *Result* column filled in (PASS / FAIL / SKIPPED + one line of what you saw), the console logs
described in section 4 for any FAIL, and a screenshot or short screen recording for each FAIL and for tests marked 📷.

## 1. Before you start

| Need | Detail |
|---|---|
| Device | A real iPhone on **iOS 26 or later** with Apple Intelligence available (needed for the Foundation Models tests). Note the model and iOS version below. |
| Free space / RAM | About 3 GB free for Gemma 4 E2B (2.6 GB download) and 0.7 GB for Qwen3 0.6B. Gemma needs several GB of RAM, so a recent Pro model is best. |
| Network | Wi-Fi you can switch off. Airplane mode is used in tests 6 and 7. |
| Mac | Xcode with your signing team set, the device connected by cable and trusted. |
| Code | Branch `integration/ai-review-batch-2` (PR #636, based on #635). |
| Keys | Only tests 20 and 21 need cloud keys (OpenAI or Gemini). Everything else runs without any key. |

**Build and run the example app on the device**

1. In `examples/useai`, copy `config/config.template.json` to `config/config.json` and set `WEBVIEW_CONFIG.ios.appBundleId`/`appName` to values your signing team can use.
   Keep `WEBVIEW_CONFIG.ai.enabled: true`. Set `LOCAL_IP` to your Mac's LAN IP (not `localhost`) so the phone can reach the dev server, and add
   `http://<that IP>:3005` to `allowedUrls`. For tests 20 and 21 add API keys under `AI_CONFIG.providers` and set each provider's `imageModel` (image steps report a missing model until it is set; see the example README).
2. Run `npm install`, then `npm run buildApp:ios`. If the CLI only targets the simulator, open the generated Xcode project, choose your device and press Run.
3. Start the web server (`npm start`) and keep the phone on the same Wi-Fi.
4. Open the app. The pages used below are reached by URL path: `/ai-test`, `/multimodal`, `/pipeline-lab`, `/ai-playground`, and the camera page from the home menu.

Write down: device model ____________ iOS version ____________ tester ____________ date ____________ commit ____________

## 2. Tests

Do them in order; later ones reuse the downloaded model. "Page" means the route above. Labels on screen may differ slightly from the words
in quotes; use the closest match.

### A. Basic on-device AI

| # | Page | What to do | Expected | Result |
|---|---|---|---|---|
| 1 | `/ai-test` | Pick provider **native** (engine auto). Press start/initialise, wait for "ready". Send "Say hello in five words". | Gemma downloads (progress bar with MB), the model loads, reply streams in, no error. Note time to ready and tokens/second shown. | |
| 2 | `/ai-test` | Same page, send a second prompt in the same session ("and now in French"). Then press clear/reset and send again. | Reply uses the conversation; after clear it does not remember. | |
| 3 | `/ai-test` | Choose engine **foundation-models**. Initialise and send a prompt. | Apple's model answers (no download). Text only: sending an image is refused with a clear message. | |
| 4 | `/ai-test` | Choose engine **auto** with the Gemma model not downloaded and the phone in airplane mode, then initialise (the LiteRT download cannot start, so LiteRT fails). | Falls back to Foundation Models and answers; log shows "using foundation-models instead". | |
| 5 | `/multimodal` | Native provider, attach a photo and ask "What is in this picture?". Then attach a short voice clip (under 30 s) and ask for a transcript. 📷 | Image and audio both answered by Gemma on the device; no network traffic to a cloud API. | |

### B. Model download: pause, resume, weak network (the code changed a lot here)

| # | Page | What to do | Expected | Result |
|---|---|---|---|---|
| 6 | `/ai-test` | Delete the app (clears the model), reinstall, start a Gemma download. At about 30% switch on **airplane mode** for 60 s, then switch it off. | Status shows paused (offline), then resumes **from where it stopped** (MB count does not restart from 0) and finishes. | |
| 7 | `/ai-test` | Start the download again from scratch, at about 20% quit the app (swipe up) and reopen it, start again. | Resumes from the partial file, not from zero. File size check passes at the end. | |
| 8 | `/ai-test` | During a download use the page's **pause** and **resume** buttons if present. | Pause stops traffic at once, resume continues. No double-count of bytes. | |
| 9 | `/ai-test` | Use a slow or throttled network (Network Link Conditioner "Very Bad Network") for a minute during a download. | Shows a weak-link pause and retries with a growing wait; finishes when the link recovers. | |
| 10 | `/pipeline-lab` | On-device engine, choose **Qwen3 0.6B** in the model list, run a text prompt. 📷 | Downloads the small model (0.6 GB), answers in text. **This model has not been run on a real device before: this is the first real test.** Also check that audio and voice modes are hidden for it. | |
| 11 | any | After Qwen3 has downloaded, check that no leftover `Qwen3-0.6B-it-int4.litertlm` or `qwen3_0_6b_mixed_int4.litertlm` file remains (only visible if you had an older build installed: install the older build first, run Qwen3, then update). | Old files are removed after the new download completes. SKIPPED is fine if you have no older build. | |

### C. Microphone, speech and the 30-second wait

| # | Page | What to do | Expected | Result |
|---|---|---|---|---|
| 12 | `/pipeline-lab` | On-device engine, mode **Speak live (on this phone)**. Accept the microphone and speech-recognition prompts. Say a sentence. 📷 | Text appears as you speak (the phone's own recogniser). Stop works. No audio leaves the phone (cloud is denied in this mode). | |
| 13 | `/pipeline-lab` | Deny the microphone prompt (Settings > the app > Microphone > off) and try again. | A clear "permission denied" message, **not** a generic failure. Turn it back on afterwards. | |
| 14 | `/pipeline-lab` | Start live speech, then switch **engine** or **mode** while it is listening. | Listening stops immediately; no stuck microphone indicator (orange dot gone). | |
| 15 | `/pipeline-lab` | Start live speech and background the app (home screen), come back. | Recognition ended cleanly. Play music in Music, return: audio plays normally (the audio session was given back). | |
| 16 | `/pipeline-lab` | Set the phone language/region so the recogniser language is not installed (Settings > General > Keyboard > Dictation) and try live speech. | "Language not available / not installed" message instead of a failure after a long wait. | |
| 17 | any page that records | Time how long "request microphone permission" takes on a fresh install. | Answer within about a second of tapping Allow. **It must never take 30 s.** (A 30 s wait means the new capability announcement is not reaching the page.) | |

### D. Camera / vision

| # | Page | What to do | Expected | Result |
|---|---|---|---|---|
| 18 | camera page | Take a photo of a printed document (or use the sample), scan with the on-device engine. 📷 | Structured fields are returned; the engine shown is on-device. | |
| 19 | camera page | Pick a very large photo (a 48 MP shot) and a screenshot. | Both work or are refused with a size message; the app does not freeze or crash. | |

### E. Cloud routing (needs keys; skip if you have none)

| # | Page | What to do | Expected | Result |
|---|---|---|---|---|
| 20 | `/pipeline-lab` | Cloud engine, text to JSON scene to picture. | Asks for consent before anything leaves the device; picture appears. | |
| 21 | `/pipeline-lab` | Press **Stop** while a cloud step is running. | The step stops promptly (the request is cancelled), not after it finishes. | |

## 3. Quick sanity list (30 seconds each)

- App cold start is not slower than before (note rough seconds): ____
- Rotate the phone during a download: progress continues.
- Lock the phone during a short generation: either continues or stops cleanly, no crash.
- Memory warning: open several heavy apps, return, send a prompt: model reloads or shows a clear error.

## 4. What to collect and send back

For **every FAIL**, and for the 📷 tests:

1. **Screenshot or screen recording** of the screen at the moment it went wrong.
2. **Native log (Xcode):** Window > Devices and Simulators > your phone > *Open Console*, or run the app from Xcode and copy the Debug area.
   Filter on `Catalyst`, `AI` and `LiteRT`. Copy from just before you started the step until after it failed.
3. **Page log (Safari):** on the phone enable Settings > Safari > Advanced > Web Inspector; on the Mac open Safari > Develop > your iPhone > the app's page,
   and copy the Console tab. Useful lines start with `[native-ai]`, `[tryCreateEngine]`, `Download:` and `Resuming`.
4. Device model, iOS version, free storage, Wi-Fi or cellular, and the exact steps you took.

Send everything to the PR author, or attach it to the comment on PR #636.

## 5. Results summary (fill in and return)

| Section | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|
| A. Basic on-device AI | | | | |
| B. Downloads | | | | |
| C. Microphone and speech | | | | |
| D. Camera / vision | | | | |
| E. Cloud routing | | | | |

Overall verdict (circle): **ready to release** / **ready with known issues** / **blocked**. Blocking issues: ______________________
