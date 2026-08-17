<div align="center">

# NiceEval

**段階的に導入できる、Agent Nativeで優れたDXを持つAIエージェントeval(評価)ツール**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEvalは、本番環境のAIを計測・評価・改善するためのagent evalツールです。NiceEvalを使えば、モデルを比較し、agentを反復改善し、リグレッションを検知し、実際のユーザーデータを使ってAIアプリケーションを継続的に改善できます。

NiceEvalはローカルファーストを核としています。evalは自分自身の環境で実行されます。チームでevalを共有したりリグレッションを追跡したりする必要がある場合は、ReportをBrainTrustなどのプラットフォームにpushしたり、カスタムレポートとしてエクスポートしたりできます。

## DeepEval、LangFuse、BrainTrustがあるのに、なぜNiceEvalが必要なのか
NiceEvalはAgent-Nativeな評価ツールです。Dataset / goldenの「InputとExpected Outputを構築する」というパターンは、実際のAgent評価には適していません。
現在のAgentは、複数ターンの対話、マルチAgent協調、ツール呼び出し、Skillのロードといったきめ細かいシナリオで評価される必要があり、NiceEvalはそれをより上手くこなせます。

同時に、NiceEvalはLangFuseやBrainTrustとも共存できます。それらをtracingに使ったり、評価結果を両者にアップロードしたりできます。

## アーキテクチャ

NiceEvalは、テスト対象のagentが隔離されたサンドボックスファイルシステムを必要とするかどうかに応じて、2種類の接続方式をサポートします。

**モード1: Sandbox(Docker、E2B) —— Codex、Claude Codeなどsandboxが必要なcoding agentを動かす**

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
   ┌──────────────────────────────────────────┐
   │              Docker Sandbox              │
   │  ┌────────────────────────────────────┐  │
   │  │ Codex / Claude Code                │  │
   │  │ 隔離ファイルシステムが必要なアプリ │  │
   │  └────────────────────────────────────┘  │
   └──────────────────────────────────────────┘
```

**モード2: 直接接続 —— 自分自身のAI Agentに直接接続する**

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
   ┌──────────────────────────────┐
   │      自分自身のAI Agent      │
   │     (AI SDK·LangGraph·Pi)    │
   └──────────────────────────────┘
```

- **NiceEvalコア**はevalの発見、実行のスケジューリング、採点、レポートとartifactsの生成を担います。
- **Agentアダプター**はオープンな境界です。テスト対象システムをどう呼び出すかは開発者側で決められます。
- ファイルシステムの隔離が必要なcoding agentは**Docker Sandbox**経由で動かし、自分自身のAI Agentは直接接続でき、Dockerは不要です。

## コアコンセプト一覧

| コンセプト | 一言で言うと |
|---|---|
| Eval | テストケース。`evals/*.eval.ts`に書き、何を検証するかを記述する。 |
| Experiment | チェックインできる実行設定。どのAdapterに接続し、どのモデルを使い、どんなflagsを指定するかを決める。 |
| Adapter | テスト対象システムに接続する層。`send`を1つ実装すれば、標準化されたイベントストリームが返ってくる。 |
| Sandbox | 隔離されたワークスペースが必要なcoding agentにのみ必要。直接接続するweb agentには不要。 |
| Tier | Adapter統合にかける工数の3段階。Tier 1は`send`だけを繋ぐ、Tier 2は呼び出しのウォーターフォールを見るためにOTelを追加する、Tier 3はfeature A/Bテストのために踏み込んだ変更を行う。 |

完全な用語集は[アーキテクチャ概要](https://niceeval.com/docs/concepts/overview)を参照してください。

## サンプル

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
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // local experimentでeval-tool-callだけを実行する
pnpm exec niceeval view // 評価結果を確認する
```

## クイックスタート

```text
READ https://niceeval.com/INIT.md and set up niceeval for this repo: install it, integrate it with this project, and run the first eval end to end.
```

自分のシナリオから始めましょう。

- [Claude Code / CodexのプラグインをEvalしたい場合](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Claude Code / CodexのSkillをEvalしたい場合](https://niceeval.com/docs/example/claude-code-codex-skill)
- [自分のAIエージェントアプリケーションをEvalしたい場合](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
公式アダプター
- [ ] Agentソフトウェア
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agentフレームワーク
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## ドキュメント

- [クイックスタート](https://niceeval.com/docs/quickstart)

# 謝辞
このプロジェクトは以下のプロジェクトにインスパイアされている、あるいはAIが以下のプロジェクトのコードから学んで書かれています。
- [eve](https://eve.dev): 主にDXとAPIのインスピレーション元
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

以下のコミュニティに感謝します
- WIP

また、プロジェクトの開発初期にサポートとフィードバックを提供してくださった Linux Do に感謝します。
