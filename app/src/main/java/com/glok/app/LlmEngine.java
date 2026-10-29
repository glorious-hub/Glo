package com.glok.app;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The on-device model (llama.cpp). One request at a time on its own thread, so it keeps working while the
 * screen is off or the app is in the background. Results go out as events (see JsBridge).
 */
final class LlmEngine {
    private static final String TAG = "GlokEngine";

    interface Sink {
        void event(JSONObject e);
    }

    private static LlmEngine inst;

    static synchronized LlmEngine get(Context c) {
        if (inst == null) inst = new LlmEngine(c.getApplicationContext());
        return inst;
    }

    private final ExecutorService exec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "glok-llm");
        t.setPriority(Thread.MAX_PRIORITY);
        return t;
    });
    private static final String K_FILE = "model_file";
    private static final String K_CTX = "model_ctx";

    private final Context app;
    private final long h;
    private final int threads;
    private final AtomicInteger seq = new AtomicInteger();
    private final Object lock = new Object();
    private final Set<Integer> queued = new HashSet<>();
    private final Set<Integer> cancelled = new HashSet<>();
    private int running = 0;
    private volatile Sink sink;
    private volatile String loadedFile = "";
    private volatile String info = "{}";
    private volatile int ctx = 0;

    private LlmEngine(Context c) {
        app = c;
        System.loadLibrary("glok");
        NativeLlm.nInit(c.getApplicationInfo().nativeLibraryDir);
        h = NativeLlm.nCreate();
        threads = NativeLlm.nPerfCores();
        Log.i(TAG, "engine ready, threads=" + threads);
    }

    /** the model in memory is written down, so Android can bring it back if it ever closes the app */
    private void remember(String file, int nCtx) {
        Keeper.prefs(app).edit().putString(K_FILE, file).putInt(K_CTX, nCtx).apply();
    }

    private void forget() {
        Keeper.prefs(app).edit().remove(K_FILE).remove(K_CTX).apply();
    }

    /** loads the model that was in memory when Android closed the app (called when Android restarts the service) */
    void restoreLast() {
        String f = Keeper.prefs(app).getString(K_FILE, "");
        int c = Keeper.prefs(app).getInt(K_CTX, 0);
        if (f.isEmpty() || c <= 0 || !Keeper.enabled()) return;
        File file = ModelStore.file(app, f);
        if (!file.exists()) {
            forget();
            return;
        }
        if (f.equals(loadedFile) && c == ctx) return;
        Log.i(TAG, "restoring " + f);
        load(file, c);
    }

    void setSink(Sink s) {
        sink = s;
    }

    private void emit(JSONObject e) {
        Sink s = sink;
        if (s != null) s.event(e);
    }

    String loadedFile() {
        return loadedFile;
    }

    String info() {
        return info;
    }

    int threads() {
        return threads;
    }

    int load(File file, int nCtx) {
        final int id = seq.incrementAndGet();
        Keeper.hold("llm:" + id, "모델 불러오는 중");
        exec.execute(() -> {
            try {
                if (file.getName().equals(loadedFile) && nCtx == ctx) {
                    // already in memory (the page started again, or Android brought the app back): use it as it is
                    Log.i(TAG, "model already loaded: " + loadedFile);
                    emit(ev("load", id).put0("done", true).put0("ok", true).put0("kept", true).put0("info", new JSONObject(info)));
                    return;
                }
                NativeLlm.nUnload(h);
                loadedFile = "";
                info = "{}";
                ctx = 0;
                Keeper.setReady(false);
                final long[] last = {0};
                NativeLlm.Listener l = new NativeLlm.Listener() {
                    @Override
                    public boolean onLoadProgress(float p) {
                        long now = SystemClock.uptimeMillis();
                        if (now - last[0] > 200 || p >= 1f) {
                            last[0] = now;
                            emit(ev("load", id).put0("p", p));
                        }
                        return true;
                    }

                    @Override
                    public void onProgress(int total, int cache, int processed, double ms) {}

                    @Override
                    public void onText(byte[] utf8) {}
                };
                // the page asks for the size one chat may use; the second request slot gets room of its own
                String err = NativeLlm.nLoad(h, file.getAbsolutePath(), nCtx + 512, threads, threads, l);
                if (err == null) {
                    loadedFile = file.getName();
                    ctx = nCtx;
                    info = new String(NativeLlm.nDescribe(h), StandardCharsets.UTF_8);
                    remember(loadedFile, nCtx);
                    Keeper.setReady(true);
                    emit(ev("load", id).put0("done", true).put0("ok", true).put0("info", new JSONObject(info)));
                } else {
                    forget();
                    emit(ev("load", id).put0("done", true).put0("ok", false).put0("error", err));
                }
            } catch (Throwable t) {
                Log.e(TAG, "load", t);
                emit(ev("load", id).put0("done", true).put0("ok", false).put0("error", String.valueOf(t.getMessage())));
            } finally {
                Keeper.release("llm:" + id);
            }
        });
        return id;
    }

    void unload() {
        abortAll();
        exec.execute(() -> {
            NativeLlm.nUnload(h);
            loadedFile = "";
            info = "{}";
            ctx = 0;
            forget();
            Keeper.setReady(false);
        });
    }

    int chat(JSONObject req) {
        final int id = seq.incrementAndGet();
        synchronized (lock) {
            queued.add(id);
        }
        Keeper.hold("llm:" + id, "답변을 쓰는 중");
        exec.execute(() -> runChat(id, req));
        return id;
    }

    void abort(int id) {
        synchronized (lock) {
            if (running == id) NativeLlm.nAbort(h);
            else if (queued.contains(id)) cancelled.add(id);
        }
    }

    void abortAll() {
        synchronized (lock) {
            cancelled.addAll(queued);
            if (running != 0) NativeLlm.nAbort(h);
        }
    }

    private void runChat(int id, JSONObject req) {
        try {
            NativeLlm.nClearAbort(h);
            synchronized (lock) {
                queued.remove(id);
                if (cancelled.remove(id)) {
                    emit(ev("chat", id).put0("kind", "done").put0("ok", false).put0("aborted", true).put0("stop", "abort"));
                    return;
                }
                running = id;
            }
            if (loadedFile.isEmpty()) {
                emit(ev("chat", id).put0("kind", "done").put0("ok", false).put0("aborted", false).put0("error", "모델이 내려져 있어요. 다시 불러와 주세요."));
                return;
            }
            JSONArray msgs = req.getJSONArray("messages");
            byte[][] roles = new byte[msgs.length()][];
            byte[][] contents = new byte[msgs.length()][];
            for (int i = 0; i < msgs.length(); i++) {
                JSONObject m = msgs.getJSONObject(i);
                roles[i] = m.optString("role", "user").getBytes(StandardCharsets.UTF_8);
                contents[i] = m.optString("content", "").getBytes(StandardCharsets.UTF_8);
            }
            final long[] lastProg = {0};
            NativeLlm.Listener l = new NativeLlm.Listener() {
                @Override
                public boolean onLoadProgress(float p) {
                    return true;
                }

                @Override
                public void onProgress(int total, int cache, int processed, double ms) {
                    long now = SystemClock.uptimeMillis();
                    if (now - lastProg[0] < 120 && processed < total) return;
                    lastProg[0] = now;
                    emit(ev("chat", id).put0("kind", "progress").put0("total", total).put0("cache", cache)
                            .put0("processed", processed).put0("ms", ms));
                }

                @Override
                public void onText(byte[] utf8) {
                    emit(ev("chat", id).put0("kind", "text").put0("text", new String(utf8, StandardCharsets.UTF_8)));
                }
            };
            int ctxLimit = req.optInt("ctx_limit", ctx);
            if (ctxLimit <= 0 || (ctx > 0 && ctxLimit > ctx)) ctxLimit = ctx;
            byte[] res = NativeLlm.nChat(h, roles, contents,
                    req.optInt("max_tokens", 256),
                    (float) req.optDouble("temperature", 0.8),
                    (float) req.optDouble("top_p", 0.95),
                    req.optInt("top_k", 40),
                    (float) req.optDouble("min_p", 0.05),
                    (float) req.optDouble("repeat_penalty", 1.0),
                    req.optInt("seed", -1),
                    req.optBoolean("enable_thinking", false),
                    ctxLimit, l);
            JSONObject r = new JSONObject(new String(res, StandardCharsets.UTF_8));
            r.put("type", "chat");
            r.put("id", id);
            r.put("kind", "done");
            emit(r);
        } catch (Throwable t) {
            Log.e(TAG, "chat", t);
            emit(ev("chat", id).put0("kind", "done").put0("ok", false).put0("aborted", false).put0("error", String.valueOf(t.getMessage())));
        } finally {
            synchronized (lock) {
                running = 0;
            }
            Keeper.release("llm:" + id);
        }
    }

    static Ev ev(String type, int id) {
        return new Ev().put0("type", type).put0("id", id);
    }

    /** JSONObject whose put doesn't throw, for building events inline */
    static final class Ev extends JSONObject {
        Ev put0(String k, Object v) {
            try {
                put(k, v);
            } catch (Exception ignored) {
            }
            return this;
        }

        Ev put0(String k, int v) {
            try {
                put(k, v);
            } catch (Exception ignored) {
            }
            return this;
        }

        Ev put0(String k, long v) {
            try {
                put(k, v);
            } catch (Exception ignored) {
            }
            return this;
        }

        Ev put0(String k, double v) {
            try {
                put(k, Double.isNaN(v) || Double.isInfinite(v) ? 0 : v);
            } catch (Exception ignored) {
            }
            return this;
        }
    }
}
