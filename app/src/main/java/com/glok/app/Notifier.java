package com.glok.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;

/** Status-bar notifications: the "새 채팅이 있습니다" message and the quiet one Android shows while work runs. */
final class Notifier {
    private Notifier() {}

    static final String CH_CHAT = "chat";
    static final String CH_WORK = "work";
    static final int ID_CHAT = 1001;
    static final int ID_WORK = 1002;

    private static Bitmap avatar;

    static void createChannels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel chat = new NotificationChannel(CH_CHAT, "새 채팅", NotificationManager.IMPORTANCE_HIGH);
        chat.setDescription("답변이 끝나면 알려 드려요");
        chat.enableVibration(true);
        chat.setVibrationPattern(new long[] {0, 120, 60, 120});
        chat.setShowBadge(true);
        NotificationChannel work = new NotificationChannel(CH_WORK, "백그라운드 작업", NotificationManager.IMPORTANCE_LOW);
        work.setDescription("화면이 꺼져 있어도 답변을 이어서 써요");
        work.setShowBadge(false);
        work.enableVibration(false);
        work.setSound(null, null);
        nm.createNotificationChannel(chat);
        nm.createNotificationChannel(work);
    }

    static boolean enabled(Context c) {
        return c.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class)
                .setAction(MainActivity.ACTION_OPEN_CHAT)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void chat(Context c, String title, String body) {
        if (!enabled(c)) return;
        Notification.Builder b = new Notification.Builder(c, CH_CHAT)
                .setSmallIcon(R.drawable.ic_stat_g)
                .setLargeIcon(avatar(c))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setShowWhen(true)
                .setColor(0xFF000000)
                .setContentIntent(openApp(c));
        c.getSystemService(NotificationManager.class).notify(ID_CHAT, b.build());
    }

    static void cancelChat(Context c) {
        c.getSystemService(NotificationManager.class).cancel(ID_CHAT);
    }

    static Notification work(Context c, String text, int pct) {
        Notification.Builder b = new Notification.Builder(c, CH_WORK)
                .setSmallIcon(R.drawable.ic_stat_g)
                .setContentTitle("Glok")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setColor(0xFF000000)
                .setContentIntent(openApp(c));
        if (pct >= 0) b.setProgress(100, pct, false);
        return b.build();
    }

    static void updateWork(Context c, String text, int pct) {
        c.getSystemService(NotificationManager.class).notify(ID_WORK, work(c, text, pct));
    }

    private static synchronized Bitmap avatar(Context c) {
        if (avatar == null) {
            int px = Math.round(64 * c.getResources().getDisplayMetrics().density);
            Drawable d = c.getDrawable(R.drawable.ic_avatar);
            avatar = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
            Canvas cv = new Canvas(avatar);
            d.setBounds(0, 0, px, px);
            d.draw(cv);
        }
        return avatar;
    }
}
