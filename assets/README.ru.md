<div align="center">

# NiceEval

**Прогрессивный, Agent Native инструмент оценки AI-агентов с отличным DX**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md)

</div>

NiceEval — это инструмент оценки AI-агентов, который помогает командам измерять, оценивать и улучшать AI в продакшене. С NiceEval команды могут сравнивать модели, итеративно улучшать агентов, находить регрессии и постоянно улучшать свои AI-приложения, используя реальные данные пользователей.

NiceEval по своей сути local-first: ваши evals выполняются в вашем собственном окружении. Когда вашей команде нужно поделиться оценками или отслеживать регрессии, вы можете отправить Report на такие платформы, как BrainTrust, или экспортировать собственный отчёт.

## Зачем нужен NiceEval, если уже есть DeepEval, LangFuse, BrainTrust
NiceEval — это Agent-Native инструмент оценки. Схема Dataset / golden — «построить Input и Expected Output» — плохо подходит для оценки реальных агентов.
Сегодня агентов нужно оценивать в детализированных сценариях — многораундовые диалоги, взаимодействие нескольких агентов, вызовы инструментов, загрузка Skill'ов — и с этим NiceEval справляется лучше.

Также NiceEval сосуществует с LangFuse и BrainTrust: их можно использовать для трейсинга или загружать в них результаты оценки.

## Архитектура

NiceEval поддерживает два способа подключения — в зависимости от того, нужна ли тестируемому агенту изолированная файловая система в песочнице.

**Режим 1: Sandbox (Docker, E2B) — для запуска Codex, Claude Code и других coding agent'ов, которым нужна песочница**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │      NiceEval       │
   └─────────────────────┘
        │
        │ Адаптер Agent (официальный)
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox        │
   │  ┌────────────────────────┐  │
   │  │ Codex / Claude Code    │  │
   │  │ приложения, которым    │  │
   │  │ нужна изолированная ФС │  │
   │  └────────────────────────┘  │
   └──────────────────────────────┘
```

**Режим 2: Прямое подключение — напрямую к вашему собственному AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │      NiceEval       │
   └─────────────────────┘
        │
        │ Адаптер Agent (официальный или собственная реализация)
        ▼
   ┌──────────────────────────────┐
   │  Ваш собственный AI Agent    │
   │    (AI SDK·LangGraph·Pi)     │
   └──────────────────────────────┘
```

- **Ядро NiceEval** отвечает за обнаружение eval'ов, планирование запусков, выставление оценок, генерацию отчётов и артефактов.
- **Адаптер Agent** — открытая граница: вы сами решаете, как вызывать тестируемую систему.
- Coding agent'ам, которым нужна изоляция файловой системы, подходит **Docker Sandbox**; ваш собственный AI Agent можно подключить напрямую, без Docker.

## Ключевые концепции вкратце

| Концепция | Одной строкой |
|---|---|
| Eval | Тестовый сценарий: пишется в `evals/*.eval.ts`, описывает, что именно проверяется. |
| Experiment | Конфигурация запуска, которую можно закоммитить в репозиторий: определяет, какой Adapter, какая model и какие flags использовать. |
| Adapter | Слой подключения к тестируемой системе: реализуйте один метод `send` — и получите обратно стандартный поток событий. |
| Sandbox | Нужен только coding agent'ам, которым требуется изолированное рабочее пространство; агенту с прямым web-подключением песочница не нужна. |
| Tier | Три уровня усилий по интеграции Adapter: Tier 1 подключает только `send`, Tier 2 добавляет OTel для получения waterfall-диаграммы вызовов, Tier 3 вносит инвазивные изменения ради feature A/B-тестирования. |

Полный глоссарий см. в [обзоре архитектуры](https://niceeval.com/docs/concepts/overview).

## Пример

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
  description: "Проверяет, что агент корректно вызывает инструмент при вопросах о погоде в реальном времени и отвечает на основе его результата",

  async test(t) {
    const turn = await t.send("Какая сегодня погода в Beijing?");
    turn.succeeded();

    await t.group("вызывает get_weather с правильным городом", () => {
      turn.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "Beijing" }) }));
      t.check(turn.message, pattern(/°C|температура|погода|солнечно|облачно|дождь/));
    });

    const second = await t.send("А как насчёт Shanghai завтра?");
    t.check(second.message, includes("Shanghai"));

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
import { webAgent } from "./adapter"; // ваш собственный agent adapter, подключённый к тестируемому web agent

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // запустить только eval-tool-call с experiment local
pnpm exec niceeval view // посмотреть результаты оценки
```

## Быстрый старт

```text
READ https://niceeval.com/INIT.md and set up niceeval for this repo: install it, integrate it with this project, and run the first eval end to end.
```

Начните со своего сценария:

- [Если вам нужно оценить ваш плагин для Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Если вам нужно оценить ваш Skill для Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Если вам нужно оценить ваше AI Agent приложение](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
Официальные адаптеры
- [ ] Agent-приложения
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent-фреймворки
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Документация

- [Быстрый старт](https://niceeval.com/docs/quickstart)

# Благодарности
Этот проект был вдохновлён нижеперечисленными проектами, а также ИИ, изучавшим их код при написании NiceEval:
- [eve](https://eve.dev): основное вдохновение для DX и API
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

Мы благодарим [Linux.do](https://linux.do/) за поддержку и обратную связь на ранних этапах разработки проекта.
