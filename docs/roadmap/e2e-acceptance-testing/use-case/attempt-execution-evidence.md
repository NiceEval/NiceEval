# Use Case：Attempt 执行证据在 Web 详情完整呈现

## 目标

防止 Attempt 同时具有源码与执行事件时，Report 把 Conversation 当成 Source 的替代项而静默隐藏。
源码回答“运行了哪段评测代码”，对话回答“agent 实际做了什么”；两者必须能够同时出现，不能互相占位。

稳定 Behavior ID 为 `reports.attempt-execution-evidence`。主证明从候选 tarball 导出真实 Report，分别读取
独立 attempt 文档和宿主中的 attempt dialog，不 import Report component、转换器或 artifact reader。

## Behavior

```ts
reportBehavior({
  id: "reports.attempt-execution-evidence",
  task: {
    repository: "niceeval",
    path: "docs/feature/reports/components/attempt-detail/README.md",
    anchor: "证据装配",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/reports/components/attempt-detail/README.md",
    anchor: "执行对话",
  },
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "browser",
      observations: ["html", "browser-a11y"],
      boundaries: ["installed-package", "real-cli", "record-files", "real-browser"],
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "report-attempt-execution-v1",
    },
  },
});
```

Recipe 冻结两个有区分力的 Attempt：

- `source-and-events` 同时具有具名 source 路径、assistant 回复、tool call、tool result 和工具名；
- `source-without-events` 具有 source，但没有发布 events artifact。

两个 Attempt 的 source 形状相同，使测试不能凭 source capability 猜测 events 是否存在。缺失反例必须是
artifact 真正未发布，不使用空数组伪造。

## 完整测试

```ts
reportBehavior(attemptExecutionEvidence, async ({ w, openSite }) => {
  const present = w.target("source-and-events");
  const missing = w.target("source-without-events");

  const presentDoc = await targetDoc(w, present, {
    javaScript: "disabled",
    hosting: "file-url",
  });
  expectObserved(presentDoc.attempt().sourcePaths())
    .toShowRows(["evals/tool-call.eval.ts"]);
  expectObserved(presentDoc.attempt().conversation().entryKinds())
    .toShowRows(["assistant", "tool"]);
  expectObserved(presentDoc.attempt().conversation().toolNames())
    .toShowRows(["get_stock_price"]);
  expectObserved(presentDoc.attempt().executionEvidenceState())
    .toEqualValue("available");

  const missingDoc = await targetDoc(w, missing, {
    javaScript: "disabled",
    hosting: "file-url",
  });
  expectObserved(missingDoc.attempt().sourcePaths())
    .toShowRows(["evals/tool-call.eval.ts"]);
  expectObserved(missingDoc.attempt().executionEvidenceState())
    .toEqualValue("unavailable");
  expectObserved(missingDoc.attempt().calloutTitles())
    .toShowRows(["Execution evidence unavailable"]);

  await using ui = await openSite(w.exportDir("site"), {
    hosting: "clean-url-subpath",
  });
  await ui.targetLink(present).click();
  expectObserved(ui.dialog().attempt().conversation().entryKinds())
    .toShowRows(["assistant", "tool"]);
  expectObserved(ui.dialog().attempt().conversation().toolNames())
    .toShowRows(["get_stock_price"]);
});
```

静态文档证明内容不依赖 enhancement 才出现；dialog 证明同一 evidence 经宿主装配后没有丢失。领域 reader
按公开标题、entry kind 和工具身份读取，不在 Behavior 中出现 class、DOM 位置或 HTML 子串。

## 变更触发路径

| path set | 路径 | 必跑原因 |
|---|---|---|
| `attempt-detail-composition` | `src/report/components/attempt-detail/index.tsx`、`content.tsx`、`src/report/built-in/result-components.tsx` | 决定 Source、Conversation、warning 的装配、互斥与顺序 |
| `conversation-projection` | `src/report/model/conversions.ts`、`types.ts`、`src/report/tasks.ts` 中 conversation 相关定义及其直接拆分文件 | 决定 events 是否成为可显示的轮次、entry 与工具身份 |
| `conversation-renderer` | `src/report/definition/primitives/conversation.tsx` 及直接样式、序列化依赖 | 决定 Web 用户能否读到对话语义 |
| `attempt-page-host` | attempt page 定义、`src/report/runtime/host.ts`、`src/report/runtime/page-render.ts` 及其直接拆分文件 | 决定独立 target 与宿主 dialog 是否消费同一结果 |
| `candidate-package` | `e2e/scripts/injection.ts`、`e2e/scripts/run.ts`、Report build / prune lifecycle 与 `package.json` 发布清单 | 防止工作树正确而候选包仍携带旧 Report runtime |

`src/report/components/attempt-detail/compute.ts`、`validate.tsx` 只有改变 conversation 输入或校验契约时触发，
不因同目录而无条件纳入。Source、Diff、Timeline 自身的渲染改动走各自 Behavior；events 的生产路径先走
artifact / adapter proof，只有改变落盘 events 契约或 conversation projection 时才追加本 Behavior。

共享文件按导出符号与 TypeScript import graph 扩一跳匹配。删除、移动和重命名同时匹配 Git diff 的新旧路径。

## 旧 bug kill 与定位

保留 `5a4d01a9^` 的最小逆补丁：当 source capability 与 `evalSource` 同时存在时，把
`toConversationTurns(evidence)` 或 `attemptConversationContent(...)` 替换为 `null`。这条 mutation 必须在
`outcome` 阶段失败，并报告 locator、source 状态、events artifact 状态、期望与实际 entry kind、target URL、
候选包 digest、HTML evidence 和截图。

- Report 无法导出、target 无法打开或进程非零属于 `invoke`；
- target 可打开但 reader 无法形成 attempt / conversation 领域对象属于 `observe`；
- source 可见而 Conversation 缺失、工具身份错误，或缺 events 时未显示 warning 属于 `outcome`。

只断 `niceeval show --execution`、组件 snapshot、页面存在或 dialog 能打开都不能替代本 proof。

## 频率

上述硬触发 path set 变化时每个 PR 必跑；发布 tag 在候选 tarball 上重跑。fixture、导出、HTTP 与 Chromium
均为本地确定性资源，不需要模型、网络或 secret。
