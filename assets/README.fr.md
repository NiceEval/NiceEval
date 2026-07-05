<div align="center">

# NiceEval

**Un outil d'évaluation d'agents IA léger, progressif, Agent Native et à l'expérience développeur soignée**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval est un outil d'évaluation d'agents généraliste inspiré par [eve](https://eve.dev). Il mise avant tout sur une expérience développeur (DX) exceptionnelle : n'importe qui peut le prendre en main et le configurer en une dizaine de minutes. Sa conception est également très générique : on peut aussi bien évaluer un plugin, un Hook ou un Skill écrit pour un coding agent comme Claude Code ou Codex, que brancher directement votre propre framework d'agent IA (qu'il soit basé sur l'AI SDK, LangGraph, Pi, ou tout autre framework maison).

Une fois l'évaluation terminée, NiceEval génère un rapport lisible et permet d'examiner en détail le comportement de l'agent, ce qui facilite grandement le débogage et la compréhension du comportement des agents.

## Pourquoi NiceEval alors qu'il existe déjà DeepEval, LangFuse ou BrainTrust

NiceEval est un outil d'évaluation pensé « AI Native ». Dans ces autres outils, la construction de datasets et de golden avec des paires Input/Expected Output ne convient pas vraiment à l'évaluation d'agents réels. Par ailleurs, lorsqu'il s'agit d'évaluer finement des conversations multi-tours, des systèmes multi-agents, des appels d'outils ou du chargement de Skills, NiceEval fait mieux.

NiceEval cohabite très bien avec LangFuse et BrainTrust : vous pouvez continuer à utiliser ces derniers pour le tracing, ou envoyer vos résultats d'évaluation vers l'un ou l'autre (fonctionnalité en cours de développement).

## Architecture

NiceEval propose deux modes de connexion, selon que le système testé a besoin ou non d'un système de fichiers isolé dans un sandbox.

**Mode 1 : Sandbox (Docker, E2B) — pour exécuter des coding agents comme Codex ou Claude Code qui nécessitent un sandbox**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptateur Agent (officiel)
        ▼
   ┌─────────────────────────────────┐
   │         Docker Sandbox          │
   │    ┌─────────────────────────┐  │
   │    │  Codex / Claude Code |  │  │
   │    │ Application nécessitant │  │
   │    │ un système de fichiers  │  │
   │    │          isolé          │  │
   │    └─────────────────────────┘  │
   └─────────────────────────────────┘
```

**Mode 2 : Connexion directe — connectez-vous directement à votre propre agent IA**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptateur Agent (officiel, ou implémenté par vous-même)
        ▼
   ┌────────────────────────────┐
   │   Votre propre Web Agent   │
   │ (HTTP / AI SDK · LangGraph │
   │ Pi ou tout autre framework │
   │    maison, sans Docker)    │
   └────────────────────────────┘
```

- Le **cœur de NiceEval** se charge de découvrir les evals, d'orchestrer leur exécution, de les noter, et de générer rapports et artifacts.
- L'**adaptateur Agent** est une frontière ouverte : c'est vous qui décidez comment appeler le système testé.
- Les coding agents nécessitant une isolation du système de fichiers passent par le **Docker Sandbox** ; votre propre Web Agent peut se connecter directement, sans Docker.

## Exemple

Exécuter un eval nécessite deux fichiers : l'eval en lui-même (ce qu'on teste) et une experiment (quel agent exécuter). Le CLI n'accepte pas un id d'eval nu : c'est l'experiment dans `niceeval exp <experiment> <préfixe d'eval>` qui détermine « à quel système testé on se connecte ». Voici un cas concret de connexion directe à un Web Agent (projet complet disponible dans [`examples/zh/ai-sdk/`](../examples/zh/ai-sdk/)), qui vérifie que l'agent appelle bien un outil face à une question sur la météo en temps réel, et répond en se basant sur le résultat de l'outil plutôt que d'inventer une réponse :

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "Vérifie que l'agent appelle correctement l'outil et répond à partir du résultat pour une question météo en temps réel",

  async test(t) {
    const turn = await t.send("Quel temps fait-il aujourd'hui à Beijing ?");
    t.succeeded();

    await t.group("Appelle get_weather avec la bonne ville", () => {
      t.calledTool("get_weather", { input: { city: "Beijing" } });
      t.messageIncludes(/°C|ensoleillé|nuageux|pluie|température/);
    });

    const second = await t.send("Et demain à Shanghai ?");
    second.messageIncludes("Shanghai");

    t.judge.autoevals
      .closedQA("L'assistant répond-il à partir des données météo renvoyées par l'outil, plutôt que d'inventer une température ?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // Votre adaptateur maison, connecté au web agent testé

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // Exécute uniquement eval-tool-call avec l'experiment local
pnpm exec niceeval view // Consulte les résultats de l'évaluation
```

## Démarrage rapide

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

Partez de votre propre scénario :

- [Si vous devez évaluer votre plugin Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Si vous devez évaluer votre Skill Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Si vous devez évaluer votre application d'agent IA](https://niceeval.com/docs/example/ai-agent-application)

## Feuille de route

Adaptateurs officiels

- [ ] Logiciels agents
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Frameworks d'agents
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentation

- [Démarrage rapide](https://niceeval.com/docs/quickstart)

# Remerciements

Ce projet s'inspire des projets suivants, ou a été écrit par une IA après avoir étudié leur code
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

Merci aux communautés suivantes
