# `DiffView`

`DiffView` 接已经投影好的文件差异，按路径分层显示：

```tsx
const files = await toDiffFiles(attempt);
return <DiffView files={files} />;
```

路径、状态、行数、二进制事实与 patch 全部来自投影结果。
组件不读取 artifact，也不重新计算 patch。
文件差异从哪里来、什么时候整段缺失，见 [Attempt diff](../attempt-detail/attempt-diff.md)。

## 值形状

```ts
type DiffChange = "added" | "modified" | "deleted";

interface DiffFile {
  /** workdir 根起的相对路径，`/` 分隔。 */
  path: string;
  change: DiffChange;
  /** 净行数变化：公共前后缀修剪后的上界近似。 */
  added: number;
  removed: number;
  /** 内容被省略的文件只报字节数与原因（二进制 / 超过单文件阈值的文本），`windows` 里不带 patch。 */
  elided?: { reason: "binary" | "oversized-text"; beforeBytes?: number; afterBytes?: number };
  /** 触碰过该文件的 send 窗口，按时序，至少一条。 */
  windows: readonly DiffFileWindow[];
}

interface DiffFileWindow {
  /** 轮标签，与 `--execution` 的 turn 头行、时间树 turn 节点同一枚 token。 */
  window: string;
  /** 该窗口内这个文件的 patch；省略即这一段没有内联内容。 */
  patch?: string;
}
```

`change` 与 `diff.json` 的 `net`、text 面的行首字母是同一套词：`added` / `modified` / `deleted` 在两面各打印为 `A` / `M` / `D`。

patch 按 send 区间分段，不合成跨区间 patch。
send 区间之间可能夹着 eval 侧写入，合成会把它算进 agent 的账；「创建又删除」「改完又改回」也会被合成压没。

## web 面：路径树

路径树是唯一的结构轴。
`change` 是文件行上的一个状态字母，不构成分组：同一个目录下三种状态的文件在同一棵子树里，按路径排序。

| 行 | 内容 |
|---|---|
| 目录行 | 目录名、子树文件数、子树的 `+N` 与 `-M` 汇总 |
| 文件行 | 状态字母、文件名、该文件的 `+N` 与 `-M` |

- 只有一个子目录、自己没有文件的目录链压成一行，例如 `src/report/model/`。
- 目录默认展开：文件清单是这个区块的主体，不该藏在一次点击后面。
- 文件行默认折叠 patch，展开后按 send 区间分段，段头是轮标签。
- 内容被省略的文件行显示字节数变化并在行上标注原因（binary / oversized text），不给展开区（没有 patch 可看）。
- 折叠态的 `+N` 与 `-M` 各自成元素，与 patch 里的增行、删行同一套颜色。

### 内联预算

patch 内联进 HTML，因此 web 面按预算收口：

| 上限 | 值 | 越界行为 |
|---|---|---|
| 单个文件的 patch 合计 | 64 KiB | 该文件不内联 |
| 一个 `DiffView` 实例内联合计 | 512 KiB | 按路径序累加，耗尽后其余文件不内联 |

按路径序累加而不是挑小的先放，是为了让同一份输入每次产出同一个站点：哪些文件内联可复现，也与树的显示顺序一致。

不内联的文件行显示 `niceeval show @<locator> --diff=<path>`，并说明原因是超过内联预算，不显示空的展开区。
预算只约束 web 面内联。
text 面的 `--diff=<path>` 是对单个文件的显式请求，不设预算。

## text 面

text 面是文件级摘要清单：一行一个文件，状态字母、路径、增删行数、触碰的 send 区间。
输出形态与 `niceeval show --diff` 逐字一致，两者调用同一个投影，不存在第二份口径。
`--diff` 的完整输出示例见 [`--diff`](../../show/diff.md)。

## 相关阅读

- [Attempt diff](../attempt-detail/attempt-diff.md) —— 文件差异的出处、可用性与 `DiffResult` 形状。
- [`--diff`](../../show/diff.md) —— 同一份投影的终端切片。
- [Sandbox Architecture · 变更归因](../../../sandbox/architecture.md#变更归因send-区间与分类账) —— send 区间与分类账。
