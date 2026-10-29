package com.glok.app;

import android.app.Application;

public final class GlokApp extends Application {
    static GlokApp app;

    @Override
    public void onCreate() {
        super.onCreate();
        app = this;
        Keeper.init(this);
        Notifier.createChannels(this);
    }
}
