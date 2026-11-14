# UserDatabase 格式与初始化

UserDatabase 只有一个存储格式标记。不存在数据库时，首次真实消费原子初始化当前格式；已有数据库必须先通过格式检查。
格式不符时，公开命令以非零状态说明精确路径及后续处理，原文件保持不变。

`e2e/cli/test/user-database-format.test.ts` 通过安装后的缓存清单 CLI 验证旧格式拒绝。
fixture 使用历史安装产生的数据库，测试不手工构造内部 schema，也不读取私有表来判断成功。
`e2e/cli/test/cache-inventory.test.ts` 与各实际消费 Repository 的 lifecycle/cache owner 验证当前库的初始化、读写、并发与释放。

运行最小验收：

```sh
pnpm e2e test --repo cli -- --run test/user-database-format.test.ts test/cache-inventory.test.ts
```

这些操作使用隔离的 `NICEEVAL_HOME`，不得触碰维护者正在使用的 UserDatabase。
格式拒绝不能自动清空数据库、删除其中登记的外部资源或替代资源所有权检查。
