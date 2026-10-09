package br.com.grupotec.opinaai;

import android.os.Bundle;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean kioskExitRequested = false;
    private boolean kioskModeActive = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OpinaSecureStoragePlugin.class);
        registerPlugin(OpinaRuntimePlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings settings = getBridge().getWebView().getSettings();
            settings.setDomStorageEnabled(true);
            getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        }
        hideSystemUi();
        enableKioskMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            if (kioskExitRequested) showSystemUi();
            else hideSystemUi();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (kioskExitRequested) showSystemUi();
        else {
            hideSystemUi();
            enableKioskMode();
        }
    }

    private void hideSystemUi() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private void showSystemUi() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, true);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.show(WindowInsetsCompat.Type.systemBars());
    }

    public boolean unlockKioskMode() {
        kioskExitRequested = true;
        kioskModeActive = false;
        try {
            if (isInLockTaskMode()) stopLockTask();
        } catch (SecurityException | IllegalStateException ignored) {
            // The current device owner may keep control of Lock Task mode.
        }
        showSystemUi();
        return !isInLockTaskMode();
    }

    public boolean lockKioskMode() {
        kioskExitRequested = false;
        hideSystemUi();
        enableKioskMode();
        // If another Device Owner blocks Lock Task, the immersive fallback is
        // still a valid kiosk mode for the test tablet.
        return kioskModeActive || isInLockTaskMode();
    }

    public boolean isKioskUnlocked() {
        return kioskExitRequested;
    }

    @Override
    public void onBackPressed() {
        if (!kioskExitRequested) return;
        super.onBackPressed();
    }

    private void enableKioskMode() {
        if (kioskExitRequested) return;
        kioskModeActive = false;
        DevicePolicyManager policy = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, OpinaDeviceAdminReceiver.class);
        // On unmanaged installs startLockTask() invokes Android screen pinning,
        // which leaves a persistent system exit affordance on screen. Use only
        // immersive fullscreen there; Device Owner deployments get true Lock Task.
        if (policy == null || !policy.isDeviceOwnerApp(getPackageName())) return;
        try {
            policy.setLockTaskPackages(admin, new String[]{getPackageName()});
            if (!isInLockTaskMode()) startLockTask();
            kioskModeActive = isInLockTaskMode();
        } catch (SecurityException | IllegalStateException ignored) {
            // If device-owner policy blocks Lock Task, remain in immersive fullscreen.
        }
    }

    private boolean isInLockTaskMode() {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M) return false;
        ActivityManagerState state = new ActivityManagerState(this);
        return state.isLocked();
    }

    private static final class ActivityManagerState {
        private final android.app.ActivityManager manager;

        private ActivityManagerState(Context context) {
            manager = (android.app.ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        }

        private boolean isLocked() {
            if (manager == null) return false;
            int state = manager.getLockTaskModeState();
            return state != android.app.ActivityManager.LOCK_TASK_MODE_NONE;
        }
    }
}
