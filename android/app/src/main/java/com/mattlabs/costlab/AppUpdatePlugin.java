package com.mattlabs.costlab;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Minimal native side of the self-update flow. The web layer (which itself
 * updates instantly via GitHub Pages) decides WHEN to update; this plugin only
 * reports the installed version and hands a downloaded APK to the package
 * installer. Requires REQUEST_INSTALL_PACKAGES; the system prompts the user
 * to allow installs from this app the first time.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    @PluginMethod
    public void getInfo(PluginCall call) {
        try {
            PackageInfo pi = getContext()
                .getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionName", pi.versionName == null ? "0.0.0" : pi.versionName);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? pi.getLongVersionCode()
                : pi.versionCode;
            ret.put("versionCode", code);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("getInfo failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("invalid url");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File dir = new File(getContext().getFilesDir(), "apk");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File out = new File(dir, "costlab-update.apk");

                // GitHub releases redirect to a CDN; HttpURLConnection follows
                // same-protocol redirects across hosts automatically.
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(60000);
                conn.setInstanceFollowRedirects(true);
                int status = conn.getResponseCode();
                if (status != 200) {
                    call.reject("download failed: HTTP " + status);
                    return;
                }
                try (InputStream in = conn.getInputStream();
                     FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
                }

                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    out
                );
                Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject("update failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }, "costlab-update").start();
    }
}
