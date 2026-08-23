# 授权选中的动作结果

只有 Judge 必须核对某个公开命令的输出时，才创建 action result View：

```ts
const shown = turn.material.actionResults(
  actionResultSelector.command({
    logicalExecutable: "niceeval",
    argsStart: ["show"],
    lifecycle: "completed",
    exactly: 1,
  }),
);

const check = judge.check({
  recipe: publishedResultMatchesReply,
  material: {
    reply: turn.material.reply,
    shown,
  },
});

t.judge.llm(check).atLeast(0.9).label("公开结果一致");
```

Selector 先在完整 Action universe 上验证恰好一次命中，再只封口该 occurrence 的 result。它不会顺带授权其它命令输出。

若 Adapter 只能提供混合 transcript，无法把 `niceeval show` 的 result 隔离到这一 occurrence，`shown` 为 `result-unisolatable`，Judge 不启动。系统不会退回整包 `toolCalls` 或全部 stdout。

确定性事实仍由普通 Assertion 拥有。例如任务要求生成 regex verifier log，先检查文件确实改变，再把作者显式读取的 bytes 作为 custom file 交给 Judge：

```ts
await t.sandbox.fileChanged("logs/verifier.txt").orStop();

const verifierLog = t.material.customFile({
  name: "verifier-log",
  bytes: await t.sandbox.readBytes("logs/verifier.txt"),
  mediaType: "text/plain",
});
```

`fileChanged` 不由 Judge 猜；`verifierLog` 也不会自动带入产生它的命令或其它工作区文件。
