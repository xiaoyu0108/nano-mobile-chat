package online.nano315.nano;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * 安卓端屏幕采集桥。
 *
 * 只做「定时截帧」：把当前屏幕压成 JPEG 放在内存里，网页通过 NanoApp.getScreenFrame()
 * 按需取走。真正的录屏授权、前台服务通知都由系统控制，不能静默采集。
 */
public class ScreenCaptureService extends Service {
    private static final String TAG = "NanoScreenCapture";
    public static final String ACTION_START = "online.nano315.nano.SCREEN_START";
    public static final String ACTION_STOP = "online.nano315.nano.SCREEN_STOP";
    public static final String EXTRA_RESULT_CODE = "screen_result_code";
    public static final String EXTRA_RESULT_DATA = "screen_result_data";

    private static final String CHANNEL_ID = "nano_screen_capture";
    private static final int NOTIF_ID = 7421;
    private static final long FRAME_INTERVAL_MS = 1000L;
    private static final long SHARE_TICK_MS = 30000L;
    private static final int MAX_EDGE = 1280;
    private static final int JPEG_QUALITY = 70;

    private static volatile boolean starting = false;
    private static volatile boolean running = false;
    private static volatile String lastError = "";
    private static volatile byte[] latestJpeg = null;
    private static volatile long frameAt = 0L;
    private static volatile int frameWidth = 0;
    private static volatile int frameHeight = 0;

    private static final Object FRAME_LOCK = new Object();
    private static final Object DISPLAY_LOCK = new Object();

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private DisplayManager displayManager;
    private DisplayManager.DisplayListener displayListener;
    private Handler mainHandler;
    private int captureWidth = 0;
    private int captureHeight = 0;
    private int captureDensity = 0;
    private long lastProcessedAt = 0L;
    private volatile boolean stopping = false;
    private boolean rebuilding = false;

    public static boolean isRunning() {
        return running;
    }

    public static String stateJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("supported", true);
            o.put("active", running);
            o.put("requesting", starting);
            o.put("state", running ? "active" : (starting ? "requesting" : (
                    "denied".equals(lastError) ? "denied" : (lastError.isEmpty() ? "idle" : "error"))));
            o.put("error", lastError);
            o.put("width", frameWidth);
            o.put("height", frameHeight);
            o.put("frameAt", frameAt);
            o.put("intervalMs", FRAME_INTERVAL_MS);
            return o.toString();
        } catch (Throwable t) {
            return "{\"supported\":true,\"active\":false,\"state\":\"error\"}";
        }
    }

    public static String frameDataUrl() {
        synchronized (FRAME_LOCK) {
            if (latestJpeg == null || latestJpeg.length == 0) return "";
            try {
                return "data:image/jpeg;base64," + Base64.encodeToString(latestJpeg, Base64.NO_WRAP);
            } catch (Throwable t) {
                return "";
            }
        }
    }

    public static void setError(String error) {
        starting = false;
        lastError = error == null ? "" : error;
    }

    public static void start(Context ctx, int resultCode, Intent data) {
        starting = true;
        lastError = "";
        synchronized (FRAME_LOCK) {
            latestJpeg = null;
            frameAt = 0L;
        }
        Intent i = new Intent(ctx, ScreenCaptureService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_RESULT_CODE, resultCode);
        i.putExtra(EXTRA_RESULT_DATA, data);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Throwable t) {
            starting = false;
            lastError = "start_failed: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            Log.e(TAG, "start service failed", t);
        }
    }

    public static void stop(Context ctx) {
        try {
            ctx.stopService(new Intent(ctx, ScreenCaptureService.class));
        } catch (Throwable ignored) {
        }
        running = false;
        starting = false;
        lastError = "";
    }

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        displayManager = (DisplayManager) getSystemService(DISPLAY_SERVICE);
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForegroundNow();
        if (running && projection != null) {
            starting = false;
            return START_NOT_STICKY;
        }
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= 33) {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
        startCapture(resultCode, resultData);
        return START_NOT_STICKY;
    }

    private void startForegroundNow() {
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Throwable t) {
            Log.e(TAG, "startForeground failed", t);
        }
    }

    private void startCapture(int resultCode, Intent resultData) {
        if (resultCode != android.app.Activity.RESULT_OK || resultData == null) {
            setError("denied");
            stopSelf();
            return;
        }
        try {
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            if (manager == null) throw new IllegalStateException("MediaProjectionManager unavailable");
            projection = manager.getMediaProjection(resultCode, resultData);
            if (projection == null) throw new IllegalStateException("MediaProjection unavailable");

            // Android 14+：必须在 createVirtualDisplay 之前注册回调。
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    Log.i(TAG, "MediaProjection stopped by system/user");
                    stopSelf();
                }
            }, mainHandler);

            ensureCaptureThread();
            synchronized (DISPLAY_LOCK) {
                setupDisplayLocked();
            }
            startDisplayListener();
            running = true;
            starting = false;
            lastError = "";
            scheduleShareTick();
            Log.i(TAG, "screen capture started " + captureWidth + "x" + captureHeight);
        } catch (Throwable t) {
            starting = false;
            lastError = "start_failed: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            Log.e(TAG, "startCapture failed", t);
            stopSelf();
        }
    }

    private void ensureCaptureThread() {
        if (captureThread != null && captureThread.isAlive()) return;
        captureThread = new HandlerThread("nano-screen-capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
    }

    private final Runnable shareTickRunnable = new Runnable() {
        @Override
        public void run() {
            if (stopping || !running) return;
            try { MainActivity.requestScreenShareTick(); } catch (Throwable ignored) {}
            if (mainHandler != null && !stopping) mainHandler.postDelayed(this, SHARE_TICK_MS);
        }
    };

    private void scheduleShareTick() {
        if (mainHandler == null) return;
        mainHandler.removeCallbacks(shareTickRunnable);
        mainHandler.postDelayed(shareTickRunnable, SHARE_TICK_MS);
    }

    private void computeCaptureSize() {
        int w = 0, h = 0;
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (wm != null) {
                if (Build.VERSION.SDK_INT >= 30) {
                    Rect bounds = wm.getMaximumWindowMetrics().getBounds();
                    w = bounds.width();
                    h = bounds.height();
                } else {
                    DisplayMetrics dm = new DisplayMetrics();
                    wm.getDefaultDisplay().getRealMetrics(dm);
                    w = dm.widthPixels;
                    h = dm.heightPixels;
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "computeCaptureSize failed", t);
        }
        if (w <= 0 || h <= 0) {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            w = dm.widthPixels;
            h = dm.heightPixels;
        }
        if (w <= 0 || h <= 0) throw new IllegalStateException("invalid display size");
        float scale = Math.min(1f, MAX_EDGE / (float) Math.max(w, h));
        int cw = Math.max(2, Math.round(w * scale));
        int ch = Math.max(2, Math.round(h * scale));
        captureWidth = (cw / 2) * 2;
        captureHeight = (ch / 2) * 2;
        captureDensity = getResources().getDisplayMetrics().densityDpi;
        if (captureDensity <= 0) captureDensity = DisplayMetrics.DENSITY_DEFAULT;
    }

    private void setupDisplayLocked() {
        int oldW = captureWidth, oldH = captureHeight;
        computeCaptureSize();
        if (virtualDisplay != null && oldW == captureWidth && oldH == captureHeight && imageReader != null) return;
        releaseDisplayLocked();
        ensureCaptureThread();
        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
            @Override
            public void onImageAvailable(ImageReader reader) {
                onFrame(reader);
            }
        }, captureHandler);
        virtualDisplay = projection.createVirtualDisplay(
                "NanoScreen",
                captureWidth,
                captureHeight,
                captureDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                captureHandler
        );
    }

    private void releaseDisplayLocked() {
        try {
            if (virtualDisplay != null) virtualDisplay.release();
        } catch (Throwable ignored) {
        }
        virtualDisplay = null;
        try {
            if (imageReader != null) imageReader.close();
        } catch (Throwable ignored) {
        }
        imageReader = null;
    }

    private void startDisplayListener() {
        if (displayManager == null || displayListener != null) return;
        displayListener = new DisplayManager.DisplayListener() {
            @Override
            public void onDisplayAdded(int displayId) {
            }

            @Override
            public void onDisplayRemoved(int displayId) {
            }

            @Override
            public void onDisplayChanged(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) return;
                scheduleRebuild();
            }
        };
        try {
            displayManager.registerDisplayListener(displayListener, mainHandler);
        } catch (Throwable t) {
            Log.e(TAG, "registerDisplayListener failed", t);
        }
    }

    private void stopDisplayListener() {
        if (displayManager != null && displayListener != null) {
            try {
                displayManager.unregisterDisplayListener(displayListener);
            } catch (Throwable ignored) {
            }
        }
        displayListener = null;
    }

    private void scheduleRebuild() {
        if (stopping || projection == null) return;
        if (mainHandler == null) return;
        mainHandler.removeCallbacks(rebuildRunnable);
        mainHandler.postDelayed(rebuildRunnable, 500L);
    }

    private final Runnable rebuildRunnable = new Runnable() {
        @Override
        public void run() {
            if (stopping || projection == null) return;
            if (rebuilding) return;
            rebuilding = true;
            try {
                synchronized (DISPLAY_LOCK) {
                    setupDisplayLocked();
                }
            } catch (Throwable t) {
                lastError = "frame_failed: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
                Log.e(TAG, "rebuild display failed", t);
            } finally {
                rebuilding = false;
            }
        }
    };

    private void onFrame(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;
            long now = SystemClock.elapsedRealtime();
            if (now - lastProcessedAt < FRAME_INTERVAL_MS) {
                image.close();
                return;
            }
            lastProcessedAt = now;
            if (rebuilding || stopping) {
                image.close();
                return;
            }
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int rowPadding = rowStride - pixelStride * captureWidth;
            int bitmapWidth = captureWidth + (pixelStride > 0 ? rowPadding / pixelStride : 0);
            if (bitmapWidth <= 0) {
                image.close();
                return;
            }
            Bitmap full = Bitmap.createBitmap(bitmapWidth, captureHeight, Bitmap.Config.ARGB_8888);
            buffer.rewind();
            full.copyPixelsFromBuffer(buffer);
            Bitmap cropped = full;
            if (bitmapWidth != captureWidth) {
                cropped = Bitmap.createBitmap(full, 0, 0, captureWidth, captureHeight);
                full.recycle();
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out);
            cropped.recycle();
            byte[] bytes = out.toByteArray();
            synchronized (FRAME_LOCK) {
                latestJpeg = bytes;
                frameAt = System.currentTimeMillis();
                frameWidth = captureWidth;
                frameHeight = captureHeight;
            }
        } catch (Throwable t) {
            lastError = "frame_failed: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            Log.e(TAG, "frame failed", t);
        } finally {
            try {
                if (image != null) image.close();
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopping = true;
        running = false;
        starting = false;
        try {
            if (mainHandler != null) {
                mainHandler.removeCallbacks(rebuildRunnable);
                mainHandler.removeCallbacks(shareTickRunnable);
            }
        } catch (Throwable ignored) {
        }
        stopDisplayListener();
        synchronized (DISPLAY_LOCK) {
            releaseDisplayLocked();
        }
        try {
            if (projection != null) projection.stop();
        } catch (Throwable ignored) {
        }
        projection = null;
        try {
            if (captureThread != null) captureThread.quitSafely();
        } catch (Throwable ignored) {
        }
        captureThread = null;
        captureHandler = null;
        synchronized (FRAME_LOCK) {
            latestJpeg = null;
            frameAt = 0L;
            frameWidth = 0;
            frameHeight = 0;
        }
        try {
            stopForeground(true);
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "Nano 屏幕共享", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("屏幕共享期间显示，可随时停止");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        } catch (Throwable ignored) {
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 1, open, piFlags);
        Intent stop = new Intent(this, ScreenCaptureService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 2, stop, piFlags);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(this, CHANNEL_ID);
        } else {
            b = new Notification.Builder(this);
            b.setPriority(Notification.PRIORITY_LOW);
        }
        b.setContentTitle("Nano 正在查看屏幕")
                .setContentText("每 30 秒取一帧，仅用于角色点评。点此可停止。")
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentIntent(content)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE);
        try {
            b.addAction(android.R.drawable.ic_delete, "停止共享", stopPi);
        } catch (Throwable ignored) {
        }
        return b.build();
    }
}
