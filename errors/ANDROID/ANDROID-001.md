# ANDROID-001

**Category:** ANDROID

## Message

Timed out waiting for the Android emulator to boot

## Details

buildApp:android launched the configured AVD but it did not appear in `adb devices` or did not finish booting (sys.boot_completed=1 and init.svc.bootanim=stopped) within the timeout.

## Suggested action

Try booting the AVD manually first (emulator -avd <name>) to see the actual startup error, check available disk space/RAM, or increase the emulator's cold-boot allowance if the device is unusually slow.
