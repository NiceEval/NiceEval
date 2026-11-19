# 写性质测试

## 用户目标

维护者要让一条 Feature 性质在生成的合法操作序列上受检。行为被破坏时，测试应指出输入、期望与实际结果。

## 起始状态

- 已找到 [Feature](../../../feature/README.md) 的性质和稳定锚点。
- 已读[表面与工具](../architecture.md#表面与工具)。示例为目标命令，根 `package.json` 入口由实现阶段提供。

## 完整路径

1. 写下公开观察、规则与操作序列。 {#define}

   在测试声明旁用 `// @use-case <Feature 路径>#<性质锚点>` 关联性质。条件仅对部分状态成立时，将前提写进规则。

2. 写集成性质。 {#integration}

   例如按[引用与删除](../../../feature/run/README.md#reference-deletion)生成发布、删除和重试操作。用 fast-check 的 `fc.commands` 生成动作，模型只记录引用是否存在，由实际公开 Run API 执行动作。比较删除结果和来源的可读性。给每个例子准备独立临时状态。

   ```sh
   pnpm exec vitest run test/integration/run-reference-deletion.test.ts
   ```

3. 写界面性质。 {#interface}

   例如按[一致刷新](../../../feature/insight/README.md#atomic-refresh)写浏览器 spec。Extractor 读取页面成员与地址，规则约束确认前后分别只显示完整版本。动作生成器组合浏览器导航、确认和放弃。界面测试只保留需要真实浏览器观察的保证。

   ```sh
   bombadil browser test test/bombadil/insight-refresh.ts
   ```

4. 检查区分力。 {#validate}

   运行选定性质，观察目标行为缺失或受控回退是否导致预期失败。恢复实现后执行同一测试，并按[运行矩阵](../architecture.md#运行)补齐相关验证。

## 结果

性质有稳定链接、公开断言和可探索的动作。交付记录运行命令、观察到的失败及恢复后的结果。
