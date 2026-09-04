<div align="center">

# NiceEval

**점진적이고, Agent Native하며, DX가 뛰어난 AI 에이전트 evals 도구**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval은 팀이 프로덕션 환경의 AI를 측정, 평가, 개선하도록 돕는 Agent eval 도구입니다. NiceEval을 사용하면 팀은 모델을 비교하고, Agent를 반복 개선하고, 회귀를 발견하며, 실제 사용자 데이터를 활용해 AI 애플리케이션을 지속적으로 개선할 수 있습니다.

NiceEval은 로컬 우선(local-first)을 핵심으로 합니다. 여러분의 eval은 여러분 자신의 환경에서 실행됩니다. 팀에서 eval을 공유하거나 회귀를 추적해야 할 때는 Report를 BrainTrust 같은 플랫폼에 push하거나, 커스텀 리포트로 내보낼 수 있습니다.

## DeepEval, LangFuse, BrainTrust가 있는데 왜 NiceEval이 필요한가
NiceEval은 Agent-Native한 평가 도구입니다. Dataset / golden 방식으로 "Input과 Expected Output을 구성하는" 패턴은 실제 Agent 평가에 적합하지 않습니다.
오늘날의 Agent는 멀티턴 대화, 멀티 agent 협업, 도구 호출, Skill 로딩 같은 세밀한 시나리오에서 평가되어야 하며, NiceEval은 이를 더 잘 해낼 수 있습니다.

동시에 NiceEval은 LangFuse, BrainTrust와 공존할 수도 있습니다. 이들을 tracing에 사용하거나, 평가 결과를 두 도구에 업로드할 수 있습니다.

## 아키텍처

NiceEval은 테스트 대상 agent가 격리된 샌드박스 파일 시스템을 필요로 하는지에 따라 두 가지 연결 방식을 지원합니다.

**방식 1: Sandbox(Docker, E2B) — 샌드박스가 필요한 Codex, Claude Code 등 coding agent 실행**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     NiceEval        │
   └─────────────────────┘
        │
        │ Agent 어댑터(공식)
        ▼
   ┌──────────────────────────────────────┐
   │            Docker Sandbox            │
   │   ┌────────────────────────────────┐ │
   │   │ Codex / Claude Code            │ │
   │   │ 격리된 파일 시스템이 필요한 앱 │ │
   │   └────────────────────────────────┘ │
   └──────────────────────────────────────┘
```

**방식 2: 직접 연결 — 직접 만든 AI Agent에 바로 연결**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     NiceEval        │
   └─────────────────────┘
        │
        │ Agent 어댑터(공식, 또는 직접 구현)
        ▼
   ┌──────────────────────────────┐
   │      직접 만든 AI Agent      │
   │    (AI SDK·LangGraph·Pi)     │
   └──────────────────────────────┘
```

- **NiceEval 코어**는 eval 탐색, 실행 스케줄링, 채점, 리포트 및 artifacts 생성을 담당합니다.
- **Agent 어댑터**는 열린 경계입니다: 테스트 대상 시스템을 어떻게 호출할지는 사용자가 결정합니다.
- 파일 시스템 격리가 필요한 coding agent는 **Docker Sandbox**를 사용하고, 직접 만든 AI Agent는 Docker 없이 직접 연결할 수 있습니다.

## 핵심 개념 한눈에 보기

| 개념 | 한 줄 설명 |
|---|---|
| Eval | 테스트 케이스: `evals/*.eval.ts`에 작성하며, 무엇을 확인할지 기술한다. |
| Experiment | 체크인 가능한 실행 설정: 어떤 Adapter, 어떤 model, 어떤 flags를 사용할지 결정한다. |
| Adapter | 테스트 대상 시스템에 연결하는 계층: `send` 하나만 구현하면 표준 이벤트 스트림을 돌려받는다. |
| Sandbox | 격리된 워크스페이스가 필요한 coding agent에만 필요하며, 직접 연결하는 web agent에는 필요 없다. |
| Tier | Adapter 연동에 들이는 노력의 세 단계: Tier 1은 `send`만 연결하고, Tier 2는 호출 흐름을 보기 위해 OTel을 추가하며, Tier 3은 feature A/B 테스트를 위해 침습적인 변경을 가한다. |

전체 용어집은 [아키텍처 개요](https://niceeval.com/docs/concepts/overview)에서 확인할 수 있습니다.

## 예시

```ts
// evals/eval-tool-call.eval.ts
import { defineEval, defineJudge, judge } from "niceeval";
import { includes, jsonMatch, pattern, toolMatch } from "niceeval/expect";

const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: { criterion: judge.referenceText({ name: "criterion", text: "Does the reply use the tool's weather data?" }) },
});

export default defineEval({
  judge: judging,
  description: "agent가 실시간 날씨 질문에서 도구를 올바르게 호출하고 결과를 바탕으로 답변하는 능력을 테스트",

  async test(t) {
    const turn = await t.send("베이징 오늘 날씨 어때?");
    turn.succeeded();

    await t.group("get_weather를 호출하고 도시가 올바른지 확인", () => {
      turn.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "베이징" }) }));
      t.check(turn.message, pattern(/°C|기온|날씨|맑음|흐림|비/));
    });

    const second = await t.send("상하이 내일 날씨 어때?");
    t.check(second.message, includes("상하이"));

    const check = judge.check({
      recipe: judging.recipes[0],
      material: { task: turn.material.input, reply: turn.material.reply, criterion: judging.material.criterion },
    });
    turn.check(check, judge.llm().atLeast(0.7)).gate();
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // 테스트 대상 web agent에 연결하는, 직접 작성한 agent adapter

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // local experiment로 eval-tool-call만 실행
pnpm exec niceeval view // 평가 결과 확인
```

## 빠른 시작

```text
READ https://niceeval.com/INIT.md and set up niceeval for this repo: install it, integrate it with this project, and run the first eval end to end.
```

여러분의 시나리오에서 시작하세요:

- [Claude Code / Codex 플러그인을 eval해야 한다면](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Claude Code / Codex Skill을 eval해야 한다면](https://niceeval.com/docs/example/claude-code-codex-skill)
- [AI Agent 애플리케이션을 eval해야 한다면](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
공식 어댑터
- [ ] Agent 소프트웨어
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent 프레임워크
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## 문서

- [빠른 시작](https://niceeval.com/docs/quickstart)

# 감사의 말
이 프로젝트는 아래 프로젝트들에서 영감을 받았거나, AI가 아래 프로젝트의 코드를 학습하여 작성되었습니다.
- [eve](https://eve.dev): 주요 DX와 API에 영감을 준 프로젝트
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

프로젝트 초기 개발 과정에서 지원과 피드백을 제공해 주신 [Linux.do](https://linux.do/)에 감사드립니다.
