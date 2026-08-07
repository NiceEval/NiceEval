# Unit：确定性语义测试

Unit 负责真实场景 Repo 无法稳定制造、无法廉价穷举或无法精确定位的确定性风险。它不按源码目录机械补 line coverage。

## 适合 Unit 的风险

- 纯选择、归一化、聚合、格式化和 schema；
- fingerprint / cache / carry 的等价类矩阵；
- error kind 与错误因果链；
- fake clock、barrier、受控 promise 下的 retry、lock 和调度；
- adapter 原始事件到 NiceEval 规范事件的纯转换；
- 静态 exports、注册表和双向 census。

安装、外部 cwd、真实进程 pipe、HTTP、浏览器、signal 和 provider 协议不应由 Unit 冒充。

## 存在资格

每个确定性矩阵在文件头或 `describe` 旁回答两句话：

1. 删除它会让哪一类错误算法通过？
2. 为什么对应 E2E 无法稳定制造或区分？

```ts
// wrong algorithm: retry backoff 时提前释放并发闸。
// E2E 只能概率撞中该时序；barrier unit 能确定停在 backoff 中间观察第二条任务。
test("retry backoff 期间仍占用并发槽", async () => {
  const first = controlledAttempt("first");
  const second = controlledAttempt("second");

  await first.enterRetryBackoff();
  expect(second.started()).toBe(false);

  await first.finish();
  expect(second.started()).toBe(true);
});
```

不能写出具名错误算法，或 E2E 已经稳定完整证明同一命题时，不新增 Unit。

## Fixture

- 显式字段只包含本 case 的语义输入；
- builder 填当前合法 schema 的机械默认值，但不计算 verdict、delta、summary 或 expected；
- 旧格式兼容测试显式固定 schema version，不 import 候选常量自动跟随；
- 不把完整生产 DTO 复制进几十个测试；
- mock 只替代本测试自己拥有的依赖，不伪装进程、协议或第三方 SDK 的真实形状。

新增无关生产字段导致大量 fixture 编译失败，说明 fixture 边界错误，不是“类型安全帮了忙”。

## 表驱动矩阵

`test.each` 只用于动作与断言完全相同、输入属于同一等价类划分的 case。不同步骤、不同 failure mode 或不同公开结果拆开。

```ts
test.each([
  ["command_execution", "shell"],
  ["file_change", "file_edit"],
  ["web_search", "web_search"],
])("%s 归一为 %s", (raw, expected) => {
  expect(canonicalTool(raw)).toBe(expected);
});
```

完整 adapter 兼容性仍由 live 场景 Repo 证明；这个 Unit 只拥有纯转换矩阵和更快定位。

## 不稳定测试的替代

| 旧写法 | 新写法 |
|---|---|
| 完整 Run / Attempt snapshot | 最小领域输入 + 有区分力字段 |
| sleep 等并发碰巧发生 | barrier / fake clock |
| mock CLI 内部函数后称 E2E | 真实场景 Repo 的安装后进程 |
| 每个 renderer 复制同一决策矩阵 | 一个算法 owner + 各出口一个必要接线代表 |
| import 候选常量给 fixture 当 expected | 独立字面量 + 契约升级显式 diff |

迁移与删除规则见 [Portfolio](../portfolio.md)，历史证据见 [旧问题对账](../history-problems.md)。
