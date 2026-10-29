// Runs chat requests from a JSON file on a real model with the app's engine and writes the replies as JSON.
// usage: runchat <model.gguf> <requests.json> <replies.json>
// requests: [{"name":"…","messages":[{"role":"system","content":"…"},…],"max_tokens":64,"temperature":0.55,
//             "top_p":0.9,"top_k":24,"min_p":0.08,"repeat_penalty":1.12,"seeds":[11,22]}]
// replies:  [{"name":"…","seed":11,"text":"…","n_prompt":…,"n_gen":…,"prompt_ms":…,"gen_ms":…}] plus the memory used
#include "glok_engine.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <thread>

using json = nlohmann::ordered_json;

int main(int argc, char ** argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: %s model.gguf requests.json replies.json\n", argv[0]);
        return 2;
    }
    json reqs;
    try {
        std::ifstream f(argv[2]);
        reqs = json::parse(f);
    } catch (const std::exception & e) {
        fprintf(stderr, "bad requests: %s\n", e.what());
        return 2;
    }
    glok::Engine::init_backends("");
    const int threads = std::max(2, (int) std::thread::hardware_concurrency());
    glok::Engine e;
    std::string err;
    const auto t0 = std::chrono::steady_clock::now();
    if (!e.load(argv[1], 2048 + 512, threads, threads, nullptr, err)) { // as the app loads it: memory size 2048 + 512
        fprintf(stderr, "load failed: %s\n", err.c_str());
        return 1;
    }
    const double load_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

    json out = json::array();
    for (const auto & r : reqs) {
        glok::ChatParams base;
        for (const auto & m : r.at("messages")) base.messages.push_back({ m.at("role").get<std::string>(), m.at("content").get<std::string>() });
        base.max_tokens     = r.value("max_tokens", 64);
        base.temperature    = r.value("temperature", 0.55f);
        base.top_p          = r.value("top_p", 0.9f);
        base.top_k          = r.value("top_k", 24);
        base.min_p          = r.value("min_p", 0.08f);
        base.repeat_penalty = r.value("repeat_penalty", 1.12f);
        base.n_ctx_limit    = 2048;
        std::vector<uint32_t> seeds = r.value("seeds", std::vector<uint32_t>{ 11 });
        for (uint32_t seed : seeds) {
            glok::ChatParams p = base;
            p.seed = seed;
            std::string text;
            glok::Callbacks cb;
            cb.on_text = [&](const std::string & t) { text += t; };
            e.clear_abort();
            const glok::ChatResult res = e.chat(p, cb);
            out.push_back({ { "name", r.value("name", "") }, { "seed", seed }, { "text", text }, { "ok", res.ok }, { "error", res.error },
                            { "n_prompt", res.n_prompt }, { "n_cache", res.n_cache }, { "n_gen", res.n_gen },
                            { "prompt_ms", res.prompt_ms }, { "gen_ms", res.gen_ms } });
            fprintf(stderr, "%s seed %u: %d+%d tokens, %.0f+%.0f ms\n", r.value("name", "").c_str(), seed, res.n_prompt, res.n_gen, res.prompt_ms, res.gen_ms);
        }
    }
    long hwm = 0;
    FILE * st = fopen("/proc/self/status", "r");
    if (st) {
        char line[256];
        while (fgets(line, sizeof line, st)) if (!strncmp(line, "VmHWM:", 6)) hwm = atol(line + 6);
        fclose(st);
    }
    json doc = { { "load_ms", load_ms }, { "vm_hwm_kb", hwm }, { "engine", json::parse(e.describe(), nullptr, false) }, { "replies", out } };
    std::ofstream(argv[3]) << doc.dump(1, ' ', false, json::error_handler_t::replace);
    return 0;
}
