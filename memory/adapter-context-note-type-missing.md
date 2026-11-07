# Adapter Eval 类型遗漏已实现的 note 方法

## 问题

Adapter 的 Pass 与 Score Eval 在运行时可以登记 Note，但 EvalContextBase 未声明 note。TypeScript 消费者因而不能直接调用该方法。

## 根因与修复方向

中立 Adapter context 与 AssertFirstCoreTestContext 分别声明公开能力，note 仅出现在后者。Adapter 应复用同一个 note 签名，保留 JSON、Quantity 与 void 返回约束。

## 验证

加强现有 application-types 安装后 E2E owner，覆盖两种 Eval 的合法 Note、Quantity 和非法参数。通过旧候选红灯和修复候选接管收据后再解决本 Problem。
