package com.glok.app;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Model files kept in the app's own storage: download (resumes after a break), copy from the phone, delete. */
final class ModelStore {
    private static final String TAG = "GlokModels";
    private static final AtomicInteger seq = new AtomicInteger(1000);
    private static final ConcurrentHashMap<Integer, boolean[]> cancels = new ConcurrentHashMap<>();

    private ModelStore() {}

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "models");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** keeps names to plain letters so the native side sees the same path */
    static String safeName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\s]+", "_").replaceAll("[^A-Za-z0-9._()\\-]", "_");
        if (n.isEmpty() || n.startsWith(".")) n = "model" + n;
        if (!n.toLowerCase().endsWith(".gguf")) n = n + ".gguf";
        return n;
    }

    static File file(Context c, String name) {
        return new File(dir(c), safeName(name));
    }

    static boolean isGguf(File f) {
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[4];
            return in.read(b) == 4 && b[0] == 'G' && b[1] == 'G' && b[2] == 'U' && b[3] == 'F';
        } catch (Exception e) {
            return false;
        }
    }

    static JSONArray list(Context c) {
        JSONArray a = new JSONArray();
        File[] fs = dir(c).listFiles();
        if (fs == null) return a;
        for (File f : fs) {
            if (!f.getName().endsWith(".gguf")) continue;
            try {
                a.put(new JSONObject().put("file", f.getName()).put("size", f.length()));
            } catch (Exception ignored) {
            }
        }
        return a;
    }

    static long freeSpace(Context c) {
        return dir(c).getUsableSpace();
    }

    static boolean delete(Context c, String name) {
        File f = file(c, name);
        new File(f.getPath() + ".part").delete();
        return !f.exists() || f.delete();
    }

    static void deleteAll(Context c) {
        File[] fs = dir(c).listFiles();
        if (fs != null) for (File f : fs) f.delete();
    }

    static void cancel(int id) {
        boolean[] flag = cancels.get(id);
        if (flag != null) flag[0] = true;
    }

    /** downloads url to models/name; events {type:"dl", id, got, total} and finally {done, ok} */
    static int download(Context c, String url, String name, long size, LlmEngine.Sink sink) {
        final int id = seq.incrementAndGet();
        final boolean[] stop = {false};
        cancels.put(id, stop);
        final File out = file(c, name);
        final File part = new File(out.getPath() + ".part");
        Keeper.hold("dl:" + id, "모델 받는 중");
        Keeper.progress(0);
        new Thread(() -> {
            HttpURLConnection con = null;
            try {
                long have = part.exists() ? part.length() : 0;
                if (size > 0 && have > size) {
                    part.delete();
                    have = 0;
                }
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setInstanceFollowRedirects(true);
                con.setConnectTimeout(20000);
                con.setReadTimeout(60000);
                con.setRequestProperty("User-Agent", "Glok-Android/1.0");
                if (have > 0) con.setRequestProperty("Range", "bytes=" + have + "-");
                int code = con.getResponseCode();
                boolean append;
                long total;
                if (code == 206) {
                    append = true;
                    total = have + Math.max(0, con.getContentLengthLong());
                } else if (code == 200) {
                    append = false;
                    have = 0;
                    total = Math.max(0, con.getContentLengthLong());
                } else if (code == 416 && size > 0 && have == size) {
                    append = true;
                    total = size;
                } else {
                    throw new Exception("다운로드 실패 (HTTP " + code + ")");
                }
                if (total <= 0) total = size;
                long got = have;
                if (code != 416) {
                    byte[] buf = new byte[256 * 1024];
                    long last = 0;
                    try (InputStream in = con.getInputStream(); OutputStream os = new FileOutputStream(part, append)) {
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (stop[0]) throw new InterruptedException("cancelled");
                            os.write(buf, 0, n);
                            got += n;
                            long now = SystemClock.uptimeMillis();
                            if (now - last > 300) {
                                last = now;
                                sink.event(LlmEngine.ev("dl", id).put0("got", got).put0("total", total));
                                if (total > 0) Keeper.progress((int) (got * 100 / total));
                            }
                        }
                    }
                }
                if ((total > 0 && got != total) || (size > 0 && got != size)) {
                    throw new Exception("다운로드가 중간에 끊겼어요. 다시 누르면 이어서 받아요.");
                }
                if (!isGguf(part)) {
                    part.delete();
                    throw new Exception("받은 파일이 GGUF 모델이 아니에요");
                }
                out.delete();
                if (!part.renameTo(out)) throw new Exception("저장하지 못했어요");
                sink.event(LlmEngine.ev("dl", id).put0("done", true).put0("ok", true).put0("file", out.getName()).put0("size", out.length()));
            } catch (InterruptedException e) {
                sink.event(LlmEngine.ev("dl", id).put0("done", true).put0("ok", false).put0("aborted", true));
            } catch (Throwable t) {
                Log.w(TAG, "download", t);
                String m = t.getMessage();
                if (!(t.getMessage() != null && (m.startsWith("다운로드") || m.startsWith("받은") || m.startsWith("저장")))) {
                    m = "인터넷 연결이나 다운로드 주소를 확인해 주세요. (" + t.getClass().getSimpleName() + ")";
                }
                sink.event(LlmEngine.ev("dl", id).put0("done", true).put0("ok", false).put0("error", m));
            } finally {
                if (con != null) con.disconnect();
                cancels.remove(id);
                Keeper.release("dl:" + id);
            }
        }, "glok-download").start();
        return id;
    }

    /** copies a file the user picked into the app; events {type:"pick", got, total} and finally {done, ok, file, size} */
    static void importUri(Context c, Uri uri, LlmEngine.Sink sink) {
        Keeper.hold("pick", "모델 파일 복사 중");
        new Thread(() -> {
            File tmp = null;
            try {
                ContentResolver cr = c.getContentResolver();
                String name = "model.gguf";
                long size = -1;
                try (Cursor cur = cr.query(uri, new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                    if (cur != null && cur.moveToFirst()) {
                        if (!cur.isNull(0)) name = cur.getString(0);
                        if (!cur.isNull(1)) size = cur.getLong(1);
                    }
                }
                String base = name.replaceAll("\\.bin$", "").replaceAll(" \\(\\d+\\)(?=\\.gguf$)", "");
                File out = file(c, base);
                if (out.exists() && size > 0 && out.length() == size && isGguf(out)) {
                    sink.event(LlmEngine.ev("pick", 0).put0("done", true).put0("ok", true).put0("file", out.getName()).put0("size", out.length()).put0("name", base));
                    return;
                }
                if (size > 0 && freeSpace(c) < size + (64L << 20)) throw new Exception("저장공간이 부족해요");
                tmp = new File(out.getPath() + ".part");
                long got = 0, last = 0;
                byte[] buf = new byte[512 * 1024];
                try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(tmp)) {
                    if (in == null) throw new Exception("파일을 열지 못했어요");
                    byte[] head = new byte[4];
                    int hn = in.read(head);
                    if (hn != 4 || head[0] != 'G' || head[1] != 'G' || head[2] != 'U' || head[3] != 'F') {
                        throw new Exception("GGUF 모델 파일이 아니에요");
                    }
                    os.write(head, 0, 4);
                    got = 4;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        got += n;
                        long now = SystemClock.uptimeMillis();
                        if (now - last > 300) {
                            last = now;
                            sink.event(LlmEngine.ev("pick", 0).put0("got", got).put0("total", size));
                        }
                    }
                }
                if (size > 0 && got != size) throw new Exception("파일을 끝까지 읽지 못했어요");
                out.delete();
                if (!tmp.renameTo(out)) throw new Exception("저장하지 못했어요");
                tmp = null;
                sink.event(LlmEngine.ev("pick", 0).put0("done", true).put0("ok", true).put0("file", out.getName()).put0("size", out.length()).put0("name", base));
            } catch (Throwable t) {
                Log.w(TAG, "import", t);
                sink.event(LlmEngine.ev("pick", 0).put0("done", true).put0("ok", false).put0("error", String.valueOf(t.getMessage())));
            } finally {
                if (tmp != null) tmp.delete();
                Keeper.release("pick");
            }
        }, "glok-import").start();
    }
}
