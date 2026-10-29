package com.glok.app;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/** Foreground service that runs only while Glok has work (an answer, a picture, a model download). */
public final class GlokService extends Service {
    private static final String TAG = "GlokService";
    private static volatile GlokService inst;

    static boolean start(Context c) {
        try {
            c.startForegroundService(new Intent(c, GlokService.class));
            return true;
        } catch (Exception e) {
            // Android refuses a start from the background unless the app may ignore battery optimizations
            Log.w(TAG, "start refused", e);
            return false;
        }
    }

    static void stop(Context c) {
        GlokService s = inst;
        if (s != null) {
            s.stopForeground(STOP_FOREGROUND_REMOVE);
            s.stopSelf();
        } else {
            c.stopService(new Intent(c, GlokService.class));
        }
    }

    static void refresh(Context c) {
        if (inst != null) Notifier.updateWork(c, Keeper.label(), Keeper.pct());
    }

    @Override
    public void onCreate() {
        super.onCreate();
        inst = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(Notifier.ID_WORK, Notifier.work(this, Keeper.label(), Keeper.pct()),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(Notifier.ID_WORK, Notifier.work(this, Keeper.label(), Keeper.pct()));
            }
        } catch (Exception e) {
            Log.w(TAG, "startForeground", e);
        }
        if (!Keeper.busy()) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // swiping the app away keeps the running answer going; the service ends with the work
    }

    @Override
    public void onDestroy() {
        inst = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
