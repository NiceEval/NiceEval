# E2E case 关系

本篇是 E2E case 与产品契约关联的唯一契约。测试正文仍由
[E2E 测试正文](authoring.md)约束；候选注入与执行仍由[本地与 CI](execution.md)约束。

## Case 与产品契约

真实测试声明上方直接写一个仓库相对路径：

```ts
// @feature docs/feature/inspection/README.md
test("query run 经 pipe 交付完整文档", async () => {})
```

精确验证一个 Use Case 时改用 `// @use-case docs/feature/<feature>/use-case/<name>.md`。
`@feature` 必须指向 Feature 包根的 `docs/feature/<name>/README.md`，不能指向包内子页面（如 `docs/feature/adapters/library/README.md`）
或 `use-case/` 下的文件；`@use-case` 必须指向一个 leaf Use Case 文件。路径不合法时 Trace 编译以格式错误拒绝。

每个声明恰好一个 Feature 或 Use Case；多个测试可以关联同一契约。标题只描述用户结果。
关系沿 `case → contract` 推导，不从目录、文件名或标题猜测，也不经 testing owner anchor 中转。

回归测试在同一标记块加 `@issue docs/issues/<id>.md`；退役关系使用 `// @status retired`。

## 历史归档

`e2e/concord-history.ts` 只含迁移前的历史与退役注释，不保存第二份 current registry。
`@concord-history` 保存原始事件，`@concord-tombstone` 保存退役事件。迁移前的原始事件保存在 `docs/migrations/case-history-before-path-annotations.txt`。
历史事件与 receipts 保留原始字节，
不通过改写旧引用或补字段把旧证据转换成当前证明。

## 命令

标记生成、发现、执行与修复核验按 `concord --skill test` 与 `concord --skill fix`，参数以 `concord test --help` 为准。
