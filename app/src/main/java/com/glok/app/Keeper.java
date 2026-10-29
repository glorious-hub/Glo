package com.glok.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Keeps Glok alive in the background.
 * - While a model is loaded (and "백그라운드 연결 유지" is on) a foreground service keeps the app, and with it the
 *   model in memory, from being closed by Android: the model is loaded once and stays ready.
 * - While there is work (an answer, a picture, a download) a partial wake lock also keeps the CPU going with the
 *   screen off. It ends a few seconds after the last job; the service stays as long as the model is loaded.
 */
final class Keeper {
    private Keeper() {}

    private static final String TAG = "GlokKeeper";
    private static final long LINGER_MS = 3000;
    private static final long WAKE_MAX_MS = 6L * 60 * 60 * 1000;
    static final String PREFS = "glok";
    private static final String K_ENABLED = "keep_alive";

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final LinkedHashMap<String, String> holds = new LinkedHashMap<>();
    private static boolean enabled = true; // the page's "백그라운드 연결 유지" switch
    private static boolean ready = false;  // a model is in memory
    private static boolean running = false; // the foreground service was started
    private static int pct = -1;
    private static PowerManager.WakeLock wake;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void init(Context c) {
        enabled = prefs(c).getBoolean(K_ENABLED, true);
    }

    /** after the last job: let go of the wake lock, and of the service too unless the model is kept ready */
    private static final Runnable settle = () -> {
        synchronized (Keeper.class) {
            if (!holds.isEmpty() && enabled) return;
            pct = -1;
            releaseWake();
            if (enabled && ready) {
                if (running) GlokService.refresh(GlokApp.app);
                else running = GlokService.start(GlokApp.app);
            } else {
                running = false;
                GlokService.stop(GlokApp.app);
            }
        }
    };

    static synchronized void hold(String key, String label) {
        holds.put(key, label);
        update();
    }

    static synchronized void release(String key) {
        if (holds.remove(key) != null) update();
    }

    /** jobs the page announced; when the page goes away they can't be finished by it anymore */
    static synchronized void releasePrefix(String prefix) {
        boolean changed = false;
        for (Iterator<String> it = holds.keySet().iterator(); it.hasNext(); ) {
            if (it.next().startsWith(prefix)) {
                it.remove();
                changed = true;
            }
        }
        if (changed) update();
    }

    static synchronized void setEnabled(boolean on) {
        if (enabled == on) return;
        enabled = on;
        try {
            prefs(GlokApp.app).edit().putBoolean(K_ENABLED, on).apply();
        } catch (Exception e) {
            Log.w(TAG, "prefs", e);
        }
        update();
    }

    static synchronized boolean enabled() {
        return enabled;
    }

    /** the engine reports whether a model is in memory */
    static synchronized void setReady(boolean on) {
        if (ready == on) return;
        ready = on;
        update();
    }

    static synchronized boolean busy() {
        return !holds.isEmpty();
    }

    /** the model stays in memory in the background (the service runs for it) */
    static synchronized boolean keepingModel() {
        return enabled && ready;
    }

    /** whether the service still has a reason to run */
    static synchronized boolean needed() {
        return enabled && (ready || !holds.isEmpty());
    }

    static synchronized void serviceUp() {
        running = true;
    }

    static synchronized void serviceGone() {
        running = false;
    }

    static synchronized void progress(int p) {
        pct = p;
        if (running) GlokService.refresh(GlokApp.app);
    }

    static synchronized String label() {
        if (holds.isEmpty()) return ready ? "모델 상시 준비 중" : "작업 중";
        String last = "작업 중";
        for (Map.Entry<String, String> e : holds.entrySet()) last = e.getValue();
        return last;
    }

    static synchronized int pct() {
        for (String k : new ArrayList<>(holds.keySet())) if (k.startsWith("dl:")) return pct;
        return -1;
    }

    private static void update() {
        main.removeCallbacks(settle);
        Context c = GlokApp.app;
        boolean work = !holds.isEmpty() && enabled;
        boolean keep = enabled && ready;
        if (work) {
            acquireWake(c);
            if (!running) running = GlokService.start(c);
            else GlokService.refresh(c);
        } else if (keep) {
            if (!running) running = GlokService.start(c);
            // the wake lock and the work text go after a short pause, in case the next job follows right away
            main.postDelayed(settle, LINGER_MS);
        } else if (running || wake != null) {
            main.postDelayed(settle, LINGER_MS);
        }
    }

    private static void acquireWake(Context c) {
        try {
            if (wake == null) {
                wake = c.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "glok:work");
                wake.setReferenceCounted(false);
            }
            wake.acquire(WAKE_MAX_MS);
        } catch (Exception e) {
            Log.w(TAG, "wake lock", e);
        }
    }

    private static void releaseWake() {
        try {
            if (wake != null && wake.isHeld()) wake.release();
        } catch (Exception e) {
            Log.w(TAG, "wake unlock", e);
        }
        wake = null;
    }
}
