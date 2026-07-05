---
name: optional-peer-deps-raw-ts-consumer-typecheck
description: niceeval 发布裸 .ts 源码——主入口图里任何可静态解析到可选 peer 依赖的引用(含 typeof import 与字面量动态 import)都会拖垮未装该依赖的下游 typecheck;修法是独立子路径导出,绝不从主入口 re-export
metadata:
  type: infra-bug
---

**现象**:下游项目只用 `claudeCodeAgent`/`codexAgent`、从没碰 `aiSdkAgent` 的 tracing,`tsc` 也报
三个 TS2307(`@ai-sdk/otel`、`@opentelemetry/sdk-trace-node`、`@opentelemetry/exporter-trace-otlp-http`
找不到)。`link:../fastevals` 下不复现——本仓库 devDependencies 经符号链接泄漏进去了,npm 包形态才炸。

**根因**:niceeval 发布的是裸 `.ts` 源码(`types` 指向 `src/index.ts`),消费者的 tsc 把 src 当自己
的程序检查,`skipLibCheck` 完全不适用(它只豁免 `.d.ts`)。于是主入口模块图里任何能被 tsc 静态解析
的引用都会把目标文件拖进消费者的检查范围:

- `typeof import("./ai-sdk-otel.ts")` 即便只在类型位置,tsc 也要解析该文件来算类型;
- 字面量参数的动态 `import("./ai-sdk-otel.ts")` 同样被静态解析,不管返回值怎么 typed;
- 目标文件顶部 import 的三个可选 OTel 包必须已装,否则 TS2307。

曾用「把 specifier 放进 const 变量再传给 import()」骗过 tsc(fc5a4e1),能用但是 hack:类型契约
断裂(手写 interface 和真实导出没有编译期绑定)、bundler 同样看不见该文件、依赖 tsc 未成文行为。

**修法**:把可选依赖的集成拆成独立子路径导出(`niceeval/adapter/otel` → `src/agents/ai-sdk-otel.ts`),
主入口只留中立的形状接口(`AiSdkTracing`),用户显式 `import { aiSdkOtel } from "niceeval/adapter/otel"`
传 `tracing: aiSdkOtel()`。类型依赖方向只能是 otel 文件 import 主文件的类型,反向绝不 re-export——
否则问题原样回来。0.2.0 起生效;`tracing: boolean` 与 `otlpBackendUrl` 已删(beta 期直接 break,
不留兼容分支)。以后给任何可选 peer 依赖加集成(其他 SDK、observability 后端)都走这个模式。
