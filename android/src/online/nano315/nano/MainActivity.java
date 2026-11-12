package online.nano315.nano;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String TAG = "NanoApp";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 1001;
    private static final int REQ_MEDIA = 1002;
    private static final int REQ_GEO = 1003;
    private static final int REQ_STORAGE = 1004;
    private static final int REQ_NOTIFY = 1005;

    static final String EXTRA_TARGET = "nano_notify_target";
    private static final String PREFS = "nano_native_prefs";
    private static final String PREF_TOKEN = "account_token";
    private static final String PREF_USER = "account_user";
    private static final String PREF_DEVICE = "device_id";

    private static final String DOWNLOAD_HOOK_JS =
            "(function(){" +
            "if(window.__nanoDlHook)return;window.__nanoDlHook=true;" +
            "function hook(w){try{var d=w.document;if(!d||d.__nanoDlHooked)return;d.__nanoDlHooked=true;" +
            "d.addEventListener('click',function(e){try{" +
            "var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;if(!a)return;" +
            "var href=a.href||'';if(!/^(blob:|data:)/i.test(href))return;" +
            "e.preventDefault();e.stopPropagation();" +
            "fetch(href).then(function(r){return r.blob();}).then(function(b){var fr=new FileReader();" +
            "fr.onload=function(){var s=String(fr.result||'');var i=s.indexOf(',');" +
            "var n=a.getAttribute('download')||'download';" +
            "try{NanoApp.saveBase64(n,b.type||'',i>=0?s.slice(i+1):'');}catch(err){}};" +
            "fr.readAsDataURL(b);}).catch(function(){});" +
            "}catch(err){}},true);}catch(err){}}" +
            "function all(){hook(window);try{var fs=document.querySelectorAll('iframe');" +
            "for(var i=0;i<fs.length;i++){try{hook(fs[i].contentWindow);}catch(e){}}}catch(e){}}" +
            "all();setInterval(all,1500);" +
            "})();";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermissionRequest;
    private String[] pendingMediaPermissions;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private Map<String, String> assetNameCache;
    private String pendingNotifyTarget;
    private boolean pageReady;
    private String pendingNotificationJson;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        NanoNotifications.ensureChannels(this);
        applyFullscreen();

        Intent launch = getIntent();
        if (launch != null) pendingNotifyTarget = launch.getStringExtra(EXTRA_TARGET);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webView);

        if (Build.VERSION.SDK_INT >= 28) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                DisplayCutout cutout = insets.getDisplayCutout();
                int top = cutout == null ? 0 : Math.max(0, cutout.getSafeInsetTop());
                applyNativeInsets(top);
                return insets;
            });
            try { root.requestApplyInsets(); } catch (Exception ignored) {}
        }

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadsImagesAutomatically(true);
        s.setBlockNetworkImage(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setGeolocationEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " NanoApp/2.0");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            s.setAlgorithmicDarkeningAllowed(false);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        WebView.setWebContentsDebuggingEnabled(false);

        webView.addJavascriptInterface(new NanoBridge(), "NanoApp");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                final String target = pendingNotifyTarget;
                if (target != null && !target.isEmpty()) {
                    view.postDelayed(() -> dispatchNotifyTarget(target), 650);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        grantWebPermission(request);
                    }
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback callback) {
                requestGeolocation(origin, callback);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             WebChromeClient.FileChooserParams params) {
                return openFileChooser(callback, params);
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue,
                                      final JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue == null ? "" : defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton(android.R.string.ok,
                                (dialog, which) -> result.confirm(input.getText().toString()))
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                          Message resultMsg) {
                final WebView temp = new WebView(MainActivity.this);
                temp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        Uri uri = request.getUrl();
                        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                        if (scheme.equals("http") || scheme.equals("https")) {
                            openExternal(uri);
                        }
                        temp.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(temp);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onConsoleMessage(String message, int lineNumber, String sourceID) {
                Log.d("NanoWeb", message + " (" + sourceID + ":" + lineNumber + ")");
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || url.startsWith("blob:") || url.startsWith("data:")) return;
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                if (mimeType != null) request.setMimeType(mimeType);
                if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String name = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.enqueue(request);
                    Toast.makeText(MainActivity.this, "开始下载…", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                Log.e(TAG, "download failed", e);
                Toast.makeText(MainActivity.this, "下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        if (Build.VERSION.SDK_INT <= 28
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
        }

        webView.loadUrl(START_URL);
    }

    private WebResourceResponse serveAsset(Uri uri) {
        if (uri == null || !HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        if (!path.startsWith("/")) path = "/" + path;
        if (path.contains("..")) return notFound(path);
        String mime = mimeFor(path);
        String assetPath = "www" + path;
        try {
            InputStream is = openAsset(assetPath);
            WebResourceResponse response = new WebResourceResponse(
                    mime, isText(mime) ? "UTF-8" : null, is);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("Access-Control-Allow-Origin", "*");
            response.setResponseHeaders(headers);
            return response;
        } catch (IOException e) {
            Log.e(TAG, "asset not found: " + assetPath);
            return notFound(assetPath);
        }
    }

    // 正常 APK 里的 assets 路径是 www/index.html。
    // 如果构建机上的 aapt2 把路径写成 www\index.html，AssetManager 会找不到；
    // 这里用运行时索引做兜底，旧 APK / 未修复的构建也能正常打开。
    private InputStream openAsset(String assetPath) throws IOException {
        try {
            return getAssets().open(assetPath);
        } catch (IOException first) {
            String backslash = assetPath.replace('/', '\\');
            if (!backslash.equals(assetPath)) {
                try {
                    return getAssets().open(backslash);
                } catch (IOException ignored) {
                }
            }
            String mapped = assetIndex().get(assetPath);
            if (mapped != null && !mapped.equals(assetPath)) {
                return getAssets().open(mapped);
            }
            throw first;
        }
    }

    private Map<String, String> assetIndex() {
        if (assetNameCache != null) return assetNameCache;
        Map<String, String> index = new HashMap<>();
        try {
            String[] root = getAssets().list("");
            if (root != null) {
                for (String name : root) {
                    if (name == null) continue;
                    index.put(name.replace('\\', '/'), name);
                }
            }
        } catch (IOException e) {
            Log.e(TAG, "asset index failed", e);
        }
        assetNameCache = index;
        return assetNameCache;
    }

    private WebResourceResponse notFound(String path) {
        String body = "Not found: " + (path == null ? "" : path);
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                new HashMap<String, String>(),
                new ByteArrayInputStream(body.getBytes()));
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".m4a")) return "audio/mp4";
        if (p.endsWith(".mp4")) return "video/mp4";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/")
                || mime.equals("application/javascript")
                || mime.equals("application/json")
                || mime.equals("image/svg+xml")
                || mime.equals("application/wasm");
    }

    private boolean handleUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (scheme.equals("http") || scheme.equals("https")) {
            if (HOST.equals(uri.getHost())) return false;
            openExternal(uri);
            return true;
        }
        if (scheme.equals("intent")) {
            try {
                Intent intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                startActivity(intent);
            } catch (Exception e) {
                Toast.makeText(this, "无法打开链接", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
        if (scheme.equals("tel") || scheme.equals("mailto") || scheme.equals("sms")) {
            openExternal(uri);
            return true;
        }
        if (scheme.equals("blob") || scheme.equals("data")
                || scheme.equals("about") || scheme.equals("javascript")) {
            return false;
        }
        try {
            openExternal(uri);
        } catch (Exception ignored) {
        }
        return true;
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "没有可打开该链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private void grantWebPermission(PermissionRequest request) {
        if (pendingPermissionRequest != null) {
            try {
                pendingPermissionRequest.deny();
            } catch (Exception ignored) {
            }
            pendingPermissionRequest = null;
        }
        String[] resources = request.getResources();
        boolean needCamera = false;
        boolean needMic = false;
        for (String r : resources) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) needCamera = true;
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) needMic = true;
        }
        java.util.ArrayList<String> missing = new java.util.ArrayList<>();
        if (needCamera && checkSelfPermission(Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (needMic && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!missing.isEmpty()) {
            pendingPermissionRequest = request;
            pendingMediaPermissions = missing.toArray(new String[0]);
            requestPermissions(pendingMediaPermissions, REQ_MEDIA);
            return;
        }
        try {
            request.grant(resources);
        } catch (Exception e) {
            request.deny();
        }
    }

    private void requestGeolocation(String origin, GeolocationPermissions.Callback callback) {
        boolean granted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            callback.invoke(origin, true, false);
            return;
        }
        pendingGeoOrigin = origin;
        pendingGeoCallback = callback;
        requestPermissions(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
        }, REQ_GEO);
    }

    private boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        fileCallback = callback;
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        String[] accept = params.getAcceptTypes();
        if (accept != null && accept.length > 0) {
            java.util.ArrayList<String> mimes = new java.util.ArrayList<>();
            for (String a : accept) {
                if (a != null && a.contains("/")) mimes.add(a);
            }
            if (mimes.size() == 1) {
                intent.setType(mimes.get(0));
            } else if (mimes.size() > 1) {
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
            }
        }
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(Intent.createChooser(intent, "选择文件"), REQ_FILE);
        } catch (Exception e) {
            fileCallback = null;
            Toast.makeText(this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
            return false;
        }
        return true;
    }

    private void applyNativeInsets(int top) {
        if (webView == null) return;
        final int t = Math.max(0, top);
        String js = "try{window.__NANO_NATIVE_TOP_INSET__=" + t +
                ";document.documentElement.style.setProperty('--safe-inset-top','" + t + "px');" +
                "window.dispatchEvent(new Event('resize'));}catch(e){}";
        try {
            webView.post(() -> {
                try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {
        }
    }

    private void applyFullscreen() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                window.setDecorFitsSystemWindows(true);
                WindowInsetsController c = window.getInsetsController();
                if (c != null) {
                    c.hide(WindowInsets.Type.statusBars());
                    c.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    c.setSystemBarsAppearance(
                            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                }
            } catch (Exception ignored) {
            }
        } else {
            int ui = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_FULLSCREEN;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ui |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(ui);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreen();
    }

    private void requestNotifyPermission(String pendingJson) {
        if (pendingJson != null) pendingNotificationJson = pendingJson;
        if (Build.VERSION.SDK_INT < 33) {
            showPendingNotification();
            return;
        }
        if (NanoNotifications.allowed(this)) {
            showPendingNotification();
            return;
        }
        try {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean("notify_requested", true).apply();
        } catch (Exception ignored) {
        }
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
    }

    private void showPendingNotification() {
        String raw = pendingNotificationJson;
        pendingNotificationJson = null;
        if (raw == null || raw.isEmpty()) return;
        try {
            org.json.JSONObject o = new org.json.JSONObject(raw);
            String title = o.optString("title", "Nano");
            String body = o.optString("body", "");
            String target = o.optString("target", "");
            String channel = o.optString("channel", "");
            int id = (title + "|" + body + "|" + target).hashCode() & 0x7fffffff;
            NanoNotifications.show(this, title, body, target, channel, id);
        } catch (Exception ignored) {
        }
    }

    private void scheduleNativeNotification(String id, long at, String title, String body,
                                             String target, String channel) {
        try {
            String key = (id == null || id.isEmpty())
                    ? ("nano-" + at + "-" + String.valueOf(title)) : id;
            int requestCode = key.hashCode() & 0x7fffffff;
            String channelId = NanoNotifications.safeChannel(channel);
            Intent intent = new Intent(this, NotifyReceiver.class);
            intent.putExtra(NotifyReceiver.EXTRA_ID, requestCode);
            intent.putExtra(NotifyReceiver.EXTRA_TITLE, title == null ? "Nano" : title);
            intent.putExtra(NotifyReceiver.EXTRA_BODY, body == null ? "" : body);
            intent.putExtra(NotifyReceiver.EXTRA_TARGET, target == null ? "" : target);
            intent.putExtra(NotifyReceiver.EXTRA_CHANNEL, channelId);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(this, requestCode, intent, flags);
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= 21 && "pomodoro".equalsIgnoreCase(String.valueOf(channel))) {
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, pi), pi);
                return;
            }
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else if (Build.VERSION.SDK_INT >= 23) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception e) {
            try {
                AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (am != null) am.set(AlarmManager.RTC_WAKEUP, at, PendingIntent.getBroadcast(
                        this, (id == null ? "" : id).hashCode() & 0x7fffffff,
                        new Intent(this, NotifyReceiver.class), 0));
            } catch (Exception ignored) {
            }
        }
    }

    private void cancelNativeNotification(String id) {
        try {
            int requestCode = (id == null ? "" : id).hashCode() & 0x7fffffff;
            Intent intent = new Intent(this, NotifyReceiver.class);
            int flags = PendingIntent.FLAG_NO_CREATE;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(this, requestCode, intent, flags);
            if (pi != null) {
                AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (am != null) am.cancel(pi);
                pi.cancel();
            }
            NanoNotifications.cancel(this, requestCode);
        } catch (Exception ignored) {
        }
    }

    private void dispatchNotifyTarget(String target) {
        if (target == null || target.isEmpty() || webView == null) return;
        pendingNotifyTarget = null;
        String js = "try{window.postMessage({type:'notifyOpen',target:"
                + org.json.JSONObject.quote(target) + "},'*');}catch(e){}";
        try {
            webView.evaluateJavascript(js, null);
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String target = intent == null ? null : intent.getStringExtra(EXTRA_TARGET);
        if (target == null || target.isEmpty()) return;
        if (pageReady) dispatchNotifyTarget(target);
        else pendingNotifyTarget = target;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    results = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        results[i] = clip.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(results);
                fileCallback = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFY) {
            if (NanoNotifications.allowed(this)) showPendingNotification();
            else pendingNotificationJson = null;
        } else if (requestCode == REQ_MEDIA && pendingPermissionRequest != null) {
            boolean ok = true;
            for (int r : grantResults) {
                if (r != PackageManager.PERMISSION_GRANTED) {
                    ok = false;
                    break;
                }
            }
            try {
                if (ok) {
                    pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
                } else {
                    pendingPermissionRequest.deny();
                }
            } catch (Exception ignored) {
            }
            pendingPermissionRequest = null;
            pendingMediaPermissions = null;
        } else if (requestCode == REQ_GEO && pendingGeoCallback != null) {
            boolean ok = false;
            for (int r : grantResults) {
                if (r == PackageManager.PERMISSION_GRANTED) {
                    ok = true;
                    break;
                }
            }
            pendingGeoCallback.invoke(pendingGeoOrigin, ok, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return !!(window.__nanoGoBack&&window.__nanoGoBack());}catch(e){return false;}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        finish();
                    }
                });
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            try {
                webView.loadUrl("about:blank");
                webView.removeJavascriptInterface("NanoApp");
                webView.destroy();
            } catch (Exception ignored) {
            }
            webView = null;
        }
        super.onDestroy();
    }

    public class NanoBridge {
        @JavascriptInterface
        public void saveBase64(String name, String mime, String base64) {
            saveBytes(name, mime, base64);
        }

        @JavascriptInterface
        public void saveText(String name, String mime, String text) {
            try {
                byte[] data = String.valueOf(text == null ? "" : text).getBytes("UTF-8");
                writeDownload(name, mime, data);
            } catch (Exception e) {
                toast("保存失败：" + e.getMessage());
            }
        }

        @JavascriptInterface
        public String getSession() {
            try {
                SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
                String token = sp.getString(PREF_TOKEN, "");
                String user = sp.getString(PREF_USER, "");
                if (token.isEmpty() || user.isEmpty()) return "";
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("token", token);
                o.put("username", user);
                o.put("deviceId", sp.getString(PREF_DEVICE, ""));
                return o.toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void saveSession(String token, String user, String deviceId) {
            try {
                if (token == null || token.isEmpty() || user == null || user.isEmpty()) return;
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString(PREF_TOKEN, token)
                        .putString(PREF_USER, user)
                        .putString(PREF_DEVICE, deviceId == null ? "" : deviceId)
                        .commit();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void clearSession() {
            try {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .remove(PREF_TOKEN).remove(PREF_USER).commit();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String getInsets() {
            int top = 0;
            try {
                if (Build.VERSION.SDK_INT >= 28) {
                    WindowInsets ins = getWindow().getDecorView().getRootWindowInsets();
                    if (ins != null) {
                        DisplayCutout cutout = ins.getDisplayCutout();
                        if (cutout != null) top = Math.max(0, cutout.getSafeInsetTop());
                    }
                }
            } catch (Exception ignored) {
            }
            return "{\"top\":" + top + ",\"bottom\":0}";
        }

        @JavascriptInterface
        public String notificationState() {
            if (Build.VERSION.SDK_INT < 33) return "granted";
            if (NanoNotifications.allowed(MainActivity.this)) return "granted";
            boolean asked = getSharedPreferences(PREFS, MODE_PRIVATE)
                    .getBoolean("notify_requested", false);
            return asked ? "denied" : "default";
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> requestNotifyPermission(null));
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(() -> {
                try {
                    Intent i;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                        i.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    } else {
                        i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        i.setData(Uri.parse("package:" + getPackageName()));
                    }
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    toast("无法打开通知设置");
                }
            });
        }

        @JavascriptInterface
        public void notifyNow(String title, String body, String optsJson) {
            String target = "";
            String channel = "";
            try {
                if (optsJson != null && !optsJson.isEmpty()) {
                    org.json.JSONObject o = new org.json.JSONObject(optsJson);
                    target = o.optString("target", "");
                    channel = o.optString("channel", "");
                    if (channel.isEmpty()) channel = o.optString("app", "");
                }
            } catch (Exception ignored) {
            }
            final String fTarget = target;
            final String fChannel = channel;
            final String fTitle = title;
            final String fBody = body;
            final String pending = "{\"title\":" + org.json.JSONObject.quote(title == null ? "" : title)
                    + ",\"body\":" + org.json.JSONObject.quote(body == null ? "" : body)
                    + ",\"target\":" + org.json.JSONObject.quote(fTarget)
                    + ",\"channel\":" + org.json.JSONObject.quote(fChannel) + "}";
            runOnUiThread(() -> {
                if (!NanoNotifications.allowed(MainActivity.this)) {
                    pendingNotificationJson = pending;
                    requestNotifyPermission(null);
                    return;
                }
                int id = (fTitle + "|" + fBody + "|" + fTarget).hashCode() & 0x7fffffff;
                NanoNotifications.show(MainActivity.this, fTitle, fBody, fTarget, fChannel, id);
            });
        }

        @JavascriptInterface
        public void scheduleNotify(String id, String atMillis, String title, String body,
                                   String target, String channel) {
            long at = 0;
            try { at = Long.parseLong(String.valueOf(atMillis)); } catch (Exception ignored) {}
            if (at <= 0) at = System.currentTimeMillis() + 1000;
            final long when = at;
            final String fId = String.valueOf(id == null ? "" : id);
            final String fTitle = title;
            final String fBody = body;
            final String fTarget = target;
            final String fChannel = channel;
            runOnUiThread(() -> scheduleNativeNotification(fId, when, fTitle, fBody, fTarget, fChannel));
        }

        @JavascriptInterface
        public void cancelNotify(String id) {
            final String fId = String.valueOf(id == null ? "" : id);
            runOnUiThread(() -> cancelNativeNotification(fId));
        }

        @JavascriptInterface
        public void setKeepAlive(boolean on) {
            if (on) KeepAliveService.start(MainActivity.this);
            else KeepAliveService.stop(MainActivity.this);
        }
    }

    private void saveBytes(String name, String mime, String base64) {
        try {
            byte[] data = Base64.decode(String.valueOf(base64 == null ? "" : base64), Base64.DEFAULT);
            writeDownload(name, mime, data);
        } catch (Exception e) {
            toast("保存失败：" + e.getMessage());
        }
    }

    private void writeDownload(String name, String mime, byte[] data) {
        String safe = name == null || name.trim().isEmpty() ? "nano-download" : name.trim();
        safe = safe.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (safe.length() > 120) safe = safe.substring(0, 120);
        String type = mime == null || mime.trim().isEmpty()
                ? "application/octet-stream" : mime.trim();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                values.put(MediaStore.Downloads.MIME_TYPE, type);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("无法创建下载任务");
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) throw new IOException("无法写入下载文件");
                    os.write(data);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, values, null, null);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建下载目录");
                File out = new File(dir, safe);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(data);
                }
            }
            toast("已保存到下载目录：" + safe);
        } catch (Exception e) {
            Log.e(TAG, "writeDownload failed", e);
            toast("保存失败：" + e.getMessage());
        }
    }

    private void toast(final String text) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_LONG).show());
    }
}
