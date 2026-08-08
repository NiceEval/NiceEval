# Bug 组：成功退出必须交付可消费的输出

这一组用 view 对零可读结果导出空站作正例，用 `show --json` 管道截断作同形反证。
一条输出在语义上为空，另一条输出在字节上不完整；共同错误是 producer 退出 0，而下游拿不到可消费结果。

## 正例：空报告以 0 覆写线上站点

fix commit `70df7880` 前，只要 `.niceeval/` 目录存在，`niceeval view --out site` 即使零可读结果也会导出空报告并退出 0。
真实事故场景是 25 份旧 schema 数据全部被跳过，CI 仍把空站当成功构建发布。

公开错误事实是成功码与交付物语义冲突：view 的输入选择为空时不能宣告“站点已生成”。
当时 `loadViewScan` 只在显式 `--report` 时校验零结果；位置前缀和 experiment 不匹配也已有错误，唯独不带选项的 view 漏了整库为空这一格。

fix 新增的测试直接调用 `loadViewScan()`，涵盖真空和全部 skipped 两种数据。
它证明选择层会抛错，却没有走真实 CLI、`--out` 和进程退出；最窄用户侧 proof 仍有价值：

```ts
reportBehavior(emptyRecordCannotProduceASuccessfulSite, async () => {
  const w = world("all-records-unreadable");
  const run = await cli(`pnpm exec niceeval view ${w.resultsRoot} --out ${w.exportDir("empty")}`, {
    expect: "nonzero",
  });

  expectObserved(stderrView(run.stderr).skippedRunReasons())
    .toShowRows(["incompatible-version", "malformed"]);
});
```

proof 不需要断整句英文，也不创建一个“空页面应不存在”的 DOM matcher。
非零退出已经阻止部署；错误读面只负责证明用户能从 skipped 身份定位原因。

## 同形反证：JSON 有输出但不可消费

`d8d5a84b` 修复的 pipe 截断同样以 0 退出，并且 stdout 非空；只断“生成了文件”或“stdout 有字节”都会假绿。
第 1 轮的 `jsonSummary()` 会先做结构读取，空站案例则由结果集合读面判断语义为空。

两条案例收敛成一条规则：成功不是某个文件存在，而是声明的用户读面能构造成功并满足最小非空契约。
这条规则复用 `cli()` 与已有读面，不新增原语。

## 六项检查

| 检查 | 判断 |
|---|---|
| 契约不变不误红 | 有至少一个可读 experiment 就允许导出；不锁页面布局或数据数量 |
| 不能改断言放行 | 零可读结果的期望固定为非零；不能改成“目录存在” |
| 观察失败显式报错 | skipped 明细读取失败在 observe 报错，不当成空数组 |
| 用户侧直接定位 | 消息含命令、结果根、每个 skipped run 的原因和 stderr |
| 设施不造假 | world 真含不兼容 / malformed 数据；不 mock `loadViewScan` |
| 用户已有用法不改 | 复用原本的 `niceeval view --out` 发布命令 |
