# Kitchen closed-app order alerts (production)

## Pipeline

**Order → Server FCM (data-only) → Android AdminMessagingService → AdminAlarmController insistent alarm → Staff stops via UI / open app**

SSE is for the live dashboard only. It does **not** ring when the app is dead.

## Ship checklist

1. Run migrations (includes `014_admin_fcm_tokens_hardening.js`)
2. Server has Firebase Admin credentials (`FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`)
3. Build & install admin APK with matching `google-services.json`
4. Fresh install → allow notifications + battery unrestricted → login admin
5. Confirm `admin_fcm_tokens` has a row within ~30s
6. Dashboard **Kitchen order alerts** shows **ARMED** + Firebase ready
7. **Send test FCM** with app open → alarm rings → Okay stops it
8. Swipe app from recents → **Send test FCM** from another device/browser → phone rings
9. Lock screen → test again
10. Logout → token removed → test should report 0 devices (or not hit this device)
11. Reboot phone → open app once → closed-app test still works

## Server log greps

```
sendFcmToAdmins
admin FCM token registered
No admin FCM tokens
Firebase not initialized
```

## Honest limits

- No network on phone → no FCM
- Android **Force stop** → no FCM until user opens app
- Some OEM killers need manual “autostart” / unrestricted battery
