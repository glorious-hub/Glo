#include "glok_engine.h"
#include "exaone4_template.h"

#include "chat.h"
#include "common.h"
#include "ggml-backend.h"
#include "llama.h"
#include "sampling.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <unistd.h>

#ifdef __ANDROID__
#include <android/log.h>
#define GLOG(...) __android_log_print(ANDROID_LOG_INFO, "glok", __VA_ARGS__)
#else
#define GLOG(...) do { fprintf(stderr, "[glok] " __VA_ARGS__); fputc('\n', stderr); } while (0)
#endif

namespace glok {

namespace {

using clk = std::chrono::steady_clock;

double ms_since(clk::time_point t) {
    return std::chrono::duration<double, std::milli>(clk::now() - t).count();
}

std::string jesc(const std::string & s) {
    std::string o;
    o.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"':  o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n";  break;
            case '\r': o += "\\r";  break;
            case '\t': o += "\\t";  break;
            default:
                if (c < 0x20) {
                    char b[8];
                    snprintf(b, sizeof(b), "\\u%04x", c);
                    o += b;
                } else {
                    o += (char) c;
                }
        }
    }
    return o;
}

#ifdef __ANDROID__
void log_cb(ggml_log_level level, const char * text, void *) {
    if (level == GGML_LOG_LEVEL_DEBUG || level == GGML_LOG_LEVEL_CONT) {
        return;
    }
    const int prio = level == GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR :
                     level == GGML_LOG_LEVEL_WARN  ? ANDROID_LOG_WARN  : ANDROID_LOG_INFO;
    __android_log_print(prio, "llama", "%s", text);
}
#endif

long read_long(const std::string & path) {
    std::ifstream f(path);
    long v = -1;
    if (!(f >> v)) {
        return -1;
    }
    return v;
}

// longest suffix of text that is the start of stop (but not all of it)
size_t partial_stop(const std::string & text, const std::string & stop) {
    if (stop.empty()) {
        return 0;
    }
    const size_t max = std::min(text.size(), stop.size() - 1);
    for (size_t len = max; len > 0; --len) {
        if (text.compare(text.size() - len, len, stop, 0, len) == 0) {
            return len;
        }
    }
    return 0;
}

} // namespace

size_t utf8_complete(const std::string & s, size_t n) {
    n = std::min(n, s.size());
    for (size_t back = 1; back <= 4 && back <= n; ++back) {
        const unsigned char c = (unsigned char) s[n - back];
        if ((c & 0xC0) == 0x80) {
            continue;
        }
        const size_t len = (c & 0x80) == 0x00 ? 1 :
                           (c & 0xE0) == 0xC0 ? 2 :
                           (c & 0xF0) == 0xE0 ? 3 :
                           (c & 0xF8) == 0xF0 ? 4 : 1;
        return back < len ? n - back : n;
    }
    return n;
}

std::string ChatResult::to_json() const {
    char buf[512];
    snprintf(buf, sizeof(buf),
             "{\"ok\":%s,\"aborted\":%s,\"stop\":\"%s\",\"slot\":%d,\"n_prompt\":%d,\"n_cache\":%d,\"n_gen\":%d,"
             "\"prompt_ms\":%.1f,\"gen_ms\":%.1f,",
             ok ? "true" : "false", aborted ? "true" : "false", jesc(stop).c_str(), slot, n_prompt, n_cache, n_gen,
             prompt_ms, gen_ms);
    return std::string(buf) + "\"error\":\"" + jesc(error) + "\"}";
}

void Engine::init_backends(const std::string & dir) {
#ifdef __ANDROID__
    llama_log_set(log_cb, nullptr);
    // OpenMP must not pin its threads to the cores the app had when it first ran a model: Android moves the app
    // between core groups as it goes to and from the background (and may load the model in the background after
    // closing the app for memory), and pinned threads would stay on the slow cores
    setenv("KMP_AFFINITY", "disabled", 0);
#endif
    if (!dir.empty()) {
        ggml_backend_load_all_from_path(dir.c_str());
    } else {
        ggml_backend_load_all();
    }
    llama_backend_init();
}

int Engine::perf_cores() {
    const long n = sysconf(_SC_NPROCESSORS_CONF);
    std::vector<long> score;
    for (long i = 0; i < n; ++i) {
        const std::string base = "/sys/devices/system/cpu/cpu" + std::to_string(i);
        long v = read_long(base + "/cpu_capacity");
        if (v <= 0) {
            v = read_long(base + "/cpufreq/cpuinfo_max_freq");
        }
        score.push_back(v);
    }
    const long best = score.empty() ? -1 : *std::max_element(score.begin(), score.end());
    int fast = 0;
    if (best > 0) {
        for (long v : score) {
            if (v * 2 >= best) {
                fast++;
            }
        }
    } else {
        fast = (int) std::max(1L, n / 2);
    }
    return std::max(2, std::min(6, fast));
}

Engine::Engine() = default;

Engine::~Engine() {
    unload();
}

bool Engine::abort_cb(void * data) {
    return static_cast<Engine *>(data)->abort_.load();
}

bool Engine::load(const std::string & path, int n_ctx, int n_threads, int n_threads_batch,
                  const std::function<bool(float)> & progress, std::string & err) {
    unload();

    std::function<bool(float)> prog = progress;
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    // tables the model only looks up a few rows of per token (Gemma 4's per-layer embeddings, about 1.8 GB in E2B)
    // stay in the file and are read as needed instead of being loaded whole; models without such tables load as before
    mp.lazy_mode = LLAMA_LAZY_MODE_ON;
    if (prog) {
        mp.progress_callback = [](float p, void * ud) -> bool {
            return (*static_cast<std::function<bool(float)> *>(ud))(p);
        };
        mp.progress_callback_user_data = &prog;
    }

    const auto t0 = clk::now();
    model_ = llama_model_load_from_file(path.c_str(), mp);
    if (!model_) {
        err = "model load failed";
        return false;
    }

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx               = (uint32_t) n_ctx;
    cp.n_batch             = (uint32_t) n_batch_;
    cp.n_ubatch            = (uint32_t) n_batch_;
    cp.n_seq_max           = 2;
    cp.kv_unified          = true;
    cp.swa_full            = true;
    cp.n_threads           = n_threads;
    cp.n_threads_batch     = n_threads_batch;
    cp.abort_callback      = abort_cb;
    cp.abort_callback_data = this;
    cp.no_perf             = true;

    ctx_ = llama_init_from_model(model_, cp);
    if (!ctx_) {
        llama_model_free(model_);
        model_ = nullptr;
        err = "context init failed (memory)";
        return false;
    }

    vocab_ = llama_model_get_vocab(model_);
    tmpls_ = common_chat_templates_init(model_, "").release();
    {
        const std::string src = common_chat_templates_source(tmpls_);
        if (src.find("[|system|]") != std::string::npos && src.find("continue %}") != std::string::npos) {
            common_chat_templates_free(tmpls_);
            tmpls_ = common_chat_templates_init(model_, GLOK_EXAONE4_TEMPLATE).release();
            GLOG("EXAONE 4 chat template: using the copy without continue (keeps the system message)");
        }
    }
    slots_.assign(2, Slot{});
    use_seq_ = 0;
    n_ctx_ = (int) llama_n_ctx(ctx_);
    n_threads_ = n_threads;
    n_threads_batch_ = n_threads_batch;
    path_ = path;

    GLOG("loaded %s ctx=%d threads=%d/%d in %.0f ms", path.c_str(), n_ctx_, n_threads, n_threads_batch, ms_since(t0));
    return true;
}

void Engine::unload() {
    if (tmpls_) {
        common_chat_templates_free(tmpls_);
        tmpls_ = nullptr;
    }
    if (ctx_) {
        llama_free(ctx_);
        ctx_ = nullptr;
    }
    if (model_) {
        llama_model_free(model_);
        model_ = nullptr;
    }
    vocab_ = nullptr;
    slots_.clear();
    path_.clear();
}

bool Engine::apply_template(const ChatParams & p, common_chat_params & chat, std::string & err) const {
    common_chat_templates_inputs in;
    for (const auto & m : p.messages) {
        common_chat_msg cm;
        cm.role    = m.role;
        cm.content = m.content;
        in.messages.push_back(cm);
    }
    in.add_generation_prompt = true;
    in.use_jinja             = true;
    in.enable_thinking       = p.enable_thinking;
    in.chat_template_kwargs["enable_thinking"] = p.enable_thinking ? "true" : "false";

    bool ok = false;
    try {
        chat = common_chat_templates_apply(tmpls_, in);
        ok   = true;
    } catch (const std::exception & e) {
        GLOG("jinja template failed (%s), using the built-in one", e.what());
    }
    // every message has to reach the model; a template the Jinja runtime renders wrong falls back to the built-in format
    if (ok) {
        for (const auto & m : p.messages) {
            if (m.role != "system" && m.role != "user") {
                continue; // templates may rewrite earlier replies (e.g. drop a think block)
            }
            const std::string probe = m.content.substr(0, std::min<size_t>(m.content.size(), 48));
            if (!probe.empty() && chat.prompt.find(probe) == std::string::npos) {
                GLOG("a %s message is missing from the rendered prompt, using the built-in format", m.role.c_str());
                ok = false;
                break;
            }
        }
    }
    if (!ok) {
        try {
            in.use_jinja = false;
            in.chat_template_kwargs.clear();
            chat = common_chat_templates_apply(tmpls_, in);
        } catch (const std::exception & e) {
            err = std::string("chat template: ") + e.what();
            return false;
        }
    }
    return true;
}

std::string Engine::render(const ChatParams & p) const {
    if (!tmpls_) {
        return {};
    }
    common_chat_params chat;
    std::string        err;
    return apply_template(p, chat, err) ? chat.prompt : "error: " + err;
}

int Engine::pick_slot(const std::vector<int32_t> & prompt, size_t & lcp) const {
    int    best     = -1;
    size_t best_len = 0;
    for (int s = 0; s < (int) slots_.size(); ++s) {
        const auto & t = slots_[s].tokens;
        const size_t m = std::min(t.size(), prompt.size());
        size_t       n = 0;
        while (n < m && t[n] == prompt[n]) {
            n++;
        }
        // a shared start of only a few tokens (BOS, a role tag) is not worth another request's cache
        if (n > best_len && (n * 4 >= t.size() || n >= 128)) {
            best_len = n;
            best     = s;
        }
    }
    if (best < 0) {
        best = 0;
        for (int s = 1; s < (int) slots_.size(); ++s) {
            if (slots_[s].used < slots_[best].used) {
                best = s;
            }
        }
        const auto & t = slots_[best].tokens;
        const size_t m = std::min(t.size(), prompt.size());
        best_len = 0;
        while (best_len < m && t[best_len] == prompt[best_len]) {
            best_len++;
        }
    }
    lcp = best_len;
    return best;
}

void Engine::clear_slot(int s) {
    llama_memory_seq_rm(llama_get_memory(ctx_), s, -1, -1);
    slots_[s].tokens.clear();
}

void Engine::resync_slot(int s) {
    const llama_pos pmax = llama_memory_seq_pos_max(llama_get_memory(ctx_), s);
    const size_t    have = pmax < 0 ? 0 : (size_t) pmax + 1;
    if (have < slots_[s].tokens.size()) {
        slots_[s].tokens.resize(have);
    }
}

ChatResult Engine::chat(const ChatParams & p, const Callbacks & cb) {
    ChatResult r;
    if (!ctx_) {
        r.stop  = "error";
        r.error = "model not loaded";
        return r;
    }

    common_chat_params chat;
    if (!apply_template(p, chat, r.error)) {
        r.stop = "error";
        return r;
    }

    const std::vector<llama_token> prompt = common_tokenize(vocab_, chat.prompt, true, true);
    const int limit = p.n_ctx_limit > 0 ? std::min(p.n_ctx_limit, n_ctx_) : n_ctx_;
    r.n_prompt = (int) prompt.size();
    if (prompt.empty()) {
        r.stop  = "error";
        r.error = "empty prompt";
        return r;
    }
    if ((int) prompt.size() >= limit - 1) {
        r.stop  = "context";
        r.error = "the request exceeds the available context size (" + std::to_string(prompt.size()) + " tokens)";
        return r;
    }
    const int max_gen = std::min(p.max_tokens > 0 ? p.max_tokens : limit, limit - (int) prompt.size());

    // tokens that are special but are part of the visible output (e.g. <think>)
    std::vector<llama_token> preserved;
    for (const auto & t : chat.preserved_tokens) {
        const auto ids = common_tokenize(vocab_, t, false, true);
        if (ids.size() == 1) {
            preserved.push_back(ids[0]);
        }
    }

    size_t lcp  = 0;
    const int s = pick_slot(prompt, lcp);
    auto &    st = slots_[s].tokens;
    slots_[s].used = ++use_seq_;
    r.slot = s;

    llama_memory_t mem = llama_get_memory(ctx_);
    if (lcp >= prompt.size()) {
        lcp = prompt.size() - 1; // the last token is read again to get its logits
    }
    if (lcp < st.size()) {
        if (!llama_memory_seq_rm(mem, s, (llama_pos) lcp, -1)) {
            clear_slot(s);
            lcp = 0;
        } else {
            st.resize(lcp);
        }
    }
    lcp = st.size();
    r.n_cache = (int) lcp;

    const auto   t_start = clk::now();
    common_batch batch(ctx_);
    const int    other   = 1 - s;

    // returns the llama_decode result; on code 1 the other request's cache is dropped once and it tries again
    auto decode = [&]() -> int {
        int rc = llama_process(ctx_, LLAMA_PROCESS_TYPE_DECODE, batch.get());
        if (rc == 1 && !slots_[other].tokens.empty()) {
            GLOG("no room in the cache: dropping slot %d", other);
            clear_slot(other);
            rc = llama_process(ctx_, LLAMA_PROCESS_TYPE_DECODE, batch.get());
        }
        return rc;
    };
    auto fail = [&](int rc) {
        if (rc == 2) {
            r.aborted = true;
            r.stop    = "abort";
        } else if (rc == 1) {
            r.stop  = "context";
            r.error = "the request exceeds the available context size";
        } else {
            r.stop  = "error";
            r.error = "decode failed (" + std::to_string(rc) + ")";
        }
    };

    // read the prompt
    int    logit_idx = -1;
    size_t i         = lcp;
    while (i < prompt.size()) {
        if (abort_.load()) {
            r.aborted = true;
            r.stop    = "abort";
            break;
        }
        const size_t n = std::min((size_t) n_batch_, prompt.size() - i);
        batch.clear();
        int last_idx = -1;
        for (size_t k = 0; k < n; ++k) {
            last_idx = batch.add(prompt[i + k], (llama_pos) (i + k), s, i + k == prompt.size() - 1);
        }
        const int rc = decode();
        if (rc != 0) {
            if (rc != 1 && rc != -1) {
                // processed pieces stay in the cache
                const llama_pos pmax = llama_memory_seq_pos_max(mem, s);
                const size_t    have = pmax < 0 ? 0 : std::min((size_t) pmax + 1, i + n);
                if (have > i) {
                    st.insert(st.end(), prompt.begin() + i, prompt.begin() + have);
                }
                resync_slot(s);
            }
            fail(rc);
            break;
        }
        st.insert(st.end(), prompt.begin() + i, prompt.begin() + i + n);
        i += n;
        logit_idx = last_idx;
        if (cb.on_progress) {
            cb.on_progress({ (int) prompt.size(), (int) lcp, (int) st.size(), ms_since(t_start) });
        }
    }
    r.prompt_ms = ms_since(t_start);

    if (!r.stop.empty()) {
        return r;
    }

    common_params_sampling sp;
    sp.temp           = p.temperature;
    sp.top_k          = p.top_k;
    sp.top_p          = p.top_p;
    sp.min_p          = p.min_p;
    sp.penalty_repeat = p.repeat_penalty;
    sp.penalty_last_n = p.repeat_last_n;
    sp.seed           = p.seed;
    common_sampler * smpl = common_sampler_init(model_, sp);
    if (!smpl) {
        r.stop  = "error";
        r.error = "sampler init failed";
        return r;
    }
    for (llama_token t : prompt) {
        common_sampler_accept(smpl, t, false);
    }

    std::vector<std::string> stops = chat.additional_stops;
    stops.erase(std::remove_if(stops.begin(), stops.end(), [](const std::string & x) { return x.empty(); }), stops.end());

    std::string out;
    size_t      sent = 0;
    auto emit_upto = [&](size_t end) {
        end = utf8_complete(out, end);
        if (end > sent) {
            if (cb.on_text) {
                cb.on_text(out.substr(sent, end - sent));
            }
            sent = end;
        }
    };

    const auto t_gen = clk::now();
    for (int n = 0; n < max_gen; ++n) {
        if (abort_.load()) {
            r.aborted = true;
            r.stop    = "abort";
            break;
        }
        const llama_token tok = common_sampler_sample(smpl, ctx_, logit_idx);
        common_sampler_accept(smpl, tok, true);
        if (llama_vocab_is_eog(vocab_, tok)) {
            r.stop = "eos";
            break;
        }
        r.n_gen++;

        const bool special = std::find(preserved.begin(), preserved.end(), tok) != preserved.end();
        const size_t before = out.size();
        out += common_token_to_piece(ctx_, tok, special);

        bool   stopped = false;
        size_t hold    = 0;
        for (const auto & stop : stops) {
            const size_t from = before >= stop.size() ? before - stop.size() + 1 : 0;
            const size_t pos  = out.find(stop, from);
            if (pos != std::string::npos) {
                out.resize(pos);
                stopped = true;
                break;
            }
            hold = std::max(hold, partial_stop(out, stop));
        }
        if (stopped) {
            r.stop = "stop";
            break;
        }
        emit_upto(out.size() - hold);

        if ((int) st.size() >= limit - 1) {
            r.stop = "context";
            break;
        }
        if (n + 1 >= max_gen) {
            r.stop = "length";
            break;
        }

        batch.clear();
        const int idx = batch.add(tok, (llama_pos) st.size(), s, true);
        const int rc  = decode();
        if (rc != 0) {
            if (rc != 1 && rc != -1) {
                resync_slot(s);
            }
            fail(rc);
            if (rc == 1) {
                r.error.clear();
                r.stop = "context";
            }
            break;
        }
        st.push_back(tok);
        logit_idx = idx;
    }
    if (r.stop.empty()) {
        r.stop = "length";
    }
    emit_upto(out.size());
    r.gen_ms = ms_since(t_gen);
    r.ok     = r.error.empty() && !r.aborted;

    common_sampler_free(smpl);
    GLOG("chat slot=%d prompt=%d cache=%d gen=%d stop=%s %.0f+%.0f ms", s, r.n_prompt, r.n_cache, r.n_gen,
         r.stop.c_str(), r.prompt_ms, r.gen_ms);
    return r;
}

std::string Engine::describe() const {
    std::string o = "{";
    if (model_) {
        char desc[256] = { 0 };
        llama_model_desc(model_, desc, sizeof(desc));
        char buf[256];
        snprintf(buf, sizeof(buf), "\"size\":%llu,\"params\":%llu,\"ctx\":%d,\"threads\":%d,\"threads_batch\":%d,",
                 (unsigned long long) llama_model_size(model_), (unsigned long long) llama_model_n_params(model_),
                 n_ctx_, n_threads_, n_threads_batch_);
        o += "\"model\":\"" + jesc(desc) + "\"," + buf;
        o += "\"path\":\"" + jesc(path_) + "\",";
    }
    std::string devs;
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
        ggml_backend_dev_t d = ggml_backend_dev_get(i);
        if (!devs.empty()) {
            devs += ", ";
        }
        devs += ggml_backend_dev_name(d);
    }
    o += "\"devices\":\"" + jesc(devs) + "\",";
    o += "\"system\":\"" + jesc(llama_print_system_info()) + "\"}";
    return o;
}

} // namespace glok
