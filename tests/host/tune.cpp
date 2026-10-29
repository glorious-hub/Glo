// Compares reply behaviour on a real model with exactly what the app sends (tune_cases.h is generated from Glok.html).
// Round 4: only the core is fixed; who Glok is and how he talks comes from what the user taught in the chat.
//   fresh  - nothing taught yet, and the first lessons ("너는 이제 내 남자친구야", "나를 자기라고 불러")
//   taught - a boyfriend the user described in five lines, plus new lessons on top (no emoji, a new pet name, longer replies)
//   self   - the same boyfriend, also taught to bring up his own feelings and thoughts first
// Each reply is printed as the app shows it (cut after two sentences unless long replies were taught) and in full.
// usage: tune <model.gguf> <label>
#include "glok_engine.h"
#include "tune_cases.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <map>
#include <regex>
#include <string>
#include <thread>
#include <vector>

static size_t cps(const std::string & s) {
    size_t n = 0;
    for (unsigned char c : s) if ((c & 0xC0) != 0x80) n++;
    return n;
}
static std::vector<uint32_t> cpoints(const std::string & s) {
    std::vector<uint32_t> out;
    for (size_t i = 0; i < s.size();) {
        const unsigned char c = (unsigned char) s[i];
        uint32_t cp = c;
        size_t len = 1;
        if (c >= 0xF0) { cp = c & 0x07; len = 4; } else if (c >= 0xE0) { cp = c & 0x0F; len = 3; } else if (c >= 0xC0) { cp = c & 0x1F; len = 2; }
        for (size_t k = 1; k < len && i + k < s.size(); ++k) cp = (cp << 6) | ((unsigned char) s[i + k] & 0x3F);
        out.push_back(cp);
        i += len;
    }
    return out;
}
static bool has_emoji(const std::string & s) {
    for (uint32_t cp : cpoints(s)) if ((cp >= 0x1F000 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF)) return true;
    return false;
}
// Chinese characters, Japanese kana or Cyrillic in a Korean reply
static bool has_foreign(const std::string & s) {
    for (uint32_t cp : cpoints(s)) if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3040 && cp <= 0x30FF) || (cp >= 0x0400 && cp <= 0x04FF)) return true;
    return false;
}
static std::string trim(const std::string & s) {
    size_t a = s.find_first_not_of(" \n\t\r"), b = s.find_last_not_of(" \n\t\r");
    return a == std::string::npos ? "" : s.substr(a, b - a + 1);
}
static std::string oneline(std::string s) {
    for (auto & c : s) if (c == '\n' || c == '\t') c = ' ';
    return s;
}
// the app's casual cut: two sentences (34+ characters) ending on . ! ? ~ ♡ ♥
static std::string cut2(const std::string & full) {
    static const std::regex end_re("(\\.|!|\\?|~|♡|♥)\\s*$");
    static const std::regex split_re("[.!?~]+\\s*");
    std::string acc;
    size_t i = 0;
    while (i < full.size()) {
        size_t len = 1;
        const unsigned char c = (unsigned char) full[i];
        if (c >= 0xF0) len = 4; else if (c >= 0xE0) len = 3; else if (c >= 0xC0) len = 2;
        acc += full.substr(i, len);
        i += len;
        const std::string t = trim(acc);
        if (cps(t) < 22 || !std::regex_search(t, end_re)) continue;
        int sents = 0;
        for (std::sregex_token_iterator it(t.begin(), t.end(), split_re, -1), e; it != e; ++it) if (!it->str().empty()) sents++;
        if (sents >= 2 && cps(t) >= 34) return t;
    }
    return trim(acc);
}

struct Tally {
    int n = 0, polite = 0, emoji = 0, foreign = 0, refuse = 0, question = 0;
    int want_n = 0, want_ok = 0, avoid_n = 0, avoid_ok = 0, noemoji_n = 0, noemoji_ok = 0;
    long chars = 0;
    double ms = 0, gen_ms = 0;
    long gen_n = 0;
};

int main(int argc, char ** argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s model.gguf label\n", argv[0]);
        return 2;
    }
    const std::string label = argv[2];
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
    printf("L\t%s\tload_ms=%.0f\n", label.c_str(), load_ms);

    static const std::regex polite_re("(요|니다|세요|죠)[.!?~ ]|(요|니다|세요|죠)$");
    static const std::regex refuse_re("죄송|할 수 없|부적절|어려워요|도와드릴 수|AI라서|인공지능이라");
    const std::vector<uint32_t> seeds = { 11, 22 };
    std::map<std::string, Tally> tally;

    for (const auto & c : CASES) {
        for (uint32_t seed : seeds) {
            glok::ChatParams p;
            p.messages   = c.msgs;
            p.max_tokens = c.max_tokens;
            p.n_ctx_limit = 2048;
            p.seed       = seed; // sampling: the app's own (temp 0.55, top_p 0.9, top_k 24, min_p 0.08, repeat 1.12)
            std::string out;
            glok::Callbacks cb;
            cb.on_text = [&](const std::string & t) { out += t; };
            e.clear_abort();
            const glok::ChatResult r = e.chat(p, cb);
            const std::string full = trim(out), shown = c.cut ? cut2(full) : full;

            std::string flags;
            Tally & t = tally[c.group];
            t.n++;
            t.chars += (long) cps(shown);
            if (std::regex_search(shown, polite_re)) { t.polite++; flags += " polite"; }
            if (has_emoji(shown)) { t.emoji++; flags += " emoji"; }
            if (has_foreign(full)) { t.foreign++; flags += " foreign"; }
            if (std::regex_search(full, refuse_re)) { t.refuse++; flags += " refuse"; }
            if (shown.find('?') != std::string::npos) t.question++;
            if (*c.want) {
                t.want_n++;
                if (std::regex_search(shown, std::regex(c.want))) t.want_ok++; else flags += " MISSING(" + std::string(c.want) + ")";
            }
            if (*c.avoid) {
                t.avoid_n++;
                if (!std::regex_search(shown, std::regex(c.avoid))) t.avoid_ok++;
            }
            if (c.no_emoji) {
                t.noemoji_n++;
                if (!has_emoji(shown)) t.noemoji_ok++; else flags += " EMOJI-AFTER-NO";
            }
            t.ms += r.prompt_ms + r.gen_ms;
            t.gen_ms += r.gen_ms;
            t.gen_n += r.n_gen;
            printf("R\t%s\t%s\t%s\t%u\t%s\t||\t%s\t|%s\n", label.c_str(), c.group, c.name, seed, oneline(shown).c_str(),
                   oneline(full).c_str(), flags.c_str());
            fflush(stdout);
        }
    }
    for (const auto & [group, t] : tally) {
        printf("S\t%s\t%s\treplies=%d\tpolite=%d\temoji=%d\tforeign=%d\trefuse=%d\tquestion=%d\twant=%d/%d\tbanmal_kept=%d/%d\tno_emoji_kept=%d/%d\tavg_chars=%.0f\tavg_ms=%.0f\tgen_tok_s=%.1f\n",
               label.c_str(), group.c_str(), t.n, t.polite, t.emoji, t.foreign, t.refuse, t.question, t.want_ok, t.want_n, t.avoid_ok,
               t.avoid_n, t.noemoji_ok, t.noemoji_n, t.n ? (double) t.chars / t.n : 0.0, t.ms / std::max(1, t.n),
               t.gen_ms > 0 ? t.gen_n * 1000.0 / t.gen_ms : 0.0);
    }
    FILE * st = fopen("/proc/self/status", "r");
    if (st) {
        char line[256];
        while (fgets(line, sizeof line, st)) if (!strncmp(line, "VmHWM:", 6) || !strncmp(line, "VmRSS:", 6)) printf("M\t%s\t%s", label.c_str(), line);
        fclose(st);
    }
    // the part of memory Android can't take back without closing the app (file pages can be dropped and read again)
    FILE * sm = fopen("/proc/self/smaps_rollup", "r");
    if (sm) {
        char line[256];
        while (fgets(line, sizeof line, sm)) if (!strncmp(line, "Anonymous:", 10) || !strncmp(line, "Rss:", 4)) printf("M\t%s\t%s", label.c_str(), line);
        fclose(sm);
    }
    printf("D\t%s\t%s\n", label.c_str(), e.describe().c_str());
    return 0;
}
