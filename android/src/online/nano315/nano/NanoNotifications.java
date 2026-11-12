package online.nano315.nano;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

final class NanoNotifications {
    static final String CHANNEL_DEFAULT = "nano_default";
    static final String CHANNEL_KEEPALIVE = "nano_keepalive";

    private NanoNotifications() {
    }

    static int smallIcon(Context ctx) {
        try {
            int id = ctx.getResources().getIdentifier("ic_notify", "drawable", ctx.getPackageName());
            if (id != 0) return id;
        } catch (Exception ignored) {
        }
        return android.R.drawable.stat_notify_chat;
    }

    static boolean allowed(Context ctx) {
        if (Build.VERSION.SDK_INT < 33) return true;
        return ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    static String safeChannel(String raw) {
        String id = raw == null ? "" : raw.trim().toLowerCase();
        if (id.isEmpty()) return CHANNEL_DEFAULT;
        if ("keepalive".equals(id) || "keep-alive".equals(id)) return CHANNEL_KEEPALIVE;
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < id.length() && out.length() < 40; i++) {
            char c = id.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-') out.append(c);
        }
        return out.length() == 0 ? CHANNEL_DEFAULT : "nano_" + out;
    }

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_DEFAULT) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_DEFAULT, "Nano 通知", NotificationManager.IMPORTANCE_HIGH);
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 90, 50, 90});
            ch.setShowBadge(true);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_KEEPALIVE) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_KEEPALIVE, "Nano 后台保活", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
    }

    static void ensureChannel(Context ctx, String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (CHANNEL_KEEPALIVE.equals(channelId)) {
            ensureChannels(ctx);
            return;
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(channelId) == null) {
            NotificationChannel ch = new NotificationChannel(
                    channelId, "Nano 通知", NotificationManager.IMPORTANCE_HIGH);
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 90, 50, 90});
            nm.createNotificationChannel(ch);
        }
    }

    static PendingIntent openIntent(Context ctx, String target, int requestCode) {
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (target != null && !target.isEmpty()) {
            intent.putExtra(MainActivity.EXTRA_TARGET, target);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, requestCode, intent, flags);
    }

    static void show(Context ctx, String title, String body, String target, String channelRaw, int id) {
        if (!allowed(ctx)) return;
        ensureChannels(ctx);
        String channelId = safeChannel(channelRaw);
        ensureChannel(ctx, channelId);
        String t = title == null || title.trim().isEmpty() ? "Nano" : title.trim();
        String b = body == null ? "" : body;

        PendingIntent pi = openIntent(ctx, target, id);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(ctx, channelId);
        } else {
            builder = new Notification.Builder(ctx);
        }
        builder.setSmallIcon(smallIcon(ctx))
                .setContentTitle(t)
                .setContentText(b)
                .setStyle(new Notification.BigTextStyle().bigText(b))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis())
                .setVibrate(new long[]{0, 90, 50, 90});
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_HIGH);
        }
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(id, builder.build());
        } catch (Exception ignored) {
        }
    }

    static void cancel(Context ctx, int id) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(id);
        } catch (Exception ignored) {
        }
    }
}
