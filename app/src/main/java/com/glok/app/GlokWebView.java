package com.glok.app;

import android.content.Context;
import android.view.View;
import android.webkit.WebView;

/**
 * The chat page. It is told its window stays visible, so the page keeps running at full speed (timers, network,
 * replies) after the app goes to the background; the page learns about the app's real state from JsBridge.
 */
final class GlokWebView extends WebView {
    GlokWebView(Context c) {
        super(c);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(View.VISIBLE);
    }
}
