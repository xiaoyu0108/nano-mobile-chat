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
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;

/**
 * 系统悬浮聊天窗：一个可拖动的悬浮球 + 小窗，里面直接加载正常私聊页面。
 * 这样人设、API、历史消息、图片等全部复用 chat_inner，不用另写一套聊天逻辑。
 */
public class FloatChatService extends Service {
    private static final String TAG = "NanoFloatChat";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String CHANNEL_ID = "nano_float_chat";
    private static final int NOTIF_ID = 7422;
    public static final String ACTION_START = "online.nano315.nano.FLOAT_START";
    public static final String ACTION_STOP = "online.nano315.nano.FLOAT_STOP";
    public static final String EXTRA_CHAT_ID = "float_chat_id";
    public static final String EXTRA_CHAR_NAME = "float_char_name";
    public static final String EXTRA_AVATAR = "float_avatar";

    private static volatile boolean running = false;
    private WindowManager windowManager;
    private FrameLayout root;
    private LinearLayout panel;
    private FrameLayout bubble;
    private TextView bubbleText;
    private ImageView bubbleImage;
    private TextView titleText;
    private WebView webView;
    private WindowManager.LayoutParams params;
    private boolean expanded = false;
    private int screenW = 0;
    private int screenH = 0;
    private float downX, downY;
    private int downParamX, downParamY;
    private boolean dragged = false;
    private String chatId = "";
    private String charName = "";
    private String avatar = "";
    private String loadedUrl = "";

    public static boolean isRunning() {
        return running;
    }

    public static void start(Context ctx, String chatId, String name, String avatar) {
        Intent i = new Intent(ctx, FloatChatService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_CHAT_ID, chatId == null ? "" : chatId);
        i.putExtra(EXTRA_CHAR_NAME, name == null ? "" : name);
        i.putExtra(EXTRA_AVATAR, avatar == null ? "" : avatar);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Throwable t) {
            Log.e(TAG, "start failed", t);
        }
    }

    public static void stop(Context ctx) {
        try {
            ctx.stopService(new Intent(ctx, FloatChatService.class));
        } catch (Throwable ignored) {
        }
        running = false;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        ensureChannel();
        DisplayMetrics dm = getResources().getDisplayMetrics();
        screenW = dm.widthPixels;
        screenH = dm.heightPixels;
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
        chatId = intent.getStringExtra(EXTRA_CHAT_ID);
        charName = intent.getStringExtra(EXTRA_CHAR_NAME);
        avatar = intent.getStringExtra(EXTRA_AVATAR);
        if (chatId == null) chatId = "";
        if (charName == null || charName.isEmpty()) charName = "聊天";
        if (avatar == null) avatar = "";
        running = true;
        if (root == null) buildOverlay();
        else {
            updateTitle();
            loadChatUrl();
        }
        return START_NOT_STICKY;
    }

    private void startForegroundNow() {
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Throwable t) {
            // 某些 ROM 对 specialUse 限制较严时退回普通前台通知，悬浮球仍可显示。
            try { startForeground(NOTIF_ID, n); } catch (Throwable ignored) {}
        }
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void buildOverlay() {
        if (windowManager == null) return;
        root = new FrameLayout(this);
        root.setClipToOutline(true);
        GradientDrawable panelBg = new GradientDrawable();
        panelBg.setColor(Color.WHITE);
        panelBg.setCornerRadius(dp(18));
        root.setBackground(panelBg);

        // 收起状态：圆形悬浮球
        bubble = new FrameLayout(this);
        bubble.setLayoutParams(new FrameLayout.LayoutParams(dp(56), dp(56)));
        GradientDrawable ballBg = new GradientDrawable();
        ballBg.setShape(GradientDrawable.OVAL);
        ballBg.setColor(Color.parseColor("#FF9FBE"));
        ballBg.setStroke(dp(1), Color.parseColor("#66FFFFFF"));
        bubble.setBackground(ballBg);
        bubble.setClipToOutline(true);
        bubble.setOutlineProvider(ViewOutlineProvider.BACKGROUND);
        bubble.setElevation(dp(8));
        bubbleImage = new ImageView(this);
        bubbleImage.setScaleType(ImageView.ScaleType.CENTER_CROP);
        bubbleImage.setVisibility(View.GONE);
        bubble.addView(bubbleImage, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bubbleText = new TextView(this);
        bubbleText.setText(avatarInitial());
        bubbleText.setTextColor(Color.WHITE);
        bubbleText.setTextSize(20);
        bubbleText.setGravity(Gravity.CENTER);
        bubble.setLayoutParams(new FrameLayout.LayoutParams(dp(56), dp(56)));
        bubble.addView(bubbleText, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bubble.setOnTouchListener(new DragTouch());

        // 展开状态：标题栏 + 正常私聊页面
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setVisibility(View.GONE);
        GradientDrawable panelInner = new GradientDrawable();
        panelInner.setColor(Color.WHITE);
        panelInner.setCornerRadius(dp(18));
        panel.setBackground(panelInner);

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.setPadding(dp(14), 0, dp(8), 0);
        head.setBackgroundColor(Color.parseColor("#FFF3F7"));
        head.setOnTouchListener(new DragTouch());

        titleText = new TextView(this);
        titleText.setText(charName);
        titleText.setTextSize(14);
        titleText.setTextColor(Color.parseColor("#3A2630"));
        titleText.setSingleLine(true);
        titleText.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f);
        head.addView(titleText, titleLp);

        TextView collapse = new TextView(this);
        collapse.setText("—");
        collapse.setTextSize(17);
        collapse.setTextColor(Color.parseColor("#8A7078"));
        collapse.setGravity(Gravity.CENTER);
        collapse.setPadding(dp(10), 0, dp(10), 0);
        collapse.setOnClickListener(v -> collapse());
        head.addView(collapse, new LinearLayout.LayoutParams(dp(38), dp(42)));

        TextView close = new TextView(this);
        close.setText("×");
        close.setTextSize(20);
        close.setTextColor(Color.parseColor("#8A7078"));
        close.setGravity(Gravity.CENTER);
        close.setPadding(dp(10), 0, dp(10), 0);
        close.setOnClickListener(v -> stopSelf());
        head.addView(close, new LinearLayout.LayoutParams(dp(38), dp(42)));
        panel.addView(head, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)));

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " NanoApp/2.0");
        webView.setBackgroundColor(Color.WHITE);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Throwable ignored) {
                }
                return true;
            }
        });
        panel.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        root.addView(bubble);
        root.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        params = new WindowManager.LayoutParams(
                dp(56), dp(56),
                Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = Math.max(dp(8), screenW - dp(68));
        params.y = Math.max(dp(72), Math.round(screenH * 0.22f));
        try {
            windowManager.addView(root, params);
        } catch (Throwable t) {
            Log.e(TAG, "add overlay failed", t);
            stopSelf();
            return;
        }
        loadChatUrl();
        applyAvatar();
    }

    private String avatarInitial() {
        String n = charName == null ? "" : charName.trim();
        if (n.isEmpty()) return "聊";
        return n.substring(0, 1);
    }

    private void applyAvatar() {
        if (bubbleImage == null || bubbleText == null) return;
        final String src = avatar == null ? "" : avatar.trim();
        if (src.isEmpty()) {
            bubbleImage.setVisibility(View.GONE);
            bubbleText.setVisibility(View.VISIBLE);
            return;
        }
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                final Bitmap bmp = decodeAvatar(src);
                if (bmp == null) return;
                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override
                    public void run() {
                        if (bubbleImage == null || bubbleText == null || !src.equals(avatar)) {
                            bmp.recycle();
                            return;
                        }
                        bubbleImage.setImageBitmap(bmp);
                        bubbleImage.setVisibility(View.VISIBLE);
                        bubbleText.setVisibility(View.GONE);
                    }
                });
            }
        }, "nano-float-avatar");
        t.setDaemon(true);
        t.start();
    }

    private Bitmap decodeAvatar(String src) {
        try {
            if (src.startsWith("data:")) {
                int comma = src.indexOf(',');
                if (comma < 0) return null;
                String head = src.substring(0, comma);
                String data = src.substring(comma + 1);
                byte[] bytes;
                if (head.toLowerCase().contains(";base64")) {
                    bytes = Base64.decode(data, Base64.DEFAULT);
                } else {
                    bytes = Uri.decode(data).getBytes("UTF-8");
                }
                return decodeBytes(bytes);
            }
            if (src.startsWith("content://") || src.startsWith("file://")) {
                InputStream is = getContentResolver().openInputStream(Uri.parse(src));
                if (is == null) return null;
                try { return decodeStream(is); } finally { try { is.close(); } catch (Throwable ignored) {} }
            }
            if (src.startsWith("http://") || src.startsWith("https://")) {
                HttpURLConnection conn = (HttpURLConnection) new URL(src).openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "NanoApp/2.0");
                try { return decodeStream(conn.getInputStream()); } finally { conn.disconnect(); }
            }
        } catch (Throwable t) {
            Log.w(TAG, "avatar decode failed", t);
        }
        return null;
    }

    private Bitmap decodeStream(InputStream is) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return decodeBytes(out.toByteArray());
        } catch (Throwable t) {
            return null;
        }
    }

    private Bitmap decodeBytes(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        int sample = 1;
        while (bounds.outWidth / sample > 320 || bounds.outHeight / sample > 320) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
    }

    private void updateTitle() {
        if (titleText != null) titleText.setText(charName == null || charName.isEmpty() ? "聊天" : charName);
        if (bubbleText != null) bubbleText.setText(avatarInitial());
        applyAvatar();
    }

    private void loadChatUrl() {
        if (webView == null) return;
        String url = "https://" + HOST + "/html/chat_inner.html?chat=" + Uri.encode(chatId) +
                "&name=" + Uri.encode(charName == null ? "" : charName) + "&float=1&v=20261118a";
        if (url.equals(loadedUrl)) return;
        loadedUrl = url;
        webView.loadUrl(url);
    }

    private void expand() {
        if (expanded || root == null) return;
        expanded = true;
        bubble.setVisibility(View.GONE);
        panel.setVisibility(View.VISIBLE);
        int w = Math.min(dp(360), Math.round(screenW * 0.92f));
        int h = Math.min(dp(540), Math.round(screenH * 0.72f));
        if (params != null) {
            params.width = w;
            params.height = h;
            params.flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                    | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH;
            params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                    | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN;
            params.x = Math.max(dp(8), screenW - w - dp(10));
            params.y = Math.max(dp(56), Math.round(screenH * 0.12f));
            if (windowManager != null) {
                try { windowManager.updateViewLayout(root, params); } catch (Throwable ignored) {}
            }
        }
        if (webView != null) {
            webView.requestFocus();
            webView.resumeTimers();
        }
    }

    private void collapse() {
        if (!expanded || root == null) return;
        expanded = false;
        hideKeyboard();
        if (webView != null) webView.clearFocus();
        panel.setVisibility(View.GONE);
        bubble.setVisibility(View.VISIBLE);
        if (params != null) {
            params.width = dp(56);
            params.height = dp(56);
            params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
            params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN;
            params.x = Math.max(dp(8), screenW - dp(68));
            params.y = Math.max(dp(72), Math.round(screenH * 0.22f));
            if (windowManager != null) {
                try { windowManager.updateViewLayout(root, params); } catch (Throwable ignored) {}
            }
        }
    }

    private void hideKeyboard() {
        try {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null && webView != null) imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
        } catch (Throwable ignored) {
        }
    }

    private final class DragTouch implements View.OnTouchListener {
        @Override
        public boolean onTouch(View v, MotionEvent e) {
            if (params == null) return false;
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = e.getRawX();
                    downY = e.getRawY();
                    downParamX = params.x;
                    downParamY = params.y;
                    dragged = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - downX;
                    float dy = e.getRawY() - downY;
                    if (Math.abs(dx) > dp(3) || Math.abs(dy) > dp(3)) dragged = true;
                    if (dragged) {
                        int w = params.width > 0 ? params.width : dp(56);
                        int h = params.height > 0 ? params.height : dp(56);
                        params.x = Math.max(-dp(8), Math.min(screenW - w + dp(8), downParamX + Math.round(dx)));
                        params.y = Math.max(0, Math.min(screenH - dp(48), downParamY + Math.round(dy)));
                        try { if (windowManager != null) windowManager.updateViewLayout(root, params); } catch (Throwable ignored) {}
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    boolean wasDrag = dragged;
                    dragged = false;
                    if (!wasDrag && v == bubble) {
                        expand();
                    }
                    return true;
            }
            return false;
        }
    }

    private WebResourceResponse serveAsset(Uri uri) {
        if (uri == null || !HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        try {
            InputStream is = getAssets().open("www" + path);
            String mime = URLConnection.guessContentTypeFromName(path);
            if (mime == null) {
                if (path.endsWith(".js")) mime = "application/javascript";
                else if (path.endsWith(".css")) mime = "text/css";
                else if (path.endsWith(".json")) mime = "application/json";
                else if (path.endsWith(".svg")) mime = "image/svg+xml";
                else mime = "application/octet-stream";
            }
            return new WebResourceResponse(mime, "utf-8", is);
        } catch (Throwable t) {
            return null;
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "Nano 悬浮聊天", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("悬浮聊天窗运行中，可随时关闭");
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
        PendingIntent content = PendingIntent.getActivity(this, 3, open, piFlags);
        Intent stop = new Intent(this, FloatChatService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 4, stop, piFlags);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) b = new Notification.Builder(this, CHANNEL_ID);
        else {
            b = new Notification.Builder(this);
            b.setPriority(Notification.PRIORITY_LOW);
        }
        b.setContentTitle("Nano 悬浮聊天")
                .setContentText("点悬浮球继续聊天，点这里可关闭")
                .setSmallIcon(NanoNotifications.smallIcon(this))
                .setContentIntent(content)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE);
        try { b.addAction(android.R.drawable.ic_delete, "关闭悬浮窗", stopPi); } catch (Throwable ignored) {}
        return b.build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            if (windowManager != null && root != null) windowManager.removeView(root);
        } catch (Throwable ignored) {}
        root = null;
        if (webView != null) {
            try {
                webView.loadUrl("about:blank");
                webView.destroy();
            } catch (Throwable ignored) {}
            webView = null;
        }
        try { stopForeground(true); } catch (Throwable ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
