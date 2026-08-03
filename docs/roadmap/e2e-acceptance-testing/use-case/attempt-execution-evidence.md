# Use Case：Attempt 执行证据在 Web 详情完整呈现

## 目标

防止 Attempt 虽然包含源码与执行事件，但用户展开源码中的 drive 调用时仍看不到该调用返回的执行过程。
源码回答“哪一次 API 调用驱动了 agent”，行内返回回答“这次调用实际返回了什么”；两者必须按调用身份闭合。
把完整 Conversation 放在页面末尾只能证明数据存在，不能证明用户点击入口成立。

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

- `source-and-events` 在同一源码文件包含两次 `t.send`；两轮分别具有不同 assistant 回复、tool call、tool result
  和工具名，使错误挂接无法通过；
- `source-without-events` 具有 source，但没有发布 events artifact。

两个 Attempt 的 source 形状相同，使测试不能凭 source capability 猜测 events 是否存在。缺失反例必须是
artifact 真正未发布，不使用空数组伪造。

## 完整测试

```ts
reportBehavior(attemptExecutionEvidence, async ({ w, openSite }) => {
  const present = w.target("source-and-events");
  const missing = w.target("source-without-events");

  const missingDoc = await targetDoc(w, missing, {
    javaScript: "disabled",
    hosting: "file-url",
  });
  expectObserved(missingDoc.attempt().source().paths())
    .toShowRows(["evals/tool-call.eval.ts"]);
  expectObserved(missingDoc.attempt().executionEvidenceState())
    .toEqualValue("unavailable");
  expectObserved(missingDoc.attempt().calloutTitles())
    .toShowRows(["Execution evidence unavailable"]);

  await using ui = await openSite(w.exportDir("site"), {
    hosting: "clean-url-subpath",
  });
  await ui.targetLink(present).click();
  const source = ui.dialog().attempt().source();
  const stock = source.driveCall({
    api: "t.send",
    path: "evals/tool-call.eval.ts",
    occurrence: 1,
  });
  const email = source.driveCall({
    api: "t.send",
    path: "evals/tool-call.eval.ts",
    occurrence: 2,
  });

  await stock.expand();
  expectObserved(stock.returned().entryKinds())
    .toShowRows(["assistant", "tool"]);
  expectObserved(stock.returned().toolNames())
    .toShowRows(["get_stock_price"]);
  expectObserved(stock.returned().toolNames())
    .not.toShowRows(["send_email"]);

  await email.expand();
  expectObserved(email.returned().toolNames())
    .toShowRows(["send_email"]);
  expectObserved(ui.dialog().attempt().unmappedConversation().entryKinds())
    .toShowExactRows([]);
});
```

静态文档只证明缺失 events 的降级内容不依赖 enhancement。主正例必须执行真实点击：领域 reader 按公开
drive API、源码路径、发生序与返回类型寻址，不按气泡 class、DOM 位置、内部 suite/test 坐标或轮标签寻址。
`occurrence` 是同一源码调用表达式的运行发生序，不是内部 session / turn 编号。

## 变更触发路径

| path set | 路径 | 必跑原因 |
|---|---|---|
| `attempt-detail-composition` | `src/report/components/attempt-detail/index.tsx`、`content.tsx`、`src/report/built-in/result-components.tsx` | 决定 Source、行内返回、unmapped Conversation、warning 的装配与去重 |
| `source-return-renderer` | `src/report/definition/primitives/source-view.tsx` 及直接样式、序列化依赖 | 决定 drive / assertion 调用能否展开，并把对应返回显示在调用作用域内 |
| `conversation-projection` | `src/report/model/conversions.ts`、`types.ts`、`src/report/tasks.ts` 中 conversation 相关定义及其直接拆分文件 | 决定 events 是否成为可显示的轮次、entry 与工具身份 |
| `conversation-renderer` | `src/report/definition/primitives/conversation.tsx` 及直接样式、序列化依赖 | 决定 Web 用户能否读到对话语义 |
| `attempt-page-host` | attempt page 定义、`src/report/runtime/host.ts`、`src/report/runtime/page-render.ts` 及其直接拆分文件 | 决定独立 target 与宿主 dialog 是否消费同一结果 |
| `candidate-package` | `e2e/scripts/injection.ts`、`e2e/scripts/run.ts`、Report build / prune lifecycle 与 `package.json` 发布清单 | 防止工作树正确而候选包仍携带旧 Report runtime |

`src/report/components/attempt-detail/compute.ts`、`validate.tsx` 只有改变 conversation 输入或校验契约时触发，
不因同目录而无条件纳入。Source、Diff、Timeline 自身的渲染改动走各自 Behavior；events 的生产路径先走
artifact / adapter proof，只有改变落盘 events 契约或 conversation projection 时才追加本 Behavior。

共享文件按导出符号与 TypeScript import graph 扩一跳匹配。删除、移动和重命名同时匹配 Git diff 的新旧路径。

## 旧 bug kill 与定位

保留两条 mutation：

1. `5a4d01a9^`：source 存在时把 Conversation 变成 `null`；
2. 行内断线：events 仍完整写入页面，但全部追加到 Attempt 末尾，send 展开区只留 status / duration 摘要。

两条都必须在 `outcome` 阶段失败。第二条失败报告必须给出 drive API、源码路径、occurrence、点击 action、
返回区实际 entry kind、页面级 unmapped 内容、target URL、候选包 digest、HTML evidence 和截图。

- Report 无法导出、target 无法打开或进程非零属于 `invoke`；
- target 可打开但 reader 无法形成 attempt / conversation 领域对象属于 `observe`；
- 点击成功但对应 drive 返回区缺 execution、轮次错挂、页面尾部重复已映射轮次，或缺 events 时未显示 warning
  属于 `outcome`。

只断 `niceeval show --execution`、HTML 某处包含 events、组件 snapshot、页面存在或 dialog 能打开都不能替代本 proof。

## 频率

上述硬触发 path set 变化时每个 PR 必跑；发布 tag 在候选 tarball 上重跑。fixture、导出、HTTP 与 Chromium
均为本地确定性资源，不需要模型、网络或 secret。
