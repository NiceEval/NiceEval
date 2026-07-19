---
name: codex-cli-otel-tool-span-callid-not-in-json-protocol
description: "codex CLI 0.144.1 的 `--json` 事件流里 command_execution/apply_patch 等 item 只有 item.id(如 item_3),从不带 call_id;其原生 OTel span 的 exec_command/apply_patch 关联键恰恰是另一套 call_id(如 call_cBGsEAQ8I9da8AuwndfivwNv,OpenAI Responses API 风格);两边没有共同字段,niceeval 现有『call_id 精确匹配』的关联策略对 codex CLI 的工具级 span 结构性地永远关联不上——这不是选错字段,是协议本身没暴露可用于关联的字段;真机验证到此为止,是否/如何解决未定,留待裁决"
metadata:
  type: infra-bug
---

**现象**:`e2e/repos/codex-cli` 的 docs 契约(docs/engineering/e2e-ci/adapters/codex-cli.md
「仓库验收」)写"OTel:...执行树的时间注释就是记录成立的展示证明"、"`show --timing` 的 OTel
子树以 tool/model 角色挂出 span"。真机跑 `coding-task` Eval(2 次 shell 调用 + 1 次文件编辑,
`niceeval.config.ts` 已配 `dockerSandbox()` 默认镜像 + agent 的 `tracing.configure` 写入
`config.toml` 的 `[otel]` 块,exporter 指向真实 OTLP HTTP 端点)后:

- `show <locator> --execution`:3 个 TOOL 节点(2 个 command_execution、1 个 file_change)
  全部没有内联时间注释(渲染层只在 `node.span` 存在时才加 `meta` 时间片段,见
  `src/show/render.ts` 的 `executionNodeLines`),尾部提示 `"39 unlinked telemetry spans
  omitted; inspect the OTel trace for framework timing."`——真实收到了 39 条 span,一条都没
  关联上骨架节点。
- `show <locator> --timing`(含 `--timing=full`):`eval.run` 下的 `turn s1/t1  14.4s` 是
  叶子节点,没有任何嵌套 OTel 子树(既没有工具 span,也没有 model 采样 span)。

**根因(已用真实 codex CLI 复现到字段级)**:

1. `.niceeval/.../coding-task/a1/events.json`(niceeval 解析后的 canonical 事件)显示
   `command_execution`/`file_change` 的 `callId` 分别是 `"item_3"`、`"item_4"`、`"item_6#0"`——
   来自 `src/o11y/parsers/codex.ts` 的 `baseId = item.id`(即 `codex exec --json` 每个 item 自带
   的 `id` 字段)。
2. 直接在宿主机跑 `codex exec --json`(同一个 0.144.1 版本,隔离 `CODEX_HOME`)、原样抓取
   stdout(不经过 niceeval 解析),`command_execution` 的 `item.started`/`item.completed` 事件
   完整字段是 `{"id":"item_3","type":"command_execution","command":"...","aggregated_output":
   "...","exit_code":0,"status":"completed"}`——**没有 `call_id` 字段**,这是 codex CLI
   `--json` 协议的公开、完整形状,不是 niceeval 解析时把它丢了。
3. 但同一次 attempt 的 `trace.json`(真实 OTel 导出)里,`exec_command`/`apply_patch` 这两类
   span 的 attributes 里确实有 `call_id`,值形如 `call_cBGsEAQ8I9da8AuwndfivwNv`——这是 codex
   (Rust)进程内部对 OpenAI Responses API 的 function-call 调用做自己的可观测性时用的内部
   标识符,只在 OTel export 里暴露,`--json` 协议从不透传它。

`src/o11y/execution-tree.ts` 的关联策略是"span.attributes.call_id 或 gen_ai.tool.call.id 与
骨架节点的 callId 精确相等才算数,不按名字/时间猜"(该文件头注明确写了这条设计取舍)。
对 codex CLI 而言,骨架节点的 callId(`item_N`)和 span 的 call_id(`call_XXX`)是两套完全
独立、互不重叠的标识符空间——协议层面就没有共同字段可用于精确关联,现有策略对 codex CLI
的工具级 span 结构性地永远关联不上,不是"关联逻辑读错了字段"这种可以照抄 codex-sdk 修法
解决的问题(codex-sdk 走的是 `@openai/codex-sdk` 的 Thread 对象,不是 `--json` 协议,是否
存在同样的 gap 未验证,不能类推)。

**当前 verify.ts 的两条 tracing 断言为什么"通过"但没有验证到位**:

- `!execution.includes("timing unavailable")`——这个字符串只在 `tree.timingAvailable === false`
  (整个 attempt 零 telemetry)时才出现;本例收到了 39 条 span(只是零关联),
  `timingAvailable` 仍是 `true`,所以这条断言通过,但它只证明"这次 attempt 收到过一些
  telemetry",不证明"某个具体工具调用的 span 关联上了"。
- `/shell|file_edit/i.test(timing)`——`--timing` 输出里确实匹配得到 `"shell"`(如
  `"shell · git init -q ..."`），但那是 **runner 自己的基础设施步骤**(workspace baseline、
  agent setup 里的 `npm install`/写 config.toml 等 shell 命令),不是 agent 在 `turn s1/t1`
  下调用的 OTel 工具 span——这条正则命中的是无关的巧合子串,不是文档承诺的"OTel 子树以
  tool/model 角色挂出 span"。

**这次没有做的事,以及为什么**:没有据此修改 `src/o11y/execution-tree.ts` 的关联策略,也没有
放宽 `docs/engineering/e2e-ci/adapters/codex-cli.md` 的 tracing 契约,也没有把
`verify.ts` 的两条 tracing 断言改造成会真实失败的"诚实"版本——三者都是设计/契约层决定
(要不要在 codex CLI 场景放弃 call_id 精确关联、改成本文件开头提到的"窗口兜底归属"或干脆
承认 codex-cli 的工具级 timing 不可得、比照 `docs/feature/eval/README.md` 或
`e2e/repos/codex-sdk` 用 `"timing unavailable"` 明确声明"本仓库不声明 tracing 面"),不是
"完成脚手架"这个任务范围内该单方面拍板的事,只记录复现证据留待评审裁决。

**适用场景**:任何评审 codex-cli(built-in `codexAgent`)tracing/OTel 覆盖是否名副其实的场合;
任何考虑给 `execution-tree.ts` 增加除 call_id 精确匹配外的关联路径(如按 turn 时间窗口兜底,
类似本文件头注提到的 `otlp/turn-otel.ts` window-attribution 思路,但那是"这批 span 属于哪一轮"
而非"这条 span 属于哪个工具调用",两者正交,不能直接复用来解决本条问题)的场合。
