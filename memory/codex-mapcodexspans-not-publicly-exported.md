# codex-mapcodexspans-not-publicly-exported

docs/origin-integration.md 建议黑盒 codex-sdk 接入用内置 codex spanMapper 归一瀑布图,但 mapCodexSpans 当时没有从 "niceeval/adapter" 公开导出,外部/示例包只能省略 spanMapper 走通用 heuristic;现已导出

**现象**:`docs/origin-integration.md` 里 codex-sdk 那一节写"瀑布图经内置 codex mapper
(`spanMapper: mapCodexSpans` 思路)把 span 归一后画图"。真去接 `examples/zh/tier1/codex-sdk`
时,`mapCodexSpans` 实际定义在 `src/o11y/otlp/mappers/codex.ts`,只从
`src/agents/codex.ts`(内置 `codexAgent` 用)内部 import,**没有**出现在
`src/agents/index.ts`(也就是 `"niceeval/adapter"` 子路径导出面)里,`package.json` 的
`exports` 字段当时也只开了 `"."` / `"./sandbox"` / `"./adapter"` / `"./expect"` /
`"./reporters"` / `"./loaders"` 几个子路径——深路径 `import {...} from "niceeval/o11y/otlp/mappers/codex.ts"`
会被 Node 的 `exports` map 直接拒绝解析(`ERR_PACKAGE_PATH_NOT_EXPORTED`),不区分是本仓库
monorepo 内部引用还是外部 `npm install niceeval` 之后的引用——`examples/zh/tier1/*` 走的都是
`"niceeval": "file:../../../.."` + pnpm `overrides: niceeval: link:../../../..`,本质上就是
"当作已发布包来用",一样吃这个限制。

**根因**:`mapCodexSpans` 当时被当成"内置 `codexAgent` 的私有实现细节",没有被设计成公开
API;`docs/origin-integration.md` 写这一节时假设了它可以被黑盒 adapter 复用,但没有对照
`package.json` 的 `exports` 核实这条路径真的可达。

**当时的绕法**:`examples/zh/tier1/codex-sdk/agents/codex-sdk.ts` 的 `tracing` 块正常声明
(`scope: "run"` + `env` 剥掉 `/v1/traces` 尾巴),但**省略 `spanMapper`**——`Agent.spanMapper`
类型注释本来就允许省略("省略时 core 走通用 heuristic 兜底"),core 的通用 heuristic 兜底
接管,瀑布图仍然能画,只是没有 codex 专属的 span 命名归一。

**适用场景(仍然有效的那条方法)**:类似的"文档假设了一个未公开导出的内部符号"问题,以后接
其它需要专属 spanMapper / 内置能力的应用时,先用这个方法核实一遍:`grep` 目标符号是否出现在
`src/agents/index.ts` 或其它 `src/*/index.ts` 的 `export` 列表里,并对照 `package.json` 的
`exports` 确认那个子路径真的开着,而不是直接假设 `docs/` 里写的类名/函数名一定可以从
`"niceeval"` / `"niceeval/adapter"` 导入。

**已修(2026-07)**:`mapCodexSpans` 已从 `"niceeval/adapter"` 公开导出
(`src/agents/index.ts:26`,内置 `codexAgent` 的用法在 `src/agents/codex.ts:129`)。
当前示例落点是 `examples/zh/tier2/codex-sdk/agents/codex-sdk.ts`——
`import { defineAgent, mapCodexSpans, ... } from "niceeval/adapter"`,agent 上声明
`spanMapper: mapCodexSpans`,配 `niceeval.config.ts` 的 `telemetry: { port }`;
`tier1/codex-sdk` 不配 telemetry、不声明 spanMapper(OTel 是 Tier 2 的 delta)。

**同批还记过一条已作废的东西**:当时和公开导出一起落的还有一个官方 `otel.codex` 方言
(从 codex 原生 span 派生工具/usage 事件,写法 `events: otelEvents({dialects:[otel.codex]})`)。
**那套「span 派生 StreamEvent」的 API 后来被整体撤除**(见 `docs-otel-mixin-not-implemented.md`),
`otel.codex` 连同 `otelEvents` 一起消失,**没有等价替代品,别照抄**。现在的契约是 span 只喂
瀑布图、从不产出也不改写事件(`docs/observability.md`);`tier1`/`tier2` 的 codex-sdk 事件断言
都来自 `fromCodexThreadEvents()` 翻 `ThreadEvent` 流,`spanMapper` 纯粹只管 `niceeval view`
的着色分组——这一点 `docs/origin-integration.md:133` / `:186` 现在也是这么写的。
