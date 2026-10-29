package com.glok.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Keeps the app running while it has work: a foreground service (so Android doesn't stop the app) and a
 * partial wake lock (so the CPU keeps going with the screen off). Both end a few seconds after the last job.
 */
final class Keeper {
    private Keeper() {}

    private static final String TAG = "GlokKeeper";
    private static final long LINGER_MS = 3000;
    private static final long WAKE_MAX_MS = 6L * 60 * 60 * 1000;

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final LinkedHashMap<String, String> holds = new LinkedHashMap<>();
    private static boolean enabled = true;
    private static boolean running = false;
    private static int pct = -1;
    private static PowerManager.WakeLock wake;

    private static final Runnable stopper = () -> {
        synchronized (Keeper.class) {
            if (!holds.isEmpty() && enabled) return;
            running = false;
            pct = -1;
            releaseWake();
            GlokService.stop(GlokApp.app);
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
        update();
    }

    static synchronized boolean busy() {
        return !holds.isEmpty();
    }

    static synchronized void progress(int p) {
        pct = p;
        if (running) GlokService.refresh(GlokApp.app);
    }

    static synchronized String label() {
        String last = "작업 중";
        for (Map.Entry<String, String> e : holds.entrySet()) last = e.getValue();
        return last;
    }

    static synchronized int pct() {
        for (String k : new ArrayList<>(holds.keySet())) if (k.startsWith("dl:")) return pct;
        return -1;
    }

    private static void update() {
        main.removeCallbacks(stopper);
        Context c = GlokApp.app;
        if (!holds.isEmpty() && enabled) {
            acquireWake(c);
            if (!running) {
                running = GlokService.start(c);
            } else {
                GlokService.refresh(c);
            }
        } else if (running || wake != null) {
            main.postDelayed(stopper, LINGER_MS);
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
