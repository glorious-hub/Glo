package com.glok.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.OutputStream;

/** window.GlokNative in the page. Calls arrive on a WebView thread; events go back as one batch per frame. */
final class JsBridge implements LlmEngine.Sink {
    private static final String TAG = "GlokBridge";

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final StringBuilder queue = new StringBuilder();
    private boolean scheduled;
    private volatile WebView web;
    private volatile LlmEngine engine;

    JsBridge(Context app) {
        this.app = app.getApplicationContext();
    }

    void attach(WebView w) {
        web = w;
    }

    private LlmEngine engine() {
        LlmEngine e = engine;
        if (e == null) {
            synchronized (this) {
                if (engine == null) {
                    engine = LlmEngine.get(app);
                    engine.setSink(this);
                }
                e = engine;
            }
        }
        return e;
    }

    // ---- events to the page ----

    @Override
    public void event(JSONObject e) {
        post(e.toString());
    }

    void post(String json) {
        synchronized (queue) {
            if (queue.length() > 0) queue.append(',');
            queue.append(json);
            if (scheduled) return;
            scheduled = true;
        }
        main.postDelayed(this::flush, 30);
    }

    private void flush() {
        String s;
        synchronized (queue) {
            s = queue.toString();
            queue.setLength(0);
            scheduled = false;
        }
        WebView w = web;
        if (w != null && !s.isEmpty()) {
            w.evaluateJavascript("window.__glokNative&&window.__glokNative.batch([" + s + "])", null);
        }
    }

    void visible(boolean v) {
        post("{\"type\":\"visible\",\"v\":" + v + "}");
    }

    void permChanged(boolean finished) {
        try {
            JSONObject e = new JSONObject(bgState());
            e.put("type", "perm");
            e.put("finished", finished);
            event(e);
        } catch (Exception ignored) {
        }
    }

    // ---- app and phone settings ----

    static boolean notifOk(Context c) {
        if (Build.VERSION.SDK_INT >= 33
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return Notifier.enabled(c);
    }

    static boolean batteryOk(Context c) {
        PowerManager pm = c.getSystemService(PowerManager.class);
        return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }

    @JavascriptInterface
    public String appInfo() {
        try {
            JSONObject o = new JSONObject();
            o.put("version", app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName);
            o.put("debug", (app.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "");
            o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public boolean isBackgroundReady() {
        return notifOk(app) && batteryOk(app);
    }

    @JavascriptInterface
    public String bgState() {
        try {
            MainActivity a = MainActivity.current;
            JSONObject o = new JSONObject();
            o.put("notif", notifOk(app));
            o.put("battery", batteryOk(app));
            o.put("notifBlocked", a != null && a.notifBlocked());
            o.put("ready", notifOk(app) && batteryOk(app));
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        MainActivity a = MainActivity.current;
        if (a != null) a.runOnUiThread(a::requestNotif);
    }

    @JavascriptInterface
    public void requestBatteryExemption() {
        MainActivity a = MainActivity.current;
        if (a != null) a.runOnUiThread(a::requestBattery);
    }

    @JavascriptInterface
    public void enableBackgroundMode() {
        MainActivity a = MainActivity.current;
        if (a != null) a.runOnUiThread(a::enableBackgroundMode);
    }

    @JavascriptInterface
    public void openAppSettings() {
        MainActivity a = MainActivity.current;
        if (a != null) a.runOnUiThread(a::openNotifSettings);
    }

    @JavascriptInterface
    public boolean isForeground() {
        MainActivity a = MainActivity.current;
        return a != null && a.isShown();
    }

    @JavascriptInterface
    public void showNotification(String title, String body) {
        if (isForeground()) return;
        Notifier.chat(app, title == null ? "새 채팅이 있습니다" : title, body == null ? "" : body);
    }

    @JavascriptInterface
    public void setBusy(String key, boolean on) {
        String k = "web:" + key;
        if (on) {
            String label = "chat".equals(key) ? "답변을 쓰는 중" : "img".equals(key) ? "그림을 그리는 중" : "작업 중";
            Keeper.hold(k, label);
        } else {
            Keeper.release(k);
        }
    }

    @JavascriptInterface
    public void setKeepAlive(boolean on) {
        Keeper.setEnabled(on);
    }

    // ---- the model ----

    @JavascriptInterface
    public int engineLoad(String file, int nCtx) {
        File f = ModelStore.file(app, file);
        if (!f.exists()) return -1;
        return engine().load(f, Math.max(512, nCtx));
    }

    @JavascriptInterface
    public void engineUnload() {
        if (engine != null) engine.unload();
    }

    @JavascriptInterface
    public int chatStart(String json) {
        try {
            return engine().chat(new JSONObject(json));
        } catch (Exception e) {
            Log.w(TAG, "chatStart", e);
            return -1;
        }
    }

    @JavascriptInterface
    public void chatAbort(int id) {
        if (engine != null) engine.abort(id);
    }

    @JavascriptInterface
    public void chatAbortAll() {
        if (engine != null) engine.abortAll();
    }

    @JavascriptInterface
    public String engineInfo() {
        try {
            LlmEngine e = engine;
            JSONObject o = new JSONObject();
            o.put("loaded", e == null ? "" : e.loadedFile());
            o.put("threads", e == null ? 0 : e.threads());
            o.put("info", new JSONObject(e == null ? "{}" : e.info()));
            return o.toString();
        } catch (Exception ex) {
            return "{}";
        }
    }

    // ---- model files ----

    @JavascriptInterface
    public String modelList() {
        return ModelStore.list(app).toString();
    }

    @JavascriptInterface
    public boolean modelHas(String file, double size) {
        File f = ModelStore.file(app, file);
        return f.exists() && (size <= 0 || f.length() == (long) size) && ModelStore.isGguf(f);
    }

    @JavascriptInterface
    public int modelDownload(String url, String file, double size) {
        return ModelStore.download(app, url, file, (long) size, this);
    }

    @JavascriptInterface
    public void modelDownloadCancel(int id) {
        ModelStore.cancel(id);
    }

    @JavascriptInterface
    public void modelPick() {
        MainActivity a = MainActivity.current;
        if (a != null) a.runOnUiThread(a::pickModel);
        else post("{\"type\":\"pick\",\"id\":0,\"done\":true,\"ok\":false,\"aborted\":true}");
    }

    @JavascriptInterface
    public boolean modelDelete(String file) {
        return ModelStore.delete(app, file);
    }

    @JavascriptInterface
    public void modelDeleteAll() {
        ModelStore.deleteAll(app);
    }

    @JavascriptInterface
    public double freeSpace() {
        return ModelStore.freeSpace(app);
    }

    // ---- files the user saves (Glok.html, pictures, chat export) go to Downloads ----

    @JavascriptInterface
    public boolean saveFile(String name, String mime, String base64) {
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            ContentResolver cr = app.getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) return false;
            try (OutputStream os = cr.openOutputStream(uri)) {
                if (os == null) return false;
                os.write(data);
            }
            v.clear();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, v, null, null);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "saveFile", e);
            return false;
        }
    }

    @JavascriptInterface
    public void log(String s) {
        Log.i("GlokJS", String.valueOf(s));
    }
}
