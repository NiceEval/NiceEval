import { defineExperiment } from "niceeval";
import { bubAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

// 上一代 tape 协议的版本线。ci.ts 跑 NiceEval 当前默认钉的 Bub;这条跑往回钉一代的组合,
// 证明 `version` / `otelPlugin` 这对旋钮真的能把 Adapter 落到旧协议上,而不只是类型上可写。
//
// 插件必须跟着版本一起往回钉:Bub 0.3.10 起 vendor 了 `bub.tape`,bub-contrib#50 之后的插件
// 从那里取类型;配 0.3.9 会 import 失败。反过来 #50 之前的插件按 republic 的类型校验,配新版
// Bub 则是 span 全被拒、时间轨静默为空(契约见 feature/adapters/sdk/bub/README.md)。
const LEGACY_OTEL_PLUGIN =
  "git+https://github.com/bubbuild/bub-contrib.git@7967e5e74c4b6cfc6f75981461691a2f8d863496#subdirectory=packages/bub-tapestore-otel";

export default defineExperiment({
  description: "bub:往回钉一代(0.3.9 + 同代 OTel 插件)仍跑通协议路径与时间轨",
  agent: bubAgent({
    version: "0.3.9",
    otelPlugin: LEGACY_OTEL_PLUGIN,
  }),
  // 只跑 coding-task 一条:版本线是新增的覆盖维度,不是新增的协议行为
  // (预算见 docs/engineering/testing/e2e/adapter/README.md「仓库 Eval 预算」),
  // 其余行为已由 ci.ts 在默认版本上证明。共享契约的四条不进版本线。
  model: "gpt-5.6-luna",
  sandbox,
  attempts: 1,
  evals: ["coding-task/write-and-verify"],
});
