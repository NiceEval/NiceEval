# 方案 1：全新 Sandbox、预制环境与 Sandbox 预热

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [PLAN-2](../PLAN-2/README.md) · [PLAN-3](../PLAN-3/README.md) · [DECISION](../DECISION.md)

---

## 方案

每个 Attempt 使用独立 Sandbox。
稳定依赖进入 image、template 或 snapshot； Runner 在计划确定后，只为近期可派发的 Attempt 预创建有限数量的 Sandbox。

## 优势

- 保持 Attempt 间隔离、结果沿用资格和现有并行。
- Provider 只需保证一个 Sandbox 覆盖一条 Attempt。
- 预制环境能减少 `eval.run` 内重复安装，而不只减少 Sandbox 创建。

## 缺点

- SandboxSpec 与 Agent 的运行期准备仍逐 Attempt 支付。
- Sandbox 预热只移动创建时间，不减少资源占用。
- 预制产物的制作与失效由项目和 Provider 原生工具管理。

## 数据流

```text
计划与结果沿用
  → 按近期派发量预创建 Sandbox
  → Attempt 领取全新 Sandbox
  → 完整生命周期
  → 销毁或按 --keep-sandbox 留存
```

预创建的 Sandbox 按 sandbox spec 与 environment profile 分组。
中断、预算耗尽或首过即停后，未领用的 Sandbox 必须销毁。

## 验收

1. 同批 Attempt 无法观察到前一条的文件、进程或用户目录状态。
2. 有预创建 Sandbox 时，Attempt 的 `sandbox.create` 只记录领取耗时。
3. 停止派发后不继续补充 Sandbox，未领用数量有界并被销毁。
4. Sandbox 预热不改变结果沿用资格。
5. 验收同时比较总耗时和 Sandbox 资源时间。

## 与其它方案的关系

这是默认方案，也是 Sandbox 复用结果的正式复验路径。
