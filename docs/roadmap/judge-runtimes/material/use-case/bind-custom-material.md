# 绑定自定义与参考材料

Execution 中动态产生的说明或文件要在 seal 前显式快照：

```ts
const note = t.material.customText({
  name: "review-note",
  text: "只检查公开 CLI 输出。",
});

const report = t.material.customFile({
  name: "public-report",
  bytes: await t.sandbox.readBytes("report.txt"),
  mediaType: "text/plain",
});

const check = judge.check({
  recipe: reportQuality,
  material: { note, report },
});
```

构造器不接受 path 或对象。读取 bytes 的时点就是 Execution source 的快照时点；稍后改写 `report.txt` 不会改变这份 View。

评分定义自带的事实资料使用 reference 构造器：

```ts
const policy = g.material.referenceFile({
  name: "support-policy",
  source: new URL("./support-policy.md", import.meta.url),
  mediaType: "text/markdown",
});
```

它在当前 GradingDefinition 求值时由受管 loader 读取并校验 digest，不回到历史 workspace 找同名文件。短 reference 使用 `g.material.referenceText(...)`；`g.material.customText(...)` 只表示定义期 context，不能伪装成 expected answer。

作者若把 `JSON.stringify(turn.toolCalls)` 传给 `customText`，系统会照字面视为一次显式 overgrant，并在 manifest 标成 custom source。私有品牌 API 阻止的是隐式展开和误传对象，不承诺反驳可信作者主动复制的内容。

`name` 只显示在作者审计面，不会成为 LLM heading 或 Agent filename；evaluator 收到的稳定标识来自 recipe slot 与 ordinal。
