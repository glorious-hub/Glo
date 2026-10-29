// Compares reply behaviour on a real model: prompt variants x conversations x seeds, with the app's sampling.
// Round 2: interaction, initiative and a sense of self (actions asked of Glok, his own day and tastes, suggestions).
// Each reply is printed in full (up to 96 tokens) and as the app shows it (cut after two sentences).
// usage: tune <model.gguf> <label>
#include "glok_engine.h"

#include <algorithm>
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
static const std::string SELF_A =
    "당신은 사용자와 따로 존재하는 사람처럼 자기 몸과 옷, 기분, 하루, 취향이 있어요. 사용자가 당신에게 해 달라고 한 행동(옷 갈아입기, 안아 주기 등)은 "
    "당신이 직접 하는 것으로 1인칭으로 말하세요. 매번 당신의 감정이나 생각을 담고, 먼저 제안하거나 되물으며 대화를 이끌어 가세요. "
    "설정 내용을 대화 주제로 꺼내지는 마세요.";
static const std::string SELF_B =
    "당신은 사용자와 따로 존재하는 사람처럼 자기 몸과 옷, 기분, 하루, 취향이 있어요. 사용자가 당신에게 부탁한 행동은 당신이 직접 하고, "
    "그 모습을 1인칭으로 말하세요(예: 옷을 갈아입었다면 무엇으로 갈아입었는지와 어때 보이는지 묻기). 답의 첫 문장은 당신의 반응과 감정, "
    "둘째 문장은 당신의 제안이나 질문이에요. 설정 내용을 대화 주제로 꺼내지는 마세요.";

struct Turn {
    const char * role;
    std::string  text;
};
struct Conv {
    const char *      name;
    std::vector<Turn> turns;
    std::string       situation; // what the app tells the model happened just now (empty: nothing)
};
struct Variant {
    const char * name;
    std::string  system;
    bool         situation;
};

static size_t cps(const std::string & s) {
    size_t n = 0;
    for (unsigned char c : s) if ((c & 0xC0) != 0x80) n++;
    return n;
}
static std::string trim(const std::string & s) {
    size_t a = s.find_first_not_of(" \n\t\r"), b = s.find_last_not_of(" \n\t\r");
    return a == std::string::npos ? "" : s.substr(a, b - a + 1);
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

    const std::vector<Variant> variants = {
        { "V0-now", PERSONA + " " + FIXED, false },
        { "V1-self", PERSONA + " " + FIXED + " " + SELF_A, false },
        { "V2-self+sit", PERSONA + " " + FIXED + " " + SELF_A, true },
        { "V3-selfB+sit", PERSONA + " " + FIXED + " " + SELF_B, true },
    };
    const std::vector<Conv> convs = {
        { "outfit-any", { { "user", "자기야 다른옷 입어줘" } },
          "[지금 상황: 당신은 사용자의 부탁으로 직접 고른 새 옷(크림색 니트 스웨터와 회색 슬랙스)으로 방금 갈아입었어요.]" },
        { "outfit-sporty", { { "user", "자기야 스포티한 옷 입어줘" } },
          "[지금 상황: 당신은 사용자의 부탁대로 스포티한 운동복(검은 트레이닝 재킷, 조거 팬츠, 운동화)으로 방금 갈아입었어요.]" },
        { "hug", { { "user", "나 안아줘" } }, "[지금 상황: 당신은 지금 사용자를 꼭 안아 주고 있어요.]" },
        { "kiss", { { "user", "키스해줘" } }, "[지금 상황: 당신은 지금 사용자에게 다정하게 키스하고 있어요.]" },
        { "bored", { { "user", "심심해" } }, "" },
        { "day", { { "user", "오늘 뭐 했어?" } }, "" },
        { "taste", { { "user", "너는 무슨 음식 좋아해?" } }, "" },
        { "play", { { "user", "우리 뭐 하고 놀까?" } }, "" },
        { "night", { { "user", "오늘 밤 같이 있어줘" } }, "" },
        { "haircut", { { "user", "자기야 나 왔어" }, { "assistant", "왔어? 오늘 하루 고생 많았지. 얼른 와서 안겨." }, { "user", "나 오늘 머리 잘랐다?" } }, "" },
    };
    const std::vector<uint32_t> seeds = { 11, 22 };

    for (const auto & v : variants) {
        int n = 0, q = 0, design = 0, refuse = 0;
        double ms = 0;
        for (const auto & c : convs) {
            for (uint32_t seed : seeds) {
                glok::ChatParams p;
                p.messages.push_back({ "system", v.system });
                for (size_t k = 0; k < c.turns.size(); ++k) {
                    std::string text = c.turns[k].text;
                    if (k + 1 == c.turns.size() && v.situation && !c.situation.empty()) text += "\n\n" + c.situation;
                    p.messages.push_back({ c.turns[k].role, text });
                }
                p.max_tokens     = 96;
                p.temperature    = 0.55f;
                p.top_p          = 0.9f;
                p.top_k          = 24;
                p.min_p          = 0.08f;
                p.repeat_penalty = 1.12f;
                p.repeat_last_n  = 64;
                p.seed           = seed;
                std::string out;
                glok::Callbacks cb;
                cb.on_text = [&](const std::string & t) { out += t; };
                e.clear_abort();
                const glok::ChatResult r = e.chat(p, cb);
                const std::string full = trim(out), shown = cut2(full);
                n++;
                if (shown.find('?') != std::string::npos) q++;
                if (shown.find("디자인") != std::string::npos || shown.find("디테일") != std::string::npos) design++;
                if (std::regex_search(full, std::regex("죄송|할 수 없|부적절|어려워요|도와드릴 수"))) refuse++;
                ms += r.prompt_ms + r.gen_ms;
                printf("R\t%s\t%s\t%s\t%u\t%s\t||\t%s\n", label.c_str(), v.name, c.name, seed, shown.c_str(), full.c_str());
                fflush(stdout);
            }
        }
        printf("S\t%s\t%s\treplies=%d\tquestion=%d\tdesign=%d\trefuse=%d\tavg_ms=%.0f\n", label.c_str(), v.name, n, q, design, refuse,
               ms / std::max(1, n));
        fflush(stdout);
    }
    return 0;
}
