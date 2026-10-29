package com.glok.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String TAG = "GlokMain";
    static final String ACTION_OPEN_CHAT = "com.glok.app.OPEN_CHAT";
    static final String HOST = "appassets.androidplatform.net";
    static final String APP_URL = "https://" + HOST + "/assets/index.html";

    private static final int REQ_FILE = 11;
    private static final int REQ_MODEL = 12;
    private static final int REQ_NOTIF = 13;
    private static final int REQ_BATTERY = 14;

    static volatile MainActivity current;

    // the page outlives this screen while it still has work, so an answer keeps going after the app is swiped away
    private static GlokWebView keptWeb;
    private static MutableContextWrapper keptCtx;
    private static JsBridge bridge;

    private FrameLayout root;
    private GlokWebView web;
    private MutableContextWrapper webCtx;
    private ValueCallback<Uri[]> fileCb;
    private boolean shown;
    private boolean bgSeq, askedNotif, askedBattery;
    private String selftest;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        if (bridge == null) bridge = new JsBridge(getApplicationContext());
        WebView.setWebContentsDebuggingEnabled(debuggable());

        if (keptWeb != null) {
            web = keptWeb;
            webCtx = keptCtx;
            keptWeb = null;
            keptCtx = null;
            webCtx.setBaseContext(this);
            if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
            bindClients(web);
            root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            bridge.attach(web);
        } else {
            createWeb();
            web.loadUrl(APP_URL);
        }
        handleIntent(getIntent());
    }

    private boolean debuggable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void createWeb() {
        webCtx = new MutableContextWrapper(this);
        web = new GlokWebView(webCtx);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        web.addJavascriptInterface(bridge, "GlokNative");
        bindClients(web);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bridge.attach(web);
    }

    private void bindClients(WebView w) {
        w.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath() == null ? "/" : u.getPath();
                String asset;
                if (path.equals("/") || path.equals("/assets/") || path.equals("/assets/index.html")) asset = "Glok.html";
                else if (path.startsWith("/assets/")) asset = path.substring("/assets/".length());
                else asset = path.substring(1);
                try {
                    InputStream in = getAssets().open(asset);
                    WebResourceResponse r = new WebResourceResponse(mime(asset), "UTF-8", in);
                    java.util.Map<String, String> h = new java.util.HashMap<>();
                    h.put("Cache-Control", "no-store");
                    r.setResponseHeaders(h);
                    return r;
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openExternal(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                bridge.visible(shown);
                if (selftest != null && debuggable()) {
                    String js = selftest;
                    selftest = null;
                    view.evaluateJavascript(js, null);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "page process ended, crash=" + detail.didCrash());
                Keeper.releasePrefix("web:");
                if (view == web) {
                    root.removeView(web);
                    web.destroy();
                    web = null;
                    createWeb();
                    web.loadUrl(APP_URL);
                } else {
                    if (view == keptWeb) {
                        keptWeb = null;
                        keptCtx = null;
                    }
                    view.destroy();
                }
                return true;
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(i, REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i("GlokJS", m.message());
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });
    }

    private static String mime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            Log.w(TAG, "no app for " + u);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        if (ACTION_OPEN_CHAT.equals(intent.getAction())) bridge.post("{\"type\":\"open\"}");
        String st = intent.getStringExtra("selftest");
        if (st != null && debuggable()) {
            intent.removeExtra("selftest");
            String js = new String(Base64.decode(st, Base64.DEFAULT), StandardCharsets.UTF_8);
            if (web != null && web.getProgress() >= 100 && web.getUrl() != null) web.evaluateJavascript(js, null);
            else selftest = js;
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        current = this;
        shown = true;
        bridge.visible(true);
        Notifier.cancelChat(this);
        bridge.permChanged(false);
        if (bgSeq) nextStep();
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
    }

    @Override
    protected void onStop() {
        shown = false;
        bridge.visible(false);
        super.onStop();
    }

    boolean isShown() {
        return shown;
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        if (fileCb != null) {
            fileCb.onReceiveValue(null);
            fileCb = null;
        }
        if (web != null) {
            root.removeView(web);
            if (Keeper.busy()) {
                webCtx.setBaseContext(getApplicationContext());
                keptWeb = web;
                keptCtx = webCtx;
            } else {
                bridge.attach(null);
                Keeper.releasePrefix("web:");
                web.destroy();
            }
            web = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // open sheets close through the page's own history; otherwise the app goes to the background and keeps working
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    // ---- phone settings the app asks for ----

    boolean notifBlocked() {
        return Build.VERSION.SDK_INT >= 33 && askedNotif
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
    }

    void requestNotif() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askedNotif = true;
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        } else if (!Notifier.enabled(this)) {
            askedNotif = true;
            openNotifSettings();
        } else {
            afterStep();
        }
    }

    @SuppressLint("BatteryLife")
    void requestBattery() {
        if (JsBridge.batteryOk(this)) {
            afterStep();
            return;
        }
        askedBattery = true;
        try {
            startActivityForResult(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())), REQ_BATTERY);
        } catch (Exception e) {
            try {
                startActivityForResult(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), REQ_BATTERY);
            } catch (Exception e2) {
                afterStep();
            }
        }
    }

    /** asks for each missing setting in turn: notifications, then running in the background */
    void enableBackgroundMode() {
        bgSeq = true;
        askedNotif = false;
        askedBattery = false;
        nextStep();
    }

    private void nextStep() {
        if (!bgSeq) return;
        if (!JsBridge.notifOk(this) && !askedNotif) {
            requestNotif();
            return;
        }
        if (!JsBridge.batteryOk(this) && !askedBattery) {
            requestBattery();
            return;
        }
        bgSeq = false;
        bridge.permChanged(true);
    }

    private void afterStep() {
        bridge.permChanged(false);
        if (bgSeq) nextStep();
    }

    void openNotifSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        }
    }

    void pickModel() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        try {
            startActivityForResult(i, REQ_MODEL);
        } catch (ActivityNotFoundException e) {
            bridge.post("{\"type\":\"pick\",\"id\":0,\"done\":true,\"ok\":false,\"error\":\"파일 앱을 열지 못했어요\"}");
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_NOTIF) afterStep();
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == REQ_FILE) {
            ValueCallback<Uri[]> cb = fileCb;
            fileCb = null;
            if (cb == null) return;
            Uri[] uris = null;
            if (result == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    uris = new Uri[clip.getItemCount()];
                    for (int i = 0; i < uris.length; i++) uris[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    uris = new Uri[] {data.getData()};
                }
            }
            cb.onReceiveValue(uris);
        } else if (code == REQ_MODEL) {
            if (result == RESULT_OK && data != null && data.getData() != null) {
                ModelStore.importUri(getApplicationContext(), data.getData(), bridge);
            } else {
                bridge.post("{\"type\":\"pick\",\"id\":0,\"done\":true,\"ok\":false,\"aborted\":true}");
            }
        } else if (code == REQ_BATTERY) {
            afterStep();
        }
    }
}
