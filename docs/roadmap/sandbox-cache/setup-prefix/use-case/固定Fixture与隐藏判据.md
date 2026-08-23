# 固定 Fixture 与隐藏判据

## NiceEval-Eval 的起始仓库

固定目录不应藏在 `test(t)` 开头反复上传。Eval 直接把目录 action 写进自己的 Sandbox layer：

```ts
export default defineScoreEval({
  sandbox: sandboxLayer().before(uploadDirectory({
    id: "terminal-bench.regex-log.fixture",
    source: new URL("../../../../fixtures/harness/terminal-bench/regex-log/repo/", import.meta.url),
    to: ".",
    changeFrequency: changeFrequency.rare,
  })),
  async test(t) {
    await t.send("把这次评估跑完，告诉我最终结果。");
  },
});
```

目录内容变化时 manifest digest 自动变化。相同 fixture 与相同祖先前缀可以 restore；候选版本或 Agent `.env` 在后面的 action 变化时，不会重新传输这份 fixture。Eval 仍拥有 action，debug、失败归因和 fingerprint 不把它提升为全局 fixture。

真实上游仓库使用同一种声明，不再自己包装 `defineSandboxCommand()`：

```ts
sandboxLayer().before(gitCheckout({
  id: "db-gpt.fixture",
  repository: "https://github.com/eosphoros-ai/DB-GPT.git",
  ref: "v0.8.1",
  sparse: { exclude: ["docs", "assets"] },
  to: ".",
  changeFrequency: 20,
}));
```

`v0.8.1` 先经 identity lookup 得到完整 commit。缓存身份不依赖 tag 字符串是否看起来固定；tag 被上游移动后会得到新 commit 和新前缀。

## Agent 后才可见的判据

隐藏 tests、runner 与 solution 的内容可以提前登记和去重，但不能进入 Agent 前的 Sandbox 状态。Eval 在模块定义时得到不可变内容 handle，真正传输仍位于 `t.send()` 之后：

```ts
const hiddenTests = sandboxContent.directory(
  new URL("./tests/", import.meta.url),
);

export default defineEval({
  sandbox: sandboxLayer().before(uploadDirectory({
    id: "cancel-async.starting-repo",
    source: new URL("./repo-visible-to-agent/", import.meta.url),
    to: ".",
    changeFrequency: changeFrequency.rare,
  })),
  async test(t) {
    await t.send("实现任务。");
    await t.sandbox.upload(hiddenTests, "task/tests");
    await t.sandbox.runCommand("task/run-tests.sh", []);
  },
});
```

`sandboxContent.directory()` 只登记字节与 digest，不产生 Sandbox action，也不改变可见文件系统。`t.sandbox.upload()` 是 Eval test 中的真实 effect，进入当前 Attempt 的 source manifest 和判据 fingerprint，但不会产生可在 Agent 前恢复的 SetupPrefixKey。

Provider 支持不可变 overlay 时，可以把相同 handle attach 到当前私有 Sandbox；不支持时执行真实传输。两条路径必须产生相同的目标内容与可见时点。NiceEval 不能为了省一次上传而恢复包含隐藏材料的旧快照。

## 边界

| 内容 | 固定的部分 | 实际进入 Sandbox 的时点 |
|---|---|---|
| 起始 fixture | manifest 与完整目录状态 | Agent 前 before action |
| 锁定上游仓库 | repository、lookup 得到的 commit、sparse 选择 | Agent 前 before action |
| 隐藏 tests | 内容 handle 与 digest | `t.send()` 返回后 |
| 动态测试计划 | 当前 Attempt 内生成的字节 | Eval test 当场写入 |
| secret fixture | 非敏感 revision | 私有 callback，不能进入共享前缀 |

“内容固定”只回答能否内容寻址；“何时可见”由生命周期位置决定。二者必须分别进入 debug，不能用 cache hit 推断文件曾对 Agent 可见。
