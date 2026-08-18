<div align="center">

# NiceEval

**Uma ferramenta de evals para agentes de IA progressiva, Agent-Native e com DX excelente**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md)

</div>

O NiceEval é uma ferramenta de avaliação de agents que ajuda as equipes a medir, avaliar e melhorar a IA em produção. Com o NiceEval, as equipes podem comparar modelos, iterar sobre agents, detectar regressões e continuar melhorando suas aplicações de IA usando dados reais de usuários.

O NiceEval é local-first em sua essência: suas evals rodam no seu próprio ambiente. Quando sua equipe precisar compartilhar evals ou rastrear regressões, você pode enviar um Report para plataformas como o BrainTrust, ou exportar um relatório personalizado.

## Por que usar o NiceEval quando já existem DeepEval, LangFuse e BrainTrust
O NiceEval é uma ferramenta de avaliação Agent-Native. O padrão de Dataset / golden — construir Input e Expected Output — não é adequado para a avaliação real de agents.
Hoje, os agents precisam ser avaliados em cenários de granularidade fina — múltiplas rodadas de conversa, colaboração entre múltiplos agents, chamadas de ferramentas, carregamento de Skills — e o NiceEval faz isso melhor.

Ao mesmo tempo, o NiceEval também coexiste com o LangFuse e o BrainTrust: você pode usá-los para fazer tracing, ou enviar os resultados da avaliação para ambos.

## Arquitetura

O NiceEval suporta duas formas de integração, dependendo se o agent sob teste precisa de um sistema de arquivos isolado em sandbox.

**Modo 1: Sandbox (Docker, E2B) — para rodar coding agents como Codex e Claude Code, que precisam de sandbox**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptador de Agent (oficial)
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox        │
   │   ┌────────────────────────┐ │
   │   │ Codex / Claude Code    │ │
   │   │ apps que precisam de   │ │
   │   │ um sistema de arquivos │ │
   │   │ isolado                │ │
   │   └────────────────────────┘ │
   └──────────────────────────────┘
```

**Modo 2: Conexão direta — conecte diretamente ao seu próprio AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptador de Agent (oficial, ou implementado por você)
        ▼
   ┌──────────────────────────────┐
   │     Seu próprio AI Agent     │
   │    (AI SDK·LangGraph·Pi)     │
   └──────────────────────────────┘
```

- O **núcleo do NiceEval** é responsável por descobrir evals, agendar execuções, pontuar, gerar relatórios e artifacts.
- O **Adaptador de Agent** é a fronteira aberta: você decide como chamar o sistema sob teste.
- Coding agents que precisam de isolamento de sistema de arquivos passam pelo **Docker Sandbox**; o seu próprio AI Agent pode se conectar diretamente, sem precisar de Docker.

## Principais conceitos em resumo

| Conceito | Em uma frase |
|---|---|
| Eval | Um caso de teste: escrito em `evals/*.eval.ts`, descrevendo o que verificar. |
| Experiment | Uma configuração de execução versionada: qual Adapter, qual model, quais flags. |
| Adapter | A camada que conecta ao sistema sob teste: implemente um `send` e receba de volta um fluxo de eventos padrão. |
| Sandbox | Necessário apenas para coding agents que exigem um workspace isolado; um web agent conectado diretamente não precisa disso. |
| Tier | Três níveis de esforço de integração do Adapter: o Tier 1 conecta apenas o `send`, o Tier 2 adiciona OTel para obter um waterfall de chamadas, o Tier 3 faz mudanças invasivas para testes A/B de features. |

Veja o glossário completo na [visão geral da arquitetura](https://niceeval.com/docs/concepts/overview).

## Exemplo

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";
import { includes, jsonMatch, pattern, toolMatch } from "niceeval/expect";

export default defineEval({
  judge: true,
  description: "Testa se o agent chama a ferramenta correta para perguntas sobre o clima em tempo real e responde com base no resultado",

  async test(t) {
    const turn = await t.send("Como está o tempo em Beijing hoje?");
    turn.succeeded();

    await t.group("Chama get_weather com a cidade correta", () => {
      turn.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "Beijing" }) }));
      t.check(turn.message, pattern(/°C|temperatura|tempo|ensolarado|nublado|chuva/));
    });

    const second = await t.send("Como estará o tempo em Shanghai amanhã?");
    t.check(second.message, includes("Shanghai"));

    turn.judge.autoevals
      .closedQA("O assistente respondeu com base nos dados de clima retornados pela ferramenta, em vez de inventar a temperatura?")
      .gate(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // seu próprio agent adapter, conectando ao web agent sob teste

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // roda apenas eval-tool-call usando o experiment local
pnpm exec niceeval view // visualiza os resultados da avaliação
```

## Começo rápido

```text
READ https://niceeval.com/INIT.md and set up niceeval for this repo: install it, integrate it with this project, and run the first eval end to end.
```

Comece pelo seu cenário:

- [Se você precisa avaliar seu plugin do Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Se você precisa avaliar sua Skill do Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Se você precisa avaliar sua aplicação de AI Agent](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
Adaptadores oficiais
- [ ] Software de Agent
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Frameworks de Agent
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentação

- [Começo rápido](https://niceeval.com/docs/quickstart)

# Agradecimentos
Este projeto foi inspirado pelos projetos abaixo, ou teve trechos de código escritos pela IA a partir do aprendizado com eles
- [eve](https://eve.dev): a principal inspiração de DX e API
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

Agradecimentos às seguintes comunidades
- WIP

Também agradecemos à Linux Do pelo apoio e feedback durante os estágios iniciais do desenvolvimento do projeto.
