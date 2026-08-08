# Record：Locator 碰撞例外

Record 的公开 writer、reader、事件与 locator 往返由 [Record E2E](../e2e/record.md) 从安装后的 `niceeval/record` 入口证明。
正常格式、坏输入、旧格式和可制造的读取错误不在 Unit 重复。

## Unit 例外规范

### 60-bit locator 碰撞

[Locator 唯一性契约](../../../feature/record/architecture.md#locator-的唯一性)要求写入侧拒绝异身份碰撞，读取侧不得从多个候选中任选一个。
真实 E2E 无法在可接受时间内稳定产生 60-bit 碰撞；签入两个伪造 locator 只能证明 fixture 写了相同字符串，不能证明登记算法如何处理冲突。

稳定 seam 是 `buildLocatorIndex()`、`resolveAttemptLocator()` 与 `assertLocatorRegistrationsAvailable()`。最小矩阵只有两面：

- 读取索引保留全部候选并返回 `ambiguous`；
- 写入登记拒绝不同身份，同一身份再次登记保持幂等。

除此之外，Record 不保留 Unit。公开 writer / reader 能稳定制造的结果归 E2E；产品没有承诺的旧格式不建立测试。
