package com.glok.app;

/** JNI entry points of libglok.so (see app/src/main/cpp/glok_jni.cpp). */
final class NativeLlm {
    private NativeLlm() {}

    interface Listener {
        /** model loading, 0..1; return false to cancel */
        boolean onLoadProgress(float p);

        /** prompt reading: tokens in total, reused from the cache, in the cache now; ms since start */
        void onProgress(int total, int cache, int processed, double ms);

        /** new reply text, whole UTF-8 characters */
        void onText(byte[] utf8);
    }

    static native void nInit(String libDir);

    static native int nPerfCores();

    static native long nCreate();

    static native void nDestroy(long h);

    /** null on success, else the error */
    static native String nLoad(long h, String path, int nCtx, int nThreads, int nThreadsBatch, Listener l);

    static native void nUnload(long h);

    static native void nAbort(long h);

    static native void nClearAbort(long h);

    /** result JSON (UTF-8) */
    static native byte[] nChat(long h, byte[][] roles, byte[][] contents, int maxTokens, float temp, float topP,
                               int topK, float minP, float repeatPenalty, int seed, boolean thinking, int ctxLimit,
                               Listener l);

    static native byte[] nDescribe(long h);
}
