# Bug 组：外部命令成功必须由公开状态回读闭合

这一组用 native plugin marketplace 注册名作正例，用 Codex 已安装版本的真实 JSON 形状作反证。
两条都证明：外部 CLI exit 0 只说明命令被接受，不能证明调用方假定的身份已经成立。

## 正例：marketplace add 成功，却注册成另一个名字

真实 Claude Code / Codex CLI 从仓库 manifest 读取 marketplace 名，调用方不能用配置给它取别名。
旧实现却在 `marketplace add` exit 0 后直接用配置中的 `marketplace.name` 拼下一条安装命令。
结果是 add 成功，plugin install 才以“找不到 marketplace”间接失败，错误没有告诉用户实际注册名。

memory 在 2026-07-13 记录该缺口时它尚未修复；后续 fix commit `5e7549eb` 已为 Claude Code 与
Codex 都加入 add 后 `marketplace list --json` 回读：配置名与实际注册名不一致时立即抛出包含两者的
错误，且不继续安装 plugin。该提交增加了 mismatch、回读命令失败和未知 JSON 形状的 fake
sandbox 单测，但真实 CLI 的身份闭包仍应由已有 native-plugin consumer world 证明。

```ts
adapterBehavior(marketplaceIdentityIsReadBack, async () => {
  const w = world();
  const result = await cli("pnpm exec niceeval exp native-plugin-wrong-name --rerun all --json", {
    cwd: w.consumerDir("codex-native-plugin-wrong-name"),
    expect: "nonzero",
  });

  expectObserved(result.stderrText())
    .toMatchScrubbedFileSnapshot("golden/marketplace-name-mismatch.txt");
});
```

fixture 复用真实仓库与 pinned ref，只在隔离 consumer world 的 agent 配置里保留一个故意错误的
公开 `marketplace.name`；不改被测 Eval。golden 只锁 expected / actual 两个名字和失败阶段，
不锁 CLI 的附带措辞。

## 同形反证：安装成功，版本却从 manifest 静默消失

fix commit `07416e68` 前，`installedVersion()` 猜测
`codex plugin list --json` 的顶层直接是数组或 `{ plugins: [...] }`，并按 `id` 查找。
真实 Codex CLI 0.144.1 返回 `{ installed: [...] }`，身份字段是 `pluginId`；因此任何真实安装的
`resolvedVersion` 都稳定为 `undefined`。

原单测用 canned response 精确证明了错误猜测内部自洽。真实 native-plugin E2E 的既有 Eval gate
`equals("1.3.2")` 才首先失败；它又连带触发了 `brief(undefined)` 的 TypeError，暴露断言设施在
实际值缺失时不能正常展示的问题。同一 fix 把解析改到真实形状，并给 `brief()` 增加
`JSON.stringify(value) ?? String(value)` 字符串失败回退和单元回归。

用户侧不需要一个新的 `pluginVersion()` DSL：继续运行既有 native-plugin Eval，并从公开结果读取
原 gate 即可。验收器只负责把失败保留为普通 assertion failure，而不是让预览器二次崩溃。

```ts
const w = world();
const run = await cli("pnpm exec niceeval exp native-plugin --rerun all --json", {
  cwd: w.consumerDir("codex-native-plugin"),
});

expectObserved(run.exitCode()).toEqualValue(0);
expectObserved(ndjsonEvents(run.stdout).attempt("native-plugin-installed").verdict())
  .toEqualValue("passed");
```

一个真实 consumer world 因而同时守住两层：安装后身份必须回读，回读到的版本必须穿过公开
agent-setup 结果到达原 Eval gate。fake CLI shape 只留在 parser contract case，不再冒充主证明。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | pinned repo / ref / plugin identity 固定；不锁安装日志顺序和无关字段 |
| 不能改断言放行 | expected marketplace 名来自用户配置，actual 来自真实 CLI；版本期望来自 pinned plugin manifest，不能从候选结果回抄 |
| 观察失败显式报错 | add、readback、identity mismatch、plugin install、Eval gate 分阶段失败；`undefined` 仍可正常预览 |
| 用户侧直接定位 | mismatch 同时列配置名、实际名、CLI 和 consumer world；版本失败列 plugin id、期望 ref 与 locator |
| 设施不造假 | 隔离真实 CLI home/config；不以 fake sandbox canned JSON 代替主 proof |
| 用户已有用法不改 | 原 agent 配置形态与 native-plugin Eval 不变；错误名只属于验收 recipe 的负例 world |
