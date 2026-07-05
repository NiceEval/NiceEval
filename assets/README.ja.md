<div align="center">

# NiceEval

**段階的に導入できる、Agent Nativeで優れたDXを持つ軽量なAIエージェントeval(評価)ツール**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEvalは[eve](https://eve.dev)にインスパイアされた汎用的なagent eval(評価)ツールです。まず何よりも優れたDX(開発者体験)を重視して設計されており、誰でも10分程度でセットアップして使い始められます。そして設計そのものが非常に汎用的です。Claude CodeやCodexといったcoding agent向けに書かれたプラグイン、Hook、Skillを評価することもできますし、自分自身のAIエージェントフレームワーク(AI SDK、LangGraph、Piなど、どれをベースにしていても簡単に接続できます)を直接評価することもできます。

evalの実行が終わると、読みやすいレポートを生成し、Agentの挙動を細部まで確認できます。これによりデバッグやAgentの挙動理解が格段に楽になります。

## DeepEval、LangFuse、BrainTrustがあるのに、なぜNiceEvalが必要なのか

NiceEvalはAI Nativeなeval(評価)ツールです。既存のツールではDatasetやgoldenを使ってInputとExpected Outputを構築しますが、これは実際のAgent評価にはあまり適していません。加えて、現在のAgentは複数ターンにわたるユーザーとの対話、マルチAgent構成、ツール呼び出し、Skillの動的ロードなど、きめ細かい粒度での評価が求められています。NiceEvalはこうしたケースをより上手く扱えます。

同時に、NiceEvalはLangFuseやBrainTrustとも共存できます。前者をtracingに使いながら、評価結果を両方にアップロードする(実装中)、といった使い方も可能です。

## アーキテクチャ

NiceEvalは、テスト対象のシステムが隔離されたサンドボックスファイルシステムを必要とするかどうかに応じて、2種類の接続方式をサポートします。

**モード1: Sandbox(Docker、E2B) —— Codex、Claude CodeなどsandboxがひつようなCoding Agentを動かす**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agentアダプター(公式)
        ▼
   ┌────────────────────────────────────┐
   │           Docker Sandbox           │
   │    ┌────────────────────────────┐  │
   │    │   Codex / Claude Code |    │  │
   │    │ 隔離されたファイルシステム │  │
   │    │     を必要とするアプリ     │  │
   │    └────────────────────────────┘  │
   └────────────────────────────────────┘
```

**モード2: 直接接続 —— 自分自身のAIエージェントに直接接続する**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agentアダプター(公式、または自作)
        ▼
   ┌────────────────────────────┐
   │    自分自身のWeb Agent     │
   │ (HTTP / AI SDK・LangGraph  │
   │ Piなど独自フレームワーク、 │
   │       Dockerは不要)        │
   └────────────────────────────┘
```

- **NiceEvalコア**はevalの発見、実行のスケジューリング、採点、レポートとartifactsの生成を担います。
- **Agentアダプター**はオープンな境界です。テスト対象システムをどう呼び出すかは開発者側で決められます。
- ファイルシステムの隔離が必要なcoding agentは**Docker Sandbox**経由で動かし、自作のWeb Agentは直接接続でき、Dockerは不要です。

## サンプル

evalを1件実行するには2つのファイルが必要です。eval自体(何をテストするか)とexperiment(どのagentを動かすか)です。CLIは裸のeval idを受け付けません——`niceeval exp <experiment> <evalのプレフィックス>`のexperimentこそが「どのテスト対象に接続するか」を決める場所です。以下は、Web Agentに直接接続する実際のシナリオです(完全なプロジェクトは[`examples/zh/ai-sdk/`](../examples/zh/ai-sdk/)を参照)。リアルタイムの天気に関する質問を受けたときに、agentがツールを呼び出し、でたらめに答えを作るのではなく、ツールの結果に基づいて回答することを検証します。

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "agentがリアルタイムの天気に関する質問で正しくツールを呼び出し、その結果に基づいて回答できるかをテストする",

  async test(t) {
    const turn = await t.send("北京の今日の天気はどうですか？");
    t.succeeded();

    await t.group("get_weatherを正しい都市名で呼び出す", () => {
      t.calledTool("get_weather", { input: { city: "北京" } });
      t.messageIncludes(/°C|気温|天気|晴れ|曇り|雨/);
    });

    const second = await t.send("上海の明日の天気はどうですか?");
    second.messageIncludes("上海");

    t.judge.autoevals
      .closedQA("アシスタントは気温をでたらめに作るのではなく、ツールが返した天気データに基づいて回答しているか？")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // 自分で書いたagent adapter。テスト対象のweb agentに接続する

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // local experimentでeval-tool-callだけを実行する
pnpm exec niceeval view // 評価結果を確認する
```

## クイックスタート

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

自分のシナリオから始めましょう。

- [Claude Code / CodexのプラグインをEvalしたい場合](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Claude Code / CodexのSkillをEvalしたい場合](https://niceeval.com/docs/example/claude-code-codex-skill)
- [自分のAIエージェントアプリケーションをEvalしたい場合](https://niceeval.com/docs/example/ai-agent-application)

## Roadmap

公式アダプター

- [ ] Agentソフトウェア
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agentフレームワーク
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
  - [ ] vm0
  - [ ] Cursor Agent SDK

## ドキュメント

- [クイックスタート](https://niceeval.com/docs/quickstart)

# 謝辞

このプロジェクトは以下のプロジェクトにインスパイアされている、あるいはAIが以下のプロジェクトのコードから学んで書かれています。
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

以下のコミュニティに感謝します
