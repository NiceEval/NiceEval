<div align="center">

# NiceEval

**Ein schrittweise einsetzbares, Agent-natives Eval-Tool mit exzellenter DX für leichtgewichtige AI-Agent-Evaluierung**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval ist ein von [eve](https://eve.dev) inspiriertes, universelles Tool zur Evaluierung von Agents. Im Vordergrund steht eine außergewöhnlich gute Developer Experience: In rund 10 Minuten ist jeder startklar und konfiguriert. Gleichzeitig ist das Design bewusst generisch gehalten. Man kann damit Plugins, Hooks und Skills evaluieren, die für Coding Agents wie Claude Code oder Codex geschrieben wurden, ebenso gut wie das eigene AI-Agent-Framework – egal ob es auf dem AI SDK, LangGraph oder Pi basiert, die Anbindung ist unkompliziert.

Nach dem Lauf eines Evals erzeugt NiceEval einen leicht lesbaren Report und lässt sich das Verhalten des Agents im Detail ansehen. Das macht Debugging und das Verstehen von Agent-Verhalten deutlich einfacher.

## Warum braucht es NiceEval, wenn es schon DeepEval, LangFuse und BrainTrust gibt

NiceEval ist ein AI-natives Eval-Tool. In den genannten Tools sind Datasets und Golden-Beispiele mit festen Input/Expected-Output-Paaren aufgebaut – das passt aber nicht wirklich zur Realität von Agent-Evaluierung. Sobald Agents über mehrere Dialogrunden, Multi-Agent-Setups, Tool-Aufrufe und dynamisch geladene Skills evaluiert werden müssen, ist NiceEval für diese feinkörnigen Fälle besser geeignet.

Gleichzeitig schließt NiceEval LangFuse und BrainTrust nicht aus, sondern ergänzt sie: Man kann Erstere für Tracing nutzen oder die Evaluierungsergebnisse an beide hochladen (in Arbeit).

## Architektur

NiceEval unterstützt zwei Anbindungsarten, je nachdem, ob das getestete System eine isolierte Sandbox-Dateisystemumgebung benötigt.

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
   │    │  Codex / Claude Code |   │  │
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
   │   Dein eigener Web Agent   │
   │ (HTTP / AI SDK · LangGraph │
   │ Pi o.ä. eigenes Framework, │
   │     kein Docker nötig)     │
   └────────────────────────────┘
```

- **Der NiceEval-Kern** kümmert sich um das Auffinden von Evals, das Scheduling der Läufe, die Bewertung sowie die Erstellung von Reports und Artefakten.
- **Agent-Adapter** sind die offene Schnittstelle: Du entscheidest, wie das getestete System angesprochen wird.
- Coding Agents, die Dateisystem-Isolation brauchen, laufen über die **Docker-Sandbox**; eigene Web Agents lassen sich direkt anbinden, ganz ohne Docker.

## Beispiel

Um einen Eval auszuführen, braucht es zwei Dateien: den Eval selbst (was wird getestet) und das Experiment (welcher Agent läuft). Die CLI akzeptiert keine nackte Eval-ID – erst das Experiment in `niceeval exp <experiment> <eval-Präfix>` legt fest, „mit welchem getesteten System" gesprochen wird. Hier ein reales Szenario mit direkter Anbindung an einen Web Agent (das vollständige Projekt findet sich unter [`examples/zh/ai-sdk/`](../examples/zh/ai-sdk/)), das prüft, ob der Agent bei Fragen zum aktuellen Wetter ein Tool aufruft und seine Antwort auf dem Tool-Ergebnis aufbaut, statt sie sich auszudenken:

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "Testet, ob der Agent bei Fragen zum aktuellen Wetter korrekt ein Tool aufruft und seine Antwort auf dem Ergebnis aufbaut",

  async test(t) {
    const turn = await t.send("Wie ist das Wetter heute in Beijing?");
    t.succeeded();

    await t.group("ruft get_weather mit der richtigen Stadt auf", () => {
      t.calledTool("get_weather", { input: { city: "Beijing" } });
      t.messageIncludes(/°C|Temperatur|Wetter|sonnig|bewölkt|Regen/);
    });

    const second = await t.send("Wie wird das Wetter morgen in Shanghai?");
    second.messageIncludes("Shanghai");

    t.judge.autoevals
      .closedQA("Stützt sich der Assistent bei seiner Antwort auf die vom Tool gelieferten Wetterdaten, statt sich die Temperatur auszudenken?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // dein selbst geschriebener Agent-Adapter, der den getesteten Web Agent anbindet

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // führt mit dem Experiment "local" nur eval-tool-call aus
pnpm exec niceeval view // zeigt die Evaluierungsergebnisse an
```

## Schnellstart

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

Starte bei deinem konkreten Szenario:

- [Wenn du dein Claude Code / Codex Plugin evaluieren willst](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Wenn du dein Claude Code / Codex Skill evaluieren willst](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Wenn du deine AI-Agent-Anwendung evaluieren willst](https://niceeval.com/docs/example/ai-agent-application)

## Roadmap

Offizielle Adapter

- [ ] Agent-Software
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent-Frameworks
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Dokumentation

- [Schnellstart](https://niceeval.com/docs/quickstart)

# Danksagung

Dieses Projekt wurde von den folgenden Projekten inspiriert, bzw. die KI hat aus deren Code gelernt, um dieses Projekt zu schreiben:
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

Danke an die folgenden Communities
