# Fixture 内容 action

本地 fixture 使用 `uploadFile()` 或 `uploadDirectory()` 直接形成 before action。一次声明同时给出内容输入、目标、action identity 与 `changeFrequency`，不要求作者先登记 handle 再包装 command。

```ts
export default defineEval({
  sandbox: sandboxLayer().before(uploadDirectory({
    id: "starter-repo",
    source: new URL("./fixtures/starter/", import.meta.url),
    to: "/app",
    changeFrequency: changeFrequency.rare,
  })),
  async test(t) {
    await t.send("完成 /app 中的任务。");
  },
});
```

内容 manifest digest、目标、action id、频率与祖先前缀共同形成 identity。内容变化自动产生新前缀；相同内容可以由 Provider restore。

隐藏判据不使用 Agent 前 before action。它通过 `sandboxContent.file()` / `sandboxContent.directory()` 登记不可变字节，再在 `t.send()` 返回后的 Eval test 中调用 `t.sandbox.upload()`。内容去重不能改变可见时点。

## 入口

- [Library](library.md) —— 签名、示例与内容 handle。
- [Architecture](architecture.md) —— planning、identity、恢复与隐藏材料边界。
- [准备前缀缓存](../../sandbox-cache/setup-prefix/README.md) —— action 排序与 Provider 能力。
