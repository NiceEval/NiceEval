# 不支持的 Git repository 输入

V1 刻意只接受匿名公共 HTTPS repository 与完整 40 位 SHA-1 commit：

```ts
// 错误：浮动 branch
checkout({
  repository: "https://github.com/acme/project.git",
  commit: "main",
});

// 错误：URL 携带凭据
checkout({
  repository: "https://token@github.com/acme/private.git",
  commit: "3f7c1f9a03e70cc13eaa9bdb7db891f26f74a836",
});
```

这类输入在 link 阶段失败，因此不会发网络请求、写 cache 或创建 Sandbox。
branch/tag 会变化，private repository 又需要凭据撤权和缓存分区模型；在这些契约定稿前，NiceEval 不静默退化成 Sandbox 内完整 clone。
