package br.com.grupotec.opinaai;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.content.SharedPreferences;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "OpinaRuntime")
public class OpinaRuntimePlugin extends Plugin {
    private static final String PREFS = "opina_runtime";
    private static final String PIN_HASH = "admin_pin_hash";
    private static final String PIN_SALT = "admin_pin_salt";

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject info = new JSObject();
        info.put("platform", "android");
        info.put("androidVersion", Build.VERSION.RELEASE);
        info.put("manufacturer", Build.MANUFACTURER);
        info.put("model", Build.MODEL);
        info.put("orientation", orientation());
        boolean unlocked = getActivity() instanceof MainActivity && ((MainActivity) getActivity()).isKioskUnlocked();
        info.put("kioskState", unlocked ? "unlocked" : "active");
        info.put("adminPinConfigured", hasAdminPin());

        BatterySnapshot battery = battery();
        info.put("batteryLevel", battery.level);
        info.put("charging", battery.charging);
        info.put("networkState", networkState());
        call.resolve(info);
    }

    @PluginMethod
    public void configureAdminPin(PluginCall call) {
        String pin = call.getString("pin", "").trim();
        if (!validPin(pin)) {
            call.reject("admin_pin_invalid");
            return;
        }
        SharedPreferences preferences = preferences();
        if (hasAdminPin()) {
            call.resolve(new JSObject().put("configured", true).put("created", false));
            return;
        }
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        preferences.edit()
                .putString(PIN_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString(PIN_HASH, digest(pin, salt))
                .apply();
        call.resolve(new JSObject().put("configured", true).put("created", true));
    }

    @PluginMethod
    public void exitKiosk(PluginCall call) {
        String pin = call.getString("pin", "").trim();
        if (!hasAdminPin()) {
            call.reject("admin_pin_not_configured");
            return;
        }
        if (!verifyPin(pin)) {
            call.reject("admin_pin_invalid");
            return;
        }
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("activity_unavailable");
            return;
        }
        MainActivity activity = (MainActivity) getActivity();
        activity.runOnUiThread(() -> {
            boolean unlocked = activity.unlockKioskMode();
            call.resolve(new JSObject().put("unlocked", unlocked));
        });
    }

    @PluginMethod
    public void reenterKiosk(PluginCall call) {
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("activity_unavailable");
            return;
        }
        MainActivity activity = (MainActivity) getActivity();
        activity.runOnUiThread(() -> {
            boolean locked = activity.lockKioskMode();
            call.resolve(new JSObject().put("locked", locked));
        });
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean hasAdminPin() {
        return preferences().contains(PIN_HASH) && preferences().contains(PIN_SALT);
    }

    private boolean verifyPin(String pin) {
        if (!validPin(pin)) return false;
        try {
            byte[] salt = Base64.decode(preferences().getString(PIN_SALT, ""), Base64.DEFAULT);
            byte[] expected = Base64.decode(preferences().getString(PIN_HASH, ""), Base64.DEFAULT);
            byte[] actual = MessageDigest.getInstance("SHA-256").digest(concat(salt, pin.getBytes(StandardCharsets.UTF_8)));
            return MessageDigest.isEqual(expected, actual);
        } catch (Exception ignored) {
            return false;
        }
    }

    private String digest(String pin, byte[] salt) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(concat(salt, pin.getBytes(StandardCharsets.UTF_8)));
            return Base64.encodeToString(hash, Base64.NO_WRAP);
        } catch (Exception error) {
            throw new IllegalStateException("admin_pin_hash_failed", error);
        }
    }

    private byte[] concat(byte[] first, byte[] second) {
        byte[] result = new byte[first.length + second.length];
        System.arraycopy(first, 0, result, 0, first.length);
        System.arraycopy(second, 0, result, first.length, second.length);
        return result;
    }

    private boolean validPin(String pin) {
        return pin != null && pin.matches("\\d{4,8}");
    }

    private String orientation() {
        int value = getContext().getResources().getConfiguration().orientation;
        if (value == Configuration.ORIENTATION_PORTRAIT) return "portrait";
        if (value == Configuration.ORIENTATION_LANDSCAPE) return "landscape";
        return "unknown";
    }

    private BatterySnapshot battery() {
        Intent batteryIntent = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (batteryIntent == null) return new BatterySnapshot(null, null);
        int level = batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        Integer percentage = level >= 0 && scale > 0 ? Math.round((level * 100f) / scale) : null;
        int status = batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
        return new BatterySnapshot(percentage, charging);
    }

    private String networkState() {
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return "unknown";
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        if (capabilities == null) return "offline";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
        return "online";
    }

    private static class BatterySnapshot {
        private final Integer level;
        private final Boolean charging;

        private BatterySnapshot(Integer level, Boolean charging) {
            this.level = level;
            this.charging = charging;
        }
    }
}
