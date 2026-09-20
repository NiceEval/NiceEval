---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 迁移旧 Judge 配置

项目使用普通对象配置 Judge，升级后在项目加载阶段收到 `migration-required`。
目标是按错误现场的位置和随包指南替换这一处配置，不改 rubric、材料或质量门。

## 复现可识别的旧形状

```ts title="niceeval.config.ts"
import { defineConfig } from "niceeval";

export default defineConfig({
  judgeRuntime: {
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
  },
});
```

运行原有命令。CLI 在创建 Invocation、执行 setup 或发出 Provider 请求前拒绝该形状，
显示 `judge-provider` guide ID、`defineConfig.judgeRuntime` subject 与用户源码位置。
如果同一指南命中多处，反馈先列出已收集位置，再输出一次完整英文指南。

## 应用替代写法

```ts title="niceeval.config.ts"
import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: OpenAIProvider({
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
  }),
});
```

再次运行相同命令。项目加载应继续，真实 Judge Assertion 才会校验 endpoint、凭据和响应协议。
使用 Vercel AI Gateway、OpenRouter 或 TypeSafe System One 时，只替换为对应的具名 Provider 工厂。

迁移错误对象、位置和指南的单源见 [Library](../library.md#位置与迁移错误)；
终端顺序和非零退出见 [CLI](../cli.md#迁移反馈)。Judge 的 Provider 选择与配置优先级见
[Judge Library](../../judge/library.md#runtime-配置)。
