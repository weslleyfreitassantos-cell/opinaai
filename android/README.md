# Opina AI Android kiosk

The Android application is a Capacitor bundle of the tablet survey UI. It is not a remote browser: HTML, CSS and JavaScript are copied into the APK under `app/src/main/assets/public` during sync.

## Local QA

From the repository root, use the Android Studio JDK on Windows when it is not on `PATH`:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
npm run android:build
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

The debug build defaults to `http://127.0.0.1:4000` for the API and permits cleartext/mixed content only in the debug manifest for USB `adb reverse` QA. Production builds must provide `VITE_OPINA_API_BASE_URL` with an HTTPS origin; no production domain is hardcoded.

The package is `br.com.grupotec.opinaai`. The main activity is portrait-locked, fullscreen, keeps the display awake and registers the Android Keystore-backed `OpinaSecureStorage` plugin for the device secret.

## Administrative kiosk exit

Press two fingers anywhere on the tablet for two seconds to open the administrative exit. Enter the PIN to release the tablet temporarily; the first successful pairing uses that tablet's six-digit pairing code as the local PIN. The PIN hash stays on the device, so the exit flow does not depend on internet access. Use **Voltar ao modo quiosque** when finished.

The app uses Android Lock Task only when it is provisioned as Device Owner. Unmanaged installs remain immersive fullscreen without starting screen pinning, so Android does not show its persistent screen-pinning exit indicator. Full device lockdown requires Device Owner provisioning.

## Future managed deployment

The APK is prepared for a later Device Owner/Lock Task rollout, but this campaign does not provision Android Management API, zero-touch or a production signing key. Boot auto-start is best effort and may be blocked by Android background-start policy until Device Owner management is enabled.
