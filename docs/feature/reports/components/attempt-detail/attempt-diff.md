# Attempt diff

`diffResult(attempt)` 是 Attempt 详情、`show --diff` 与 JSON 共用的任务结果：

```ts
interface DiffResult {
  locator: AttemptLocator;
  /** 按路径排序；净无变化的文件不在里面。 */
  files: readonly DiffFile[];
}
```

`toDiffFiles(attempt)` 返回同一份 `files`，供 [`DiffView`](../primitives/diff-view.md) 直接消费。
`DiffFile` 的字段形状在 `DiffView` 的值形状里定稿，两个入口不各写一份。

## 差异从哪里来

显示的是 [agent 归因增量](../../../sandbox/architecture.md#变更归因send-窗口与分类账)：

1. runner 在 workdir 上打一本私有 git 分类账，每个 send 窗口前后各取一次锚点。
2. `workspace.diff` 阶段导出逐窗口 delta，落盘为 [`diff.json`](../../../record/architecture.md#diffjson)，形状是 `DiffWindow[]`。
3. 这份投影在窗口序列之上派生文件级视图：净状态、触碰窗口、逐窗口 patch。

因此清单里只有 agent 在 send 窗口内改动的文件。
Fixture、`EvalDef.setup` 准备的素材、eval 在最后一次 `t.send()` 之后写入的验证材料都算 eval 归因，不进这份清单。
`diff.ignore` / `diff.include` 调整归因排除清单，判断口径与这份投影完全一致。

## 派生规则

- 净状态取首个触碰窗口的起点与最后触碰窗口的终点。
  动过但净无变化的文件（创建又删除、改回原样）不进 `files`。
- `added` / `removed` 是公共前后缀修剪后的上界近似：单区域编辑精确，复杂编辑给出上界。
- 逐窗口 patch 原样来自该窗口的 before/after，不跨窗口合成。
- 二进制文件只带字节数，不带 patch。

## 可用性

`diff.json` 缺失时整段是明确缺失，不伪造成「零个文件改动」：

| 情况 | 表现 |
|---|---|
| 沙箱型 Attempt，agent 一个文件都没动 | 清单为空，区块零输出 |
| direct agent（没有 NiceEval 管理的 workspace） | 声明这次 Attempt 没有 diff 证据 |
| 发布记录根未带 `diff` artifact | 声明证据未随发布带上，并给出期望路径 |

`publish({ artifacts })` 默认不带 `diff`。
要让静态站的 Attempt 详情有文件差异，发布时显式选上它。

## 相关阅读

- [`DiffView`](../primitives/diff-view.md) —— 值形状、路径树与内联预算。
- [`--diff`](../../show/diff.md) —— 终端切片与单文件 patch。
- [Record Library](../../../record/library.md) —— 用脚本消费 `diff.json` 的窗口结构。
