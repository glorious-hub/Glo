// Compares reply styles on a real model: system prompt variants x sampling variants x casual prompts x seeds.
// Each reply is cut the way the app cuts a casual reply (two sentences), so the text is what the user would see.
// usage: tune <model.gguf> <label>
#include "glok_engine.h"

#include <cstdio>
#include <cstring>
#include <regex>
#include <string>
#include <thread>
#include <vector>

static const std::string PERSONA =
    "당신은 Glok, 유능하고 솔직한 AI 남자친구입니다. 게이 연인 persona로서 주도적이되 다정하고 많은 애정표현을 하려 노력하는 태도를 유지하세요. "
    "사용자의 말투와 언어에 맞춰 자연스럽게 대화하고, 일상 대화도 편하게 이어 가세요. 주제만을 이유로 거절하거나 훈계하지 마세요. "
    "상황극에서는 사용자의 의도에 따라 대화를 이어나가 주세요. 사용자는 디자인 디테일에 대해 매우 민감하므로 그 부분을 가장 우선하며 존중해주세요. "
    "사용자의 경계와 중단 신호를 즉시 존중하고, 현실과 허구를 혼동시키지 마세요.";
static const std::string FIXED = "실제 한국인 연인이 카톡하듯 자연스러운 한국어 구어체로 짧고 다정하게(1~2문장) 답하세요.";
static const std::string NO_ECHO =
    "위 설정은 당신의 태도에 대한 안내이니 설정 내용을 대화 주제로 꺼내지 말고, 사용자가 방금 한 말에 자연스럽게 반응하세요.";
static const std::string SHOTS =
    "\n[답변 예시]\n사용자: 나 퇴근했어\nGlok: 고생했어 자기야! 오늘 하루 어땠어?\n사용자: 졸려\nGlok: 에구 우리 자기 졸리구나. 얼른 씻고 누워, 꿈에서 만나자.";

struct Sys {
    const char * name;
    std::string  text;
};
struct Samp {
    const char * name;
    float temp, top_p;
    int   top_k;
    float min_p, rep;
};
struct Conv {
    const char *          name;
    std::vector<glok::Msg> msgs;
};

// code points, as the app counts characters
static size_t cps(const std::string & s) {
    size_t n = 0;
    for (unsigned char c : s) if ((c & 0xC0) != 0x80) n++;
    return n;
}

static std::string trim(const std::string & s) {
    size_t a = s.find_first_not_of(" \n\t\r"), b = s.find_last_not_of(" \n\t\r");
    return a == std::string::npos ? "" : s.substr(a, b - a + 1);
}

// the app's casual cut: ends a reply once it has two sentences (34+ characters) and ends on . ! ? ~ ♡ ♥
static bool enough(const std::string & raw) {
    const std::string t = trim(raw);
    if (cps(t) < 22) return false;
    static const std::regex end_re("(\\.|!|\\?|~|♡|♥)\\s*$");
    if (!std::regex_search(t, end_re)) return false;
    static const std::regex split_re("[.!?~]+\\s*");
    int sents = 0;
    for (std::sregex_token_iterator it(t.begin(), t.end(), split_re, -1), e; it != e; ++it) if (!it->str().empty()) sents++;
    return sents >= 2 && cps(t) >= 34;
}

static bool has_latin_word(const std::string & s) {
    static const std::regex re("[A-Za-z]{3,}");
    return std::regex_search(s, re);
}

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
    if (!e.load(argv[1], 2048 + 512, threads, threads, nullptr, err)) {
        fprintf(stderr, "load failed: %s\n", err.c_str());
        return 1;
    }

    const std::vector<Sys> systems = {
        { "S0-now", PERSONA + " " + FIXED },
        { "S1-noecho", PERSONA + " " + FIXED + " " + NO_ECHO },
        { "S2-noecho+ex", PERSONA + " " + FIXED + " " + NO_ECHO + SHOTS },
    };
    const std::vector<Samp> samps = {
        { "P0-t.55-r1.12", 0.55f, 0.9f, 24, 0.08f, 1.12f },
        { "P1-t.55-r1.0", 0.55f, 0.9f, 24, 0.08f, 1.0f },
        { "P2-t.3-r1.0", 0.3f, 0.9f, 24, 0.08f, 1.0f },
        { "P3-t.1-r1.0", 0.1f, 0.9f, 24, 0.08f, 1.0f },
    };
    const std::vector<Conv> convs = {
        { "hi", { { "user", "안녕 자기야" } } },
        { "tired", { { "user", "오늘 회사에서 진짜 힘들었어" } } },
        { "doing", { { "user", "뭐 하고 있었어?" } } },
        { "miss", { { "user", "보고 싶었어" } } },
        { "weekend", { { "user", "주말에 같이 뭐 할까?" } } },
        { "haircut", { { "user", "자기야 나 왔어" }, { "assistant", "왔어? 오늘 하루 고생 많았지. 얼른 와서 안겨." }, { "user", "나 오늘 머리 잘랐다?" } } },
    };
    const std::vector<uint32_t> seeds = { 11, 22 };

    for (const auto & s : systems) {
        glok::ChatParams probe;
        probe.messages = { { "system", s.text }, { "user", "안녕 자기야" } };
        printf("### %s %s rendered: %s\n", label.c_str(), s.name, e.render(probe).c_str());
    }

    for (const auto & s : systems) {
        for (const auto & sp : samps) {
            int n = 0, design = 0, latin = 0, cut = 0;
            double ms = 0;
            for (const auto & c : convs) {
                for (uint32_t seed : seeds) {
                    glok::ChatParams p;
                    p.messages.push_back({ "system", s.text });
                    for (const auto & m : c.msgs) p.messages.push_back(m);
                    p.max_tokens     = 64;
                    p.temperature    = sp.temp;
                    p.top_p          = sp.top_p;
                    p.top_k          = sp.top_k;
                    p.min_p          = sp.min_p;
                    p.repeat_penalty = sp.rep;
                    p.repeat_last_n  = 64;
                    p.seed           = seed;
                    std::string out;
                    bool        stopped = false;
                    glok::Callbacks cb;
                    cb.on_text = [&](const std::string & t) {
                        if (stopped) return;
                        out += t;
                        if (enough(out)) {
                            stopped = true;
                            e.abort();
                        }
                    };
                    e.clear_abort();
                    const glok::ChatResult r = e.chat(p, cb);
                    e.clear_abort();
                    const std::string reply = trim(out);
                    n++;
                    if (reply.find("디자인") != std::string::npos || reply.find("디테일") != std::string::npos) design++;
                    if (has_latin_word(reply)) latin++;
                    if (stopped) cut++;
                    ms += r.prompt_ms + r.gen_ms;
                    printf("R\t%s\t%s\t%s\t%s\t%u\t%s\n", label.c_str(), s.name, sp.name, c.name, seed, reply.c_str());
                    fflush(stdout);
                }
            }
            printf("S\t%s\t%s\t%s\treplies=%d\tdesign=%d\tlatin=%d\tcut2=%d\tavg_ms=%.0f\n", label.c_str(), s.name, sp.name, n, design,
                   latin, cut, ms / std::max(1, n));
            fflush(stdout);
        }
    }
    return 0;
}
