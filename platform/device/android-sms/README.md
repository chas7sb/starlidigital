# Starli Android SMS Bridge

This small Android companion uses `SmsManager` and persists a request fingerprint before submission. Replaying the same message ID reads the existing receipt instead of sending again. Android sent callbacks produce `SENT`; only delivery callbacks produce `DELIVERED`. Partial failures and missing callbacks require reconciliation.

The exported receiver requires Android's privileged `DUMP` permission, available to the authorized ADB shell. The app requests only `SEND_SMS`, has no network permission and does not read the inbox. Sender and delivery receivers are private. Message bodies are not stored in receipts.

Build on Windows with `scripts/build-android-sms.ps1` (JDK and Android SDK required). Install `output/private/android-sms-build/starli-sms-bridge.apk` on the paired phone with ADB. Unlock the phone and approve the Android installation prompt if shown. The build signing key lives at `%USERPROFILE%/.starli-device/sms-bridge-signing.p12`; preserve it and receipt data when updating. Reinstalling with a different signing key or clearing app data loses device-side deduplication and requires reconciliation before retrying unknown messages.

Health check:

```
adb shell am broadcast -n ro.starlidigital.smsbridge/.BridgeReceiver --es operation health
```

`sendPermission` must be true. Sending goes through the platform's existing message/job IDs. The device connector uses uppercase WebSocket messages, claims the server lease before executing, and returns the same lease with its receipt. An `am start SENDTO` composer window is not used as dispatch evidence.
