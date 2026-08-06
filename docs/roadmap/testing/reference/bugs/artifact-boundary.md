# Bug 组：payload 边界要证明策略，不能只证明写得出来

这一组用超大工具输出把一个 attempt 放大到 159 MB 作正例，用管道 JSON 不得截断作反证。
二者都跨序列化边界，但所需策略相反：持久化 artifact 允许按契约有标记地截断，机器输出管道必须完整交付。

## 正例：51 MB 字符串在 artifact 中落了三遍

真实记录里一次递归 grep 扫入 minified bundle，单行最长 4.2 MB。
同一 51 MB 输出进入 event 一次、trace attributes 两次，最终 `events.json` 53 MB、`trace.json` 106 MB。

fix commit `5e7549eb` 把截断放在 writer 的序列化边界：运行时断言仍看全量值；`events` / `trace` 的超限字符串落盘时保留前 256 KiB，并附人读 marker 与结构化 `truncated { path, originalBytes }`。
同一 commit 还给发布复制增加 50 MiB 单文件预检，要求先规划、后写入，超限不能留下半成品。

fix 前 writer roundtrip 测试只使用极小 event / trace，能证明 JSON 写入和读回。
它没有任何体积边界；`5e7549eb` 本身也没有新增一个超大 event / trace 的区分力测试。
后续 `fa33b1ec` 为新加入的 commands artifact 增加过大值测试，但 commands 策略后来又在 `9b7ebc1f` 改为全量落盘。
这段历史证明按 artifact 名复制测试会随 registry 漂移，不能充当总守护。

## 最早应失败的两层

结构 / 单元层应由证据 registry 驱动同一组 contract cases：

- 标为“逐值截断”的 artifact：多字节超限值写入后可解析，`originalBytes` 正确，path 指向被截字段，未超限邻居不变。
- 标为“全量”的 artifact：读回逐字节相等，不出现伪造 marker。
- 运行时评分仍收到完整值，截断只在 writer 边界发生。
- 发布前预算失败时目标目录保持未创建或为空，不能留下可被误发布的半份站点。

用户侧只保留一条跨层 smoke，复用原 Eval 和公开 `show --json`：

```ts
recordBehavior(largeEvidenceIsBoundedWithoutChangingTheVerdict, async () => {
  const run = await cli("pnpm exec niceeval exp oversized-output --rerun all --json");
  const locator = ndjsonEvents(run.stdout).latestAttemptLocator("oversized-output");
  const shown = jsonSummary((await cli(`pnpm exec niceeval show ${locator} --json`)).stdout);

  expectObserved(shown.attempt(locator).verdict()).toEqualValue("passed");
  expectObserved(shown.attempt(locator).truncations())
    .toShowRows([{ artifact: "events", path: "output", originalBytes: { greaterThan: 262144 } }]);
});
```

`truncations()` 是本轮新增的最小领域查询。
它只读取公开的结构化标记，不扫描 marker 文案，也不要求用户打开磁盘路径；底层仍是已有 `jsonSummary()`，不是新的进程或 world 原语。

## 同形反证：不是所有边界都能截断

`show --json` 的 pipe bug 证明“给大值设上限”不能成为通用测试策略。
机器出口没有声明有损语义，所以 `jsonSummary()` 必须成功解析整份输出；一旦截断，observe 阶段立即失败。

可复用抽象不是 `payloadUnder256KiB()`，而是每个公开边界声明三件事：完整、有损且带证明、或整体拒绝。
contract case 按声明选断言，测试作者不能从当前文件大小反推策略。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 上限与适用 artifact 来自 registry；普通小值不受影响 |
| 不能改断言放行 | `originalBytes` 来自输入，判定仍由完整尾部事实决定；不能把阈值改成实际文件大小 |
| 观察失败显式报错 | JSON 不可解析、缺结构化标记、path 不存在分别在 observe 报错 |
| 用户侧直接定位 | 列 locator、artifact、path、原始字节、保留字节与可复制 show 命令 |
| 设施不造假 | fixture 含多字节和超长单行；按字节而非字符计；不只检查文件小于某值 |
| 用户已有用法不改 | 既有 Eval 与断言仍看全量；proof 只从公开 JSON 读回 |
