# view 工具出入参「看不到」是渲染层丢的,不是 adapter / 官方 SDK 的问题

## 现象

1. 代码视图里 claude-sdk 的 HITL eval(`hitl-approve`),send 行下的 `mcp__demo-tools__calculate` 只有工具名,入参、出参都没有;ai-sdk-v7 的 `get_weather` 有出参但没有入参。
2. `calledTool(...)` 等断言在 view 里展开只有名字和「通过」徽章,看不到命中调用的出入参,排查「为什么过 / 为什么没过」要去翻原始事件流。

第一反应容易怀疑是 adapter 在 send 时没解析好,或官方 SDK 不吐数据 —— **都不是**。用真实工件核实:`examples/zh/tier1/claude-sdk/.niceeval/.../hitl-approve/.../events.json` 里 `action.called` 带完整 `input: {"expression":"(23+19)*3"}`、`action.result` 带 `output: "126"`。事件流契约(Tier 1:出入参全部由 send 解析进事件流,OTel 只管瀑布图)被 adapter 正确履行了,丢失全在下游。

## 根因

三处独立的下游丢失:

1. **入参白名单**:`src/view/app/lib/transcript-data.tsx` 的 `toolPrimaryArg` 只认 `path`/`query`/`url`/`command` 等通用 key,领域工具的参数(`expression`、`city`…)一个都不认,返回空串 → 入参静默不渲染。
2. **跨轮配对**:旧 `indexTurns` 只在**当前轮**的 replies 里按 callId 找 `action.called` 来挂 `action.result`。HITL 下 called 在 send 轮、result 要到 respond 轮(approve 之后)才到,跨轮配不上 → 出参整个丢弃。
3. **断言无 evidence**:`src/scoring/scoped.ts` 的 `calledTool` / `toolOrder` / `noFailedActions` 等只返回 0/1,`AssertionResult.evidence` 恒空,view 想显示也没材料。

## 修法

- `indexTurns` 用**跨轮共享**的 `callId → tool reply` Map 配对结果;同时把 `input.requested` 也收进 replies(审批请求可见)。
- `toolPrimaryArg` 白名单未命中时兜底显示入参的紧凑 JSON(截断 200 字符)。
- CodeView 的工具行直接复用 Transcript 的 `ToolBlock`(可展开看完整出入参),不再维护第二套只有单行摘要的渲染。
- 作用域断言返回 `EvalScore` 带 evidence:命中给命中调用的出入参;没命中给同名近失调用;再没有列全部实际调用。`messageIncludes` 失败时带实际被扫的 assistant 文本(与 `t.check` 口径一致)。
- 改了 `src/view/app/` 记得 `pnpm run view:build` 重建 client-dist;旧结果重新 `niceeval view` 即可生效,不用重跑 eval。

**排查此类问题的顺序**:先 `cat` 对应 run 的 `events.json` 看事件流里有没有数据,再定位是 adapter(事件缺)还是 view / 断言层(事件在但没显示)。别一上来就怀疑 adapter。
