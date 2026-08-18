<div align="center">

# NiceEval

**Un outil d'évaluation d'agents IA progressif, Agent Native et à l'expérience développeur soignée**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval est un outil d'évaluation d'agents qui aide les équipes à mesurer, évaluer et améliorer l'IA en production. Avec NiceEval, les équipes peuvent comparer des modèles, itérer sur leurs agents, détecter les régressions et continuer à améliorer leurs applications IA en s'appuyant sur des données réelles issues des utilisateurs.

NiceEval est conçu autour du principe local-first : vos évaluations s'exécutent dans votre propre environnement. Quand votre équipe a besoin de partager ses évaluations ou de suivre des régressions, vous pouvez pousser un Report vers des plateformes comme BrainTrust, ou exporter un rapport personnalisé.

## Pourquoi NiceEval alors qu'il existe déjà DeepEval, LangFuse ou BrainTrust

NiceEval est un outil d'évaluation Agent-Native. Le schéma dataset / golden qui consiste à « construire des paires Input / Expected Output » ne convient pas à l'évaluation d'agents réels.
Les agents d'aujourd'hui doivent être évalués dans des scénarios à grain fin — conversations multi-tours, collaboration multi-agents, appels d'outils, chargement de Skills — et c'est là que NiceEval fait mieux.

Par ailleurs, NiceEval cohabite très bien avec LangFuse et BrainTrust : vous pouvez les utiliser pour le tracing, ou envoyer vos résultats d'évaluation vers les deux.

## Architecture

NiceEval propose deux modes de connexion, selon que l'agent testé a besoin ou non d'un système de fichiers isolé dans un sandbox.

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
   ┌────────────────────────────────────────────┐
   │               Docker Sandbox               │
   │   ┌────────────────────────────────────┐   │
   │   │ Codex / Claude Code                │   │
   │   │ Application nécessitant un système │   │
   │   │ de fichiers isolé                  │   │
   │   └────────────────────────────────────┘   │
   └────────────────────────────────────────────┘
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
   ┌───────────────────────────┐
   │   Votre propre agent IA   │
   │   (AI SDK·LangGraph·Pi)   │
   └───────────────────────────┘
```

- Le **cœur de NiceEval** se charge de découvrir les evals, d'orchestrer leur exécution, de les noter, et de générer rapports et artifacts.
- L'**adaptateur Agent** est une frontière ouverte : c'est vous qui décidez comment appeler le système testé.
- Les coding agents nécessitant une isolation du système de fichiers passent par le **Docker Sandbox** ; votre propre agent IA peut se connecter directement, sans Docker.

## Concepts clés en un coup d'œil

| Concept | En une phrase |
|---|---|
| Eval | Un cas de test : écrit dans `evals/*.eval.ts`, décrit ce qu'il faut vérifier. |
| Experiment | Une configuration d'exécution versionnée : quel Adapter, quel modèle, quels flags. |
| Adapter | La couche qui se connecte au système testé : implémentez un seul `send`, récupérez en retour un flux d'événements standard. |
| Sandbox | Nécessaire uniquement pour les coding agents qui exigent un espace de travail isolé ; un web agent connecté directement n'en a pas besoin. |
| Tier | Trois niveaux d'effort d'intégration d'un Adapter : le Tier 1 ne branche que `send`, le Tier 2 ajoute OTel pour obtenir une cascade d'appels (waterfall), le Tier 3 apporte des modifications invasives pour faire de l'A/B testing de fonctionnalités. |

Retrouvez le glossaire complet dans l'[aperçu de l'architecture](https://niceeval.com/docs/concepts/overview).

## Exemple

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";
import { includes, jsonMatch, pattern, toolMatch } from "niceeval/expect";

export default defineEval({
  judge: true,
  description: "Vérifie que l'agent appelle correctement l'outil et répond à partir du résultat pour une question météo en temps réel",

  async test(t) {
    const turn = await t.send("Quel temps fait-il aujourd'hui à Beijing ?");
    turn.succeeded();

    await t.group("Appelle get_weather avec la bonne ville", () => {
      turn.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "Beijing" }) }));
      t.check(turn.message, pattern(/°C|ensoleillé|nuageux|pluie|température/));
    });

    const second = await t.send("Et demain à Shanghai ?");
    t.check(second.message, includes("Shanghai"));

    turn.judge.autoevals
      .closedQA("L'assistant répond-il à partir des données météo renvoyées par l'outil, plutôt que d'inventer une température ?")
      .gate(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // Votre adaptateur maison, connecté au web agent testé

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // Exécute uniquement eval-tool-call avec l'experiment local
pnpm exec niceeval view // Consulte les résultats de l'évaluation
```

## Démarrage rapide

```text
READ https://niceeval.com/INIT.md and set up niceeval for this repo: install it, integrate it with this project, and run the first eval end to end.
```

Partez de votre propre scénario :

- [Si vous devez évaluer votre plugin Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Si vous devez évaluer votre Skill Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Si vous devez évaluer votre application d'agent IA](https://niceeval.com/docs/example/ai-agent-application)

## Feuille de route

Adaptateurs officiels

- [ ] Logiciels agents
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Frameworks d'agents
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentation

- [Démarrage rapide](https://niceeval.com/docs/quickstart)

# Remerciements

Ce projet s'inspire des projets suivants, ou a été écrit par une IA après avoir étudié leur code
- [eve](https://eve.dev) : la principale source d'inspiration pour la DX et l'API
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

Merci aux communautés suivantes
- WIP

Nous remercions également Linux Do pour son soutien et ses retours durant les premières étapes du développement du projet.
