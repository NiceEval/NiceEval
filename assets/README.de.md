<div align="center">

# NiceEval

**Ein progressives, Agent-natives Eval-Tool für AI Agents mit exzellenter DX**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[English](../README.md) | [中文](../README.zh.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval ist ein Agent-Eval-Tool, das Teams hilft, KI im Produktivbetrieb zu messen, zu bewerten und zu verbessern. Mit NiceEval können Teams Modelle vergleichen, Agents iterieren, Regressionen erkennen und ihre AI-Anwendungen anhand echter Nutzerdaten kontinuierlich verbessern.

NiceEval ist im Kern local-first: Deine Evals laufen in deiner eigenen Umgebung. Wenn dein Team Evals teilen oder Regressionen nachverfolgen muss, kannst du einen Report an Plattformen wie BrainTrust pushen oder einen eigenen Report exportieren.

## Warum braucht es NiceEval, wenn es schon DeepEval, LangFuse und BrainTrust gibt

NiceEval ist ein Agent-natives Eval-Tool. Das Dataset-/Golden-Muster mit festen Input/Expected-Output-Paaren passt nicht zur Realität von Agent-Evaluierung.
Agents müssen heute in feinkörnigen Szenarien evaluiert werden – über mehrere Dialogrunden, in Multi-Agent-Zusammenarbeit, bei Tool-Aufrufen und beim Laden von Skills – und genau das kann NiceEval besser.

Gleichzeitig kann NiceEval mit LangFuse und BrainTrust koexistieren: Man kann sie für Tracing nutzen oder die Evaluierungsergebnisse an beide hochladen.

## Architektur

NiceEval unterstützt zwei Anbindungsarten, je nachdem, ob der getestete Agent ein isoliertes Sandbox-Dateisystem benötigt.

**Modus 1: Sandbox (Docker, E2B) – für Codex, Claude Code und andere Coding Agents, die eine Sandbox brauchen**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agent-Adapter (offiziell)
        ▼
   ┌──────────────────────────────────┐
   │          Docker Sandbox          │
   │    ┌──────────────────────────┐  │
   │    │   Codex / Claude Code    │  │
   │    │ Apps, die ein isoliertes │  │
   │    │   Dateisystem brauchen   │  │
   │    └──────────────────────────┘  │
   └──────────────────────────────────┘
```

**Modus 2: Direktverbindung – direkte Anbindung an deinen eigenen AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agent-Adapter (offiziell oder selbst implementiert)
        ▼
   ┌────────────────────────────┐
   │   Dein eigener AI Agent    │
   │   (AI SDK·LangGraph·Pi)    │
   └────────────────────────────┘
```

- **Der NiceEval-Kern** kümmert sich um das Auffinden von Evals, das Scheduling der Läufe, die Bewertung sowie die Erstellung von Reports und Artefakten.
- **Agent-Adapter** sind die offene Schnittstelle: Du entscheidest, wie das getestete System angesprochen wird.
- Coding Agents, die Dateisystem-Isolation brauchen, laufen über die **Docker-Sandbox**; eigene AI Agents lassen sich direkt anbinden, ganz ohne Docker.

## Kernkonzepte auf einen Blick

| Konzept | In einem Satz |
|---|---|
| Eval | Ein Testfall: geschrieben in `evals/*.eval.ts`, beschreibt, was geprüft wird. |
| Experiment | Eine eincheckbare Laufkonfiguration: welcher Adapter, welches Modell, welche Flags. |
| Adapter | Die Schicht, die das getestete System anbindet: implementiere ein `send`, erhalte einen standardisierten Event-Stream zurück. |
| Sandbox | Nur für Coding Agents nötig, die einen isolierten Arbeitsbereich brauchen; ein direkt angebundener Web Agent braucht keine. |
| Tier | Drei Stufen des Adapter-Integrationsaufwands: Tier 1 bindet nur `send` an, Tier 2 ergänzt OTel für einen Call-Waterfall, Tier 3 nimmt invasive Änderungen für Feature-A/B-Tests vor. |

Das vollständige Glossar findest du in der [Architektur-Übersicht](https://niceeval.com/docs/concepts/overview).

## Beispiel

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
  description: "Testet, ob der Agent bei Fragen zum aktuellen Wetter korrekt ein Tool aufruft und seine Antwort auf dem Ergebnis aufbaut",

  async test(t) {
    const turn = await t.send("Wie ist das Wetter heute in Beijing?");
    turn.succeeded();

    await t.group("ruft get_weather mit der richtigen Stadt auf", () => {
      turn.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "Beijing" }) }));
      t.check(turn.message, pattern(/°C|Temperatur|Wetter|sonnig|bewölkt|Regen/));
    });

    const second = await t.send("Wie wird das Wetter morgen in Shanghai?");
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
import { webAgent } from "./adapter"; // dein selbst geschriebener Agent-Adapter, der den getesteten Web Agent anbindet

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // führt mit dem Experiment "local" nur eval-tool-call aus
pnpm exec niceeval view // zeigt die Evaluierungsergebnisse an
```

## Schnellstart

```text
READ https://niceeval.com/INIT.md and set up niceeval for this repo: install it, integrate it with this project, and run the first eval end to end.
```

Starte bei deinem konkreten Szenario:

- [Wenn du dein Claude Code / Codex Plugin evaluieren willst](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Wenn du dein Claude Code / Codex Skill evaluieren willst](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Wenn du deine AI-Agent-Anwendung evaluieren willst](https://niceeval.com/docs/example/ai-agent-application)

## Roadmap

Offizielle Adapter

- [ ] Agent-Software
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent-Frameworks
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Dokumentation

- [Schnellstart](https://niceeval.com/docs/quickstart)

# Danksagung

Dieses Projekt wurde von den folgenden Projekten inspiriert, bzw. die KI hat aus deren Code gelernt, um dieses Projekt zu schreiben:
- [eve](https://eve.dev): die wichtigste Inspiration für DX und API
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

Wir danken [Linux.do](https://linux.do/) für die Unterstützung und das Feedback während der frühen Entwicklungsphase des Projekts.
