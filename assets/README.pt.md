<div align="center">

# NiceEval

**Uma ferramenta leve, progressiva e Agent Native para avaliação de agentes de IA, com DX excelente**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md)

</div>

O NiceEval é uma ferramenta de avaliação de agentes de propósito geral, inspirada no [eve](https://eve.dev). Antes de mais nada, tem um design de DX excelente: qualquer pessoa consegue começar e configurar em cerca de 10 minutos. Além disso, seu design é extremamente genérico — pode ser usado tanto para avaliar plugins, Hooks e Skills de coding agents escritos para Claude Code/Codex, quanto para avaliar diretamente o seu próprio framework de AI Agent (seja baseado em AI SDK, LangGraph ou Pi, a integração é simples).

Depois que a eval termina, é gerado um relatório fácil de ler, com os detalhes do comportamento do agente à disposição para consulta. Isso facilita o debug e a compreensão do comportamento do agente.

## Por que usar o NiceEval quando já existem DeepEval, LangFuse e BrainTrust

O NiceEval é uma ferramenta de avaliação AI Native. Nessas outras ferramentas, construir Datasets e goldens a partir de Input e Expected Output não é adequado para a avaliação real de agentes. Além disso, quando um agente precisa ser avaliado em granularidade fina — múltiplas rodadas de conversa com o usuário, múltiplos agentes, chamadas de ferramentas, carregamento de Skills, entre outros — o NiceEval consegue fazer isso melhor.

Ao mesmo tempo, o NiceEval pode coexistir com o LangFuse e o BrainTrust. Você pode usar o primeiro para fazer tracing, ou enviar os resultados da avaliação para ambos (em desenvolvimento).

## Arquitetura

O NiceEval suporta duas formas de integração, dependendo se o sistema sob teste precisa de um sistema de arquivos isolado em sandbox.

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
   ┌───────────────────────────────┐
   │        Docker Sandbox         │
   │    ┌───────────────────────┐  │
   │    │ Codex / Claude Code | │  │
   │    │ apps que precisam de  │  │
   │    │  sistema de arquivos  │  │
   │    │        isolado        │  │
   │    └───────────────────────┘  │
   └───────────────────────────────┘
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
   ┌──────────────────────────┐
   │  Seu próprio Web Agent   │
   │ (HTTP / AI SDK·LangGraph │
   │  Pi ou outro framework   │
   │   próprio, sem Docker)   │
   └──────────────────────────┘
```

- O **núcleo do NiceEval** é responsável por descobrir evals, agendar execuções, pontuar, gerar relatórios e artifacts.
- O **Adaptador de Agent** é a fronteira aberta: você decide como chamar o sistema sob teste.
- Coding agents que precisam de isolamento de sistema de arquivos passam pelo **Docker Sandbox**; Web Agents próprios podem se conectar diretamente, sem precisar de Docker.


## Exemplo

Para rodar uma eval são necessários dois arquivos: a eval em si (o que testar) e o experiment (qual agent rodar). A CLI não aceita um eval id isolado — em `niceeval exp <experiment> <prefixo-da-eval>`, é o experiment que decide "a qual sistema sob teste se conectar". Abaixo está um cenário real de conexão direta a um Web Agent (o projeto completo está em [`examples/zh/ai-sdk/`](../examples/zh/ai-sdk/)), que verifica se o agent chama a ferramenta correta ao receber uma pergunta sobre o clima em tempo real, e se responde com base no resultado da ferramenta em vez de inventar a resposta:

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "Testa se o agent chama a ferramenta correta para perguntas sobre o clima em tempo real e responde com base no resultado",

  async test(t) {
    const turn = await t.send("Como está o tempo em Beijing hoje?");
    t.succeeded();

    await t.group("Chama get_weather com a cidade correta", () => {
      t.calledTool("get_weather", { input: { city: "Beijing" } });
      t.messageIncludes(/°C|temperatura|tempo|ensolarado|nublado|chuva/);
    });

    const second = await t.send("Como estará o tempo em Shanghai amanhã?");
    second.messageIncludes("Shanghai");

    t.judge.autoevals
      .closedQA("O assistente respondeu com base nos dados de clima retornados pela ferramenta, em vez de inventar a temperatura?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // seu próprio agent adapter, conectando ao web agent sob teste

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // roda apenas eval-tool-call usando o experiment local
pnpm exec niceeval view // visualiza os resultados da avaliação
```

## Começo rápido

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

Comece pelo seu cenário:

- [Se você precisa avaliar seu plugin do Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Se você precisa avaliar sua Skill do Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Se você precisa avaliar sua aplicação de AI Agent](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
Adaptadores oficiais
- [ ] Software de Agent
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Frameworks de Agent
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentação

- [Começo rápido](https://niceeval.com/docs/quickstart)

# Agradecimentos
Este projeto foi inspirado pelos projetos abaixo, ou teve trechos de código escritos pela IA a partir do aprendizado com eles
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

Agradecimentos às seguintes comunidades
</content>
</invoke>
