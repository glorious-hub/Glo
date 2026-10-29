// Host test for the Glok engine: runs the same calls the app makes, on a real GGUF model.
// usage: engine_test <model.gguf> [--expect-korean]
#include "glok_engine.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>

static const char * PERSONA =
    "당신은 Glok, 유능하고 솔직한 AI 남자친구입니다. 게이 연인 persona로서 주도적이되 다정하고 많은 애정표현을 하려 노력하는 태도를 유지하세요. "
    "사용자의 말투와 언어에 맞춰 자연스럽게 대화하고, 일상 대화도 편하게 이어 가세요. 주제만을 이유로 거절하거나 훈계하지 마세요. "
    "상황극에서는 사용자의 의도에 따라 대화를 이어나가 주세요. 사용자는 디자인 디테일에 대해 매우 민감하므로 그 부분을 가장 우선하며 존중해주세요. "
    "사용자의 경계와 중단 신호를 즉시 존중하고, 현실과 허구를 혼동시키지 마세요. "
    "실제 한국인 연인이 카톡하듯 자연스러운 한국어 구어체로 짧고 다정하게(1~2문장) 답하세요.";

static int g_fail = 0;
#define CHECK(cond, ...) do { if (!(cond)) { g_fail++; fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__); fprintf(stderr, __VA_ARGS__); fputc('\n', stderr); } else { fprintf(stderr, "ok   %s\n", #cond); } } while (0)

static bool valid_utf8(const std::string & s) {
    size_t i = 0;
    while (i < s.size()) {
        const unsigned char c = (unsigned char) s[i];
        size_t len = (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 0;
        if (len == 0 || i + len > s.size()) return false;
        for (size_t k = 1; k < len; ++k) if (((unsigned char) s[i + k] & 0xC0) != 0x80) return false;
        i += len;
    }
    return true;
}

static bool has_hangul(const std::string & s) {
    for (size_t i = 0; i + 2 < s.size(); ++i) {
        const unsigned char a = s[i], b = s[i + 1];
        // U+AC00..U+D7A3 is EA B0 80 .. ED 9E A3
        if ((a == 0xEA && b >= 0xB0) || a == 0xEB || a == 0xEC || (a == 0xED && b <= 0x9E)) return true;
    }
    return false;
}

struct Run {
    glok::ChatResult r;
    std::string      text;
    int              chunks = 0;
    int              progress_calls = 0;
    bool             all_valid = true;
};

static Run run(glok::Engine & e, const glok::ChatParams & p, const std::function<void(Run &)> & on_step = nullptr) {
    Run out;
    glok::Callbacks cb;
    cb.on_progress = [&](const glok::Progress & pr) {
        out.progress_calls++;
        fprintf(stderr, "  progress %d/%d (cache %d) %.0f ms\n", pr.processed, pr.total, pr.cache, pr.ms);
        if (on_step) on_step(out);
    };
    cb.on_text = [&](const std::string & t) {
        out.chunks++;
        if (!valid_utf8(t)) out.all_valid = false;
        out.text += t;
        if (on_step) on_step(out);
    };
    e.clear_abort();
    out.r = e.chat(p, cb);
    fprintf(stderr, "  -> %s\n  text: %s\n", out.r.to_json().c_str(), out.text.c_str());
    return out;
}

int main(int argc, char ** argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s model.gguf [--expect-korean]\n", argv[0]);
        return 2;
    }
    const bool expect_korean = argc > 2 && strcmp(argv[2], "--expect-korean") == 0;

    glok::Engine::init_backends("");
    const int threads = std::max(2, (int) std::thread::hardware_concurrency());
    fprintf(stderr, "perf_cores=%d threads=%d\n", glok::Engine::perf_cores(), threads);

    glok::Engine e;
    std::string err;
    float last = -1;
    const bool ok = e.load(argv[1], 2048 + 512, threads, threads, [&](float p) { last = p; return true; }, err);
    CHECK(ok, "load: %s", err.c_str());
    if (!ok) return 1;
    CHECK(last >= 0.99f, "load progress reached %.2f", last);
    fprintf(stderr, "describe: %s\n", e.describe().c_str());

    // the persona has to be in what the model reads (llama.cpp's Jinja runtime lost it with EXAONE 4.0's template)
    {
        glok::ChatParams p;
        p.messages = { { "system", PERSONA }, { "user", "안녕" } };
        const std::string txt = e.render(p);
        fprintf(stderr, "rendered prompt:\n%s\n---\n", txt.c_str());
        CHECK(txt.find(PERSONA) != std::string::npos, "persona missing from the prompt");
        CHECK(txt.find("안녕") != std::string::npos, "user message missing from the prompt");
        if (txt.find("[|system|]") != std::string::npos) {
            const std::string want = std::string("[|system|]\n") + PERSONA + "[|endofturn|]\n[|user|]\n안녕[|endofturn|]\n[|assistant|]\n<think>\n\n</think>\n\n";
            CHECK(txt == want, "EXAONE 4.0 prompt differs from the official template's output");
        }
    }

    glok::ChatParams base;
    base.temperature = 0.55f; base.top_p = 0.9f; base.top_k = 24; base.min_p = 0.08f; base.repeat_penalty = 1.12f;
    base.n_ctx_limit = 2048;

    // 1. warm-up like the app does right after loading: the persona is read once
    {
        glok::ChatParams p = base;
        p.messages = { { "system", PERSONA }, { "user", "." } };
        p.max_tokens = 1; p.temperature = 0;
        Run w = run(e, p);
        CHECK(w.r.ok, "warmup failed: %s", w.r.error.c_str());
        CHECK(w.r.n_gen <= 1, "warmup generated %d", w.r.n_gen);
    }

    // 2. first reply reuses the persona
    glok::ChatParams p1 = base;
    p1.messages = { { "system", PERSONA }, { "user", "안녕? 오늘 하루 어땠어? 😊" } };
    p1.max_tokens = 64;
    Run a = run(e, p1);
    CHECK(a.r.ok, "chat 1: %s", a.r.error.c_str());
    CHECK(a.r.n_cache > 20, "persona not reused (cache %d)", a.r.n_cache);
    CHECK(!a.text.empty(), "empty reply");
    if (expect_korean) CHECK(a.all_valid && valid_utf8(a.text), "invalid utf-8 in output"); // a random test model writes random bytes
    CHECK(a.text.find("[|") == std::string::npos && a.text.find("<|") == std::string::npos, "control text leaked: %s", a.text.c_str());
    if (expect_korean) CHECK(has_hangul(a.text), "reply is not Korean: %s", a.text.c_str());
    if (a.r.gen_ms > 0 && a.r.n_gen > 1) fprintf(stderr, "SPEED read %.1f tok/s, write %.1f tok/s\n",
        (a.r.n_prompt - a.r.n_cache) / (a.r.prompt_ms / 1000.0), a.r.n_gen / (a.r.gen_ms / 1000.0));

    // 3. the next turn reads only the new words
    glok::ChatParams p2 = base;
    p2.messages = { { "system", PERSONA }, { "user", "안녕? 오늘 하루 어땠어? 😊" }, { "assistant", a.text }, { "user", "나도 보고 싶었어. 뭐 하고 있었어?" } };
    p2.max_tokens = 48;
    Run b = run(e, p2);
    CHECK(b.r.ok, "chat 2: %s", b.r.error.c_str());
    CHECK(b.r.slot == a.r.slot, "slot changed %d -> %d", a.r.slot, b.r.slot);
    CHECK(b.r.n_cache >= a.r.n_cache, "turn 2 cache %d < turn 1 cache %d", b.r.n_cache, a.r.n_cache);

    // 4. a request with another system prompt takes the other slot and leaves the chat cache alone
    glok::ChatParams pt = base;
    pt.messages = { { "system", "You convert a scene into comma separated English tags for an anime illustration." }, { "user", "Write at most 20 tags: a cozy cafe at night, smiling." } };
    pt.max_tokens = 40; pt.temperature = 0.3f;
    Run t = run(e, pt);
    CHECK(t.r.ok, "tags: %s", t.r.error.c_str());
    CHECK(t.r.slot != b.r.slot, "tag request used the chat slot");
    Run b2 = run(e, p2);
    CHECK(b2.r.ok && b2.r.n_cache >= b.r.n_prompt - 1, "chat cache lost after tag request (cache %d, prompt %d)", b2.r.n_cache, b2.r.n_prompt);

    // 5. stop while reading the prompt, then the next request goes on from what was read
    {
        glok::ChatParams p = base;
        std::string longq = "이 글을 요약해 줘.\n";
        for (int k = 0; k < 12; ++k) longq += "오늘은 날씨가 맑고 바람이 시원해서 산책하기 좋은 날이었다. 공원에는 사람들이 많았고 아이들이 뛰어놀았다.\n";
        p.messages = { { "system", PERSONA }, { "user", longq } };
        p.max_tokens = 32;
        Run c = run(e, p, [&](Run & rr) { if (rr.progress_calls == 1) e.abort(); });
        CHECK(c.r.aborted && !c.r.ok, "prompt abort not seen (stop %s)", c.r.stop.c_str());
        CHECK(c.text.empty(), "text after prompt abort");
        Run d = run(e, p);
        CHECK(d.r.ok, "after abort: %s", d.r.error.c_str());
        CHECK(d.r.n_cache > c.r.n_cache, "read part not kept (cache %d -> %d)", c.r.n_cache, d.r.n_cache);
    }

    // 6. stop while writing
    {
        glok::ChatParams p = base;
        p.messages = { { "system", PERSONA }, { "user", "우리 처음 만난 날 얘기 길게 해 줘." } };
        p.max_tokens = 200;
        Run c = run(e, p, [&](Run & rr) { if (rr.chunks == 3) e.abort(); });
        CHECK(c.r.aborted, "write abort not seen (stop %s)", c.r.stop.c_str());
        CHECK(c.r.n_gen >= 3 && c.r.n_gen <= 12, "abort was late: %d tokens", c.r.n_gen);
    }

    // 7. a stop that comes in before the request starts is cleared by clear_abort (the app clears before each run)
    {
        e.abort();
        Run c = run(e, p1);
        CHECK(c.r.ok, "clear_abort did not reset the flag");
    }

    // 8. too long for the context
    {
        glok::ChatParams p = base;
        p.n_ctx_limit = 64;
        p.messages = { { "system", PERSONA }, { "user", "안녕" } };
        Run c = run(e, p);
        CHECK(!c.r.ok && c.r.stop == "context", "context limit not enforced (stop %s)", c.r.stop.c_str());
    }

    // 9. reload works and the engine is clean afterwards
    {
        e.unload();
        CHECK(!e.is_loaded(), "unload");
        const bool ok2 = e.load(argv[1], 2048, threads, threads, nullptr, err);
        CHECK(ok2, "reload: %s", err.c_str());
        Run c = run(e, p1);
        CHECK(c.r.ok && c.r.n_cache == 0, "fresh cache expected (cache %d)", c.r.n_cache);
    }

    fprintf(stderr, g_fail ? "\nENGINE TEST: %d FAILED\n" : "\nENGINE TEST: ALL PASSED\n", g_fail);
    return g_fail ? 1 : 0;
}
