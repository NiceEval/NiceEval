<div align="center">

# NiceEval

**점진적이고, Agent Native하며, DX가 뛰어난 경량 AI 에이전트 evals 도구**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval은 [eve](https://eve.dev)에서 영감을 받은 범용 agent eval 도구입니다. 무엇보다 뛰어난 DX 설계를 갖추고 있어서 누구나 10분 정도면 익히고 설정할 수 있습니다. 그리고 설계가 매우 범용적입니다. Claude Code/Codex용으로 작성한 coding agent의 플러그인, Hook, Skill을 평가하는 데 사용할 수 있을 뿐 아니라, 직접 만든 AI Agent 프레임워크(AI SDK, LangGraph, Pi 등 무엇을 기반으로 하든)도 손쉽게 연결해 평가할 수 있습니다.

eval이 끝나면 읽기 쉬운 리포트를 생성하고 Agent의 행동 디테일을 확인할 수 있습니다. 디버깅과 Agent 행동을 이해하는 데 편리합니다.

## DeepEval, LangFuse, BrainTrust가 있는데 왜 NiceEval이 필요한가

NiceEval은 AI Native한 Eval 평가 도구입니다. 기존 도구들에서 Dataset과 golden으로 Input과 Expected Output을 구성하는 방식은 실제 Agent 평가에는 적합하지 않습니다. 또한 오늘날의 Agent는 여러 차례에 걸친 사용자 대화, 다중 Agent, 도구 호출, Skill 로딩 등 세밀한 단위로 평가해야 하는데, NiceEval은 이런 부분을 더 잘 해낼 수 있습니다.

동시에 LangFuse, BrainTrust와도 공존할 수 있습니다. 전자를 tracing에 사용하거나, 평가 결과를 두 도구 모두에 업로드할 수 있습니다(구현 중).

## 아키텍처

NiceEval은 테스트 대상 시스템이 격리된 샌드박스 파일 시스템을 필요로 하는지에 따라 두 가지 연결 방식을 지원합니다.

**방식 1: Sandbox(Docker, E2B) — 샌드박스가 필요한 Codex, Claude Code 등 coding agent 실행**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agent 어댑터(공식)
        ▼
   ┌───────────────────────────────┐
   │        Docker Sandbox         │
   │    ┌───────────────────────┐  │
   │    │ Codex / Claude Code | │  │
   │    │ 격리된 파일 시스템이  │  │
   │    │  필요한 애플리케이션  │  │
   │    └───────────────────────┘  │
   └───────────────────────────────┘
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
   │       직접 만든 Web Agent      │
   │   (HTTP / AI SDK·LangGraph   │
   │    Pi 등 자체 프레임워크,       │
   │    Docker 불필요)              │
   └──────────────────────────────┘
```

- **NiceEval 코어**는 eval 탐색, 실행 스케줄링, 채점, 리포트 및 artifacts 생성을 담당합니다.
- **Agent 어댑터**는 열린 경계입니다: 테스트 대상 시스템을 어떻게 호출할지는 사용자가 결정합니다.
- 파일 시스템 격리가 필요한 coding agent는 **Docker Sandbox**를 사용하고, 자체 Web Agent는 Docker 없이 직접 연결할 수 있습니다.


## 예시

eval 하나를 실행하려면 두 개의 파일이 필요합니다. eval 자체(무엇을 테스트할지)와 experiment(어떤 agent를 실행할지)입니다. CLI는 단독 eval id를 받지 않습니다 — `niceeval exp <experiment> <eval 접두사>`에서 experiment가 바로 "어떤 테스트 대상에 연결할지"를 결정하는 부분입니다. 아래는 Web Agent에 직접 연결하는 실제 시나리오입니다(전체 프로젝트는 [`examples/zh/ai-sdk/`](../examples/zh/ai-sdk/) 참고). 이 예시는 agent가 실시간 날씨 질문을 받았을 때 도구를 호출하고, 도구 결과를 바탕으로 답변하며 임의로 지어내지 않는지를 검증합니다.

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "agent가 실시간 날씨 질문에서 도구를 올바르게 호출하고 결과를 바탕으로 답변하는 능력을 테스트",

  async test(t) {
    const turn = await t.send("베이징 오늘 날씨 어때?");
    t.succeeded();

    await t.group("get_weather를 호출하고 도시가 올바른지 확인", () => {
      t.calledTool("get_weather", { input: { city: "베이징" } });
      t.messageIncludes(/°C|기온|날씨|맑음|흐림|비/);
    });

    const second = await t.send("상하이 내일 날씨 어때?");
    second.messageIncludes("상하이");

    t.judge.autoevals
      .closedQA("어시스턴트가 도구가 반환한 날씨 데이터를 바탕으로 답했는가, 임의로 온도를 지어내지 않았는가?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // 테스트 대상 web agent에 연결하는, 직접 작성한 agent adapter

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // local experiment로 eval-tool-call만 실행
pnpm exec niceeval view // 평가 결과 확인
```

## 빠른 시작

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

여러분의 시나리오에서 시작하세요:

- [Claude Code / Codex 플러그인을 eval해야 한다면](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Claude Code / Codex Skill을 eval해야 한다면](https://niceeval.com/docs/example/claude-code-codex-skill)
- [AI Agent 애플리케이션을 eval해야 한다면](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
공식 어댑터
- [ ] Agent 소프트웨어
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent 프레임워크
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
  - [ ] vm0
  - [ ] Cursor Agent SDK

## 문서

- [빠른 시작](https://niceeval.com/docs/quickstart)

# 감사의 말
이 프로젝트는 아래 프로젝트들에서 영감을 받았거나, AI가 아래 프로젝트의 코드를 학습하여 작성되었습니다.
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

다음 커뮤니티에도 감사드립니다
