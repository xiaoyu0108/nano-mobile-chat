package online.nano315.nano;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class KeepAliveService extends Service {
    static final String ACTION_START = "online.nano315.nano.KEEPALIVE_START";
    static final String ACTION_STOP = "online.nano315.nano.KEEPALIVE_STOP";
    private static final int NOTIFICATION_ID = 0x4E414E4F;
    private PowerManager.WakeLock wakeLock;

    static void start(Context ctx) {
        try {
            Intent i = new Intent(ctx, KeepAliveService.class);
            i.setAction(ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception ignored) {
        }
    }

    static void stop(Context ctx) {
        try {
            Intent i = new Intent(ctx, KeepAliveService.class);
            i.setAction(ACTION_STOP);
            ctx.startService(i);
        } catch (Exception ignored) {
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : String.valueOf(intent.getAction());
        if (ACTION_STOP.equals(action)) {
            releaseLock();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }
        NanoNotifications.ensureChannels(this);
        startForegroundCompat(buildNotification());
        acquireLock();
        return START_STICKY;
    }

    private Notification buildNotification() {
        PendingIntent open = NanoNotifications.openIntent(this, "", 0x4E41);
        Intent stop = new Intent(this, KeepAliveService.class);
        stop.setAction(ACTION_STOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent stopPi = PendingIntent.getService(this, 0x4E42, stop, flags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, NanoNotifications.CHANNEL_KEEPALIVE);
        } else {
            b = new Notification.Builder(this);
        }
        b.setSmallIcon(NanoNotifications.smallIcon(this))
                .setContentTitle("Nano 正在后台保活")
                .setContentText("定时任务和自动消息会尽量继续运行")
                .setContentIntent(open)
                .setOngoing(true)
                .setShowWhen(false);
        if (Build.VERSION.SDK_INT >= 20) {
            b.addAction(new Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, NanoNotifications.smallIcon(this)),
                    "停止", stopPi).build());
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            b.setPriority(Notification.PRIORITY_LOW);
        }
        return b.build();
    }

    private void startForegroundCompat(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {
            }
        }
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {
        }
    }

    private void acquireLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Nano:KeepAlive");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
        } catch (Exception ignored) {
        }
    }

    private void releaseLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        releaseLock();
        super.onDestroy();
    }
}
