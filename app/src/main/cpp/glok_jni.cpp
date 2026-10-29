#include "glok_engine.h"

#include <jni.h>

#include <string>
#include <vector>

namespace {

std::string from_bytes(JNIEnv * env, jbyteArray arr) {
    if (!arr) {
        return {};
    }
    const jsize n = env->GetArrayLength(arr);
    std::string s((size_t) n, '\0');
    if (n > 0) {
        env->GetByteArrayRegion(arr, 0, n, reinterpret_cast<jbyte *>(&s[0]));
    }
    return s;
}

jbyteArray to_bytes(JNIEnv * env, const std::string & s) {
    jbyteArray arr = env->NewByteArray((jsize) s.size());
    if (arr && !s.empty()) {
        env->SetByteArrayRegion(arr, 0, (jsize) s.size(), reinterpret_cast<const jbyte *>(s.data()));
    }
    return arr;
}

std::string from_jstring(JNIEnv * env, jstring js) {
    if (!js) {
        return {};
    }
    const char * c = env->GetStringUTFChars(js, nullptr);
    std::string s = c ? c : "";
    if (c) {
        env->ReleaseStringUTFChars(js, c);
    }
    return s;
}

glok::Engine * engine(jlong h) {
    return reinterpret_cast<glok::Engine *>(h);
}

} // namespace

extern "C" {

JNIEXPORT void JNICALL Java_com_glok_app_NativeLlm_nInit(JNIEnv * env, jclass, jstring dir) {
    glok::Engine::init_backends(from_jstring(env, dir));
}

JNIEXPORT jint JNICALL Java_com_glok_app_NativeLlm_nPerfCores(JNIEnv *, jclass) {
    return glok::Engine::perf_cores();
}

JNIEXPORT jlong JNICALL Java_com_glok_app_NativeLlm_nCreate(JNIEnv *, jclass) {
    return reinterpret_cast<jlong>(new glok::Engine());
}

JNIEXPORT void JNICALL Java_com_glok_app_NativeLlm_nDestroy(JNIEnv *, jclass, jlong h) {
    delete engine(h);
}

// returns null on success, else an error message
JNIEXPORT jstring JNICALL Java_com_glok_app_NativeLlm_nLoad(JNIEnv * env, jclass, jlong h, jstring path, jint n_ctx,
                                                           jint n_threads, jint n_threads_batch, jobject listener) {
    jmethodID on_load = nullptr;
    if (listener) {
        jclass cls = env->GetObjectClass(listener);
        on_load = env->GetMethodID(cls, "onLoadProgress", "(F)Z");
        env->DeleteLocalRef(cls);
    }
    std::string err;
    const bool ok = engine(h)->load(from_jstring(env, path), n_ctx, n_threads, n_threads_batch,
        [&](float p) -> bool {
            if (!on_load) {
                return true;
            }
            const jboolean go = env->CallBooleanMethod(listener, on_load, (jfloat) p);
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
                return true;
            }
            return go == JNI_TRUE;
        }, err);
    return ok ? nullptr : env->NewStringUTF(err.c_str());
}

JNIEXPORT void JNICALL Java_com_glok_app_NativeLlm_nUnload(JNIEnv *, jclass, jlong h) {
    engine(h)->unload();
}

JNIEXPORT void JNICALL Java_com_glok_app_NativeLlm_nAbort(JNIEnv *, jclass, jlong h) {
    engine(h)->abort();
}

JNIEXPORT void JNICALL Java_com_glok_app_NativeLlm_nClearAbort(JNIEnv *, jclass, jlong h) {
    engine(h)->clear_abort();
}

JNIEXPORT jbyteArray JNICALL Java_com_glok_app_NativeLlm_nChat(JNIEnv * env, jclass, jlong h, jobjectArray roles,
                                                              jobjectArray contents, jint max_tokens, jfloat temp,
                                                              jfloat top_p, jint top_k, jfloat min_p, jfloat rep,
                                                              jint seed, jboolean thinking, jint ctx_limit,
                                                              jobject listener) {
    glok::ChatParams p;
    const jsize n = env->GetArrayLength(roles);
    for (jsize i = 0; i < n; ++i) {
        auto r = (jbyteArray) env->GetObjectArrayElement(roles, i);
        auto c = (jbyteArray) env->GetObjectArrayElement(contents, i);
        p.messages.push_back({ from_bytes(env, r), from_bytes(env, c) });
        env->DeleteLocalRef(r);
        env->DeleteLocalRef(c);
    }
    p.max_tokens      = max_tokens;
    p.temperature     = temp;
    p.top_p           = top_p;
    p.top_k           = top_k;
    p.min_p           = min_p;
    p.repeat_penalty  = rep;
    p.seed            = seed < 0 ? 0xFFFFFFFFu : (uint32_t) seed;
    p.enable_thinking = thinking == JNI_TRUE;
    p.n_ctx_limit     = ctx_limit;

    glok::Engine * e = engine(h);
    glok::Callbacks cb;
    if (listener) {
        jclass    cls     = env->GetObjectClass(listener);
        jmethodID on_prog = env->GetMethodID(cls, "onProgress", "(IIID)V");
        jmethodID on_text = env->GetMethodID(cls, "onText", "([B)V");
        env->DeleteLocalRef(cls);
        cb.on_progress = [env, listener, on_prog, e](const glok::Progress & pr) {
            env->CallVoidMethod(listener, on_prog, (jint) pr.total, (jint) pr.cache, (jint) pr.processed, (jdouble) pr.ms);
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
                e->abort();
            }
        };
        cb.on_text = [env, listener, on_text, e](const std::string & t) {
            jbyteArray b = to_bytes(env, t);
            env->CallVoidMethod(listener, on_text, b);
            env->DeleteLocalRef(b);
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
                e->abort();
            }
        };
    }
    const glok::ChatResult r = e->chat(p, cb);
    return to_bytes(env, r.to_json());
}

JNIEXPORT jbyteArray JNICALL Java_com_glok_app_NativeLlm_nDescribe(JNIEnv * env, jclass, jlong h) {
    return to_bytes(env, engine(h)->describe());
}

} // extern "C"
