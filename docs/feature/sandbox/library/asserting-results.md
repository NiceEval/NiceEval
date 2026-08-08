# 断言 Sandbox 结果

作用域断言和结果视图读取 **agent 归因增量**——runner 的变更分类账把每次 `t.send()` 区间内的 workspace 变化归给 agent；起始 fixture 与 agent 跑完后写入的校验材料不在其中（归因契约见 [Architecture · 变更归因](../architecture.md#变更归因send-区间与分类账)）。

```ts
t.sandbox.fileChanged("src/index.ts");
t.sandbox.fileDeleted("src/legacy.ts");
t.sandbox.notInDiff(/console\.log/);
t.sandbox.noFailedShellCommands();

t.check(t.sandbox.diff.get("src/index.ts"), includes("await"));
t.check(t.sandbox.file("package.json"), matches(PackageSchema));
```

| API | 类型 | 用法 |
|---|---|---|
| `fileChanged(path)` | 延迟断言 | 文件在任一 send 区间内被 agent 触及（净效果为零也算发生过；只关心净结果时读 diff 摘要的 `net`） |
| `fileDeleted(path)` | 延迟断言 | 文件在agent diff 中被删除 |
| `notInDiff(re)` | 延迟断言 | agent diff 不含模式 |
| `noFailedShellCommands()` | 延迟断言 | Agent 发起的 shell 工具没有失败退出 |
| `diff.get(path)` | 结果材料 | 该文件在最后一个触及它的 agent 区间结束时的内容；文件不在 agent diff 里返回 `undefined` |
| `diff.isEmpty()` | 结果材料 | 判断agent diff 是否为空 |
| `diff.matches(re)` | 结果材料 | 判断agent diff 是否命中正则 |
| `file(path)` | 延迟材料 | finalize 时读取 Sandbox 文件，交给 matcher |

- `noFailedShellCommands` 只看 Agent 自己发起的 shell 工具，不看 eval 的验证命令。

值 matcher、Severity 与 Verdict 见 [Assertions](../../assertions/README.md)。
