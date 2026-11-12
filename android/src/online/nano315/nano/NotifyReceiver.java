package online.nano315.nano;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class NotifyReceiver extends BroadcastReceiver {
    public static final String EXTRA_ID = "nano_notify_id";
    public static final String EXTRA_TITLE = "nano_notify_title";
    public static final String EXTRA_BODY = "nano_notify_body";
    public static final String EXTRA_TARGET = "nano_notify_target";
    public static final String EXTRA_CHANNEL = "nano_notify_channel";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        String target = intent.getStringExtra(EXTRA_TARGET);
        String channel = intent.getStringExtra(EXTRA_CHANNEL);
        int id = intent.getIntExtra(EXTRA_ID, (int) (System.currentTimeMillis() & 0x7fffffff));
        NanoNotifications.show(context, title, body, target, channel, id);
    }
}
