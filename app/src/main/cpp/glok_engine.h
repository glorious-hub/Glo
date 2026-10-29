#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

struct llama_model;
struct llama_context;
struct llama_vocab;
struct common_chat_templates;

namespace glok {

struct Msg {
    std::string role;
    std::string content;
};

struct ChatParams {
    std::vector<Msg> messages;
    int      max_tokens      = 256;
    float    temperature     = 0.55f;
    float    top_p           = 0.9f;
    int      top_k           = 24;
    float    min_p           = 0.08f;
    float    repeat_penalty  = 1.12f;
    int      repeat_last_n   = 64;
    uint32_t seed            = 0xFFFFFFFF;
    bool     enable_thinking = false;
    int      n_ctx_limit     = 0; // tokens one request may use, 0 = whole context
};

struct Progress {
    int    total     = 0; // prompt tokens
    int    cache     = 0; // tokens reused from the cache
    int    processed = 0; // tokens in the cache now (cache included)
    double ms        = 0; // time since the prompt started
};

struct ChatResult {
    bool        ok      = false;
    bool        aborted = false;
    std::string error;
    std::string stop; // eos, stop, length, context, abort, error
    int         slot      = 0;
    int         n_prompt  = 0;
    int         n_cache   = 0;
    int         n_gen     = 0;
    double      prompt_ms = 0;
    double      gen_ms    = 0;
    std::string to_json() const;
};

struct Callbacks {
    std::function<void(const Progress &)>    on_progress;
    std::function<void(const std::string &)> on_text; // whole UTF-8 characters only
};

class Engine {
  public:
    // load the CPU backend variants (libggml-cpu-*.so) from dir; empty dir = backends linked in
    static void init_backends(const std::string & dir);
    // number of fast cores to use for the work threads
    static int perf_cores();

    Engine();
    ~Engine();

    bool load(const std::string & path, int n_ctx, int n_threads, int n_threads_batch,
              const std::function<bool(float)> & progress, std::string & err);
    void unload();
    bool is_loaded() const { return ctx_ != nullptr; }

    ChatResult chat(const ChatParams & p, const Callbacks & cb);

    // safe from any thread; stops the running request at its next step
    void abort() { abort_.store(true); }
    void clear_abort() { abort_.store(false); }

    std::string describe() const; // JSON

  private:
    struct Slot {
        std::vector<int32_t> tokens; // what the memory holds for this sequence, from position 0
        uint64_t             used = 0;
    };

    static bool abort_cb(void * data);

    int  pick_slot(const std::vector<int32_t> & prompt, size_t & lcp) const;
    void clear_slot(int s);
    void resync_slot(int s);

    llama_model *          model_ = nullptr;
    llama_context *        ctx_   = nullptr;
    const llama_vocab *    vocab_ = nullptr;
    common_chat_templates * tmpls_ = nullptr;

    std::vector<Slot> slots_;
    uint64_t          use_seq_ = 0;
    int               n_ctx_   = 0;
    int               n_batch_ = 256;
    int               n_threads_ = 0;
    int               n_threads_batch_ = 0;
    std::string       path_;

    std::atomic<bool> abort_{ false };
};

// longest prefix of complete UTF-8 characters in s[0, n)
size_t utf8_complete(const std::string & s, size_t n);

} // namespace glok
