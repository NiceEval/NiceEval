# Eval 发现边界 —— Architecture

发现器先规范化所有 root，再建立一个稳定的 entry 树，最后按该树装载模块。模块装载不会反过来决定扫描边界。

## 扫描算法

```text
normalize and validate every root
  -> reject real-path overlap
  -> walk each root by normalized directory name
  -> detect direct folder entry
  -> add it to the discovery list and stop descent for that directory
  -> otherwise add direct file entries and descend
  -> sort entries by root identity and relative path
  -> load each entry once
  -> expand arrays / keyed records
  -> reject duplicate final ids
  -> freeze discovery snapshot
```

对于每一个可扫描目录，先检查其中的 regular eval.ts 与 eval.tsx。一个或两个 folder entry 都存在时，该目录不再扫描任何后代；两个入口会在同一 base id 上形成 duplicate-id。

目录没有 folder entry 时，发现器将其中的 regular .eval.ts 与 .eval.tsx 加入发现清单，再以规范化目录名递归。node_modules、.git、.niceeval、dist 与 .next 继续是固定的非发现目录；它们不是作者可配置的 ignore 或 glob 语言。

folder entry 的后代不会被当作发现 candidate、不会 import、不会进行 child export decode。它们在父 entry 的正常模块图、source closure、Sandbox build context 或 transfer 中被引用时，仍由对应 owner capability 检查。

## 稳定顺序

root identity 先以 kind、mount 与逻辑 root 排序。一个 root 内的目录和 entry path 使用规范化 POSIX 路径的 UTF-8 字节序排序。entry 模块按这个顺序恰好导入一次。

展开后按最终 Eval id 的同一字节序排序。数组 index 和 keyed record key 属于 entry 自己的展开规则；Config record 插入顺序、文件系统枚举顺序、异步读取完成顺序与模块缓存命中顺序不属于公开排序。

最终 id 相同的任意两个展开项都会整体失败。错误列出两个 root、entry、entry kind 与最终 id，不能按最先读到的一条保留。

## root、symlink 与 escape

root 配置路径必须是 owner root 内的普通相对路径。root 自身可以是 symlink，但 realpath 后必须仍位于它的 project owner 或 package owner 内。重叠判定使用这个真实 root。

root 内的 symlink 永远不是发现 entry，也不会被递归穿越。名字看起来像 eval.ts、eval.tsx、*.eval.ts 或 *.eval.tsx 的 symlink 以 discovery.entry-symlink 失败，即使 target 位于 owner 内；这避免同一个 module 经两个 logical 路径得到两个 identity。

不具 entry 名称的 symlink 是普通未扫描资产。它被 entry 模块 import、作为 build context、mount 或 upload source 使用时，既有 owner-root realpath 检查仍必须拒绝任何 escape。

regular entry、其父目录与 source capture 的每次读取都以 realpath 复核 owner root。不存在目标以最近存在祖先复核；读取或导入期间替换为 symlink、逃到 owner 外或无法复核时，以 discovery.entry-escape 或 discovery.raced 失败。

## 失败语义

```ts
type DiscoveryFailureCode =
  | "discovery.root-missing"
  | "discovery.root-not-directory"
  | "discovery.root-escape"
  | "discovery.root-overlap"
  | "discovery.root-folder-entry"
  | "discovery.entry-symlink"
  | "discovery.entry-escape"
  | "discovery.filesystem"
  | "discovery.duplicate-id"
  | "discovery.import-failed"
  | "discovery.invalid-export"
  | "discovery.invalid-dataset-key"
  | "discovery.source-capture-failed"
  | "discovery.leak-gate-failed"
  | "discovery.raced";
```

| 失败类别 | 处理 |
| --- | --- |
| root 缺失、不是目录、escape 或 overlap | 不导入任何 entry，不创建计划 |
| candidate symlink、entry escape、root folder entry | 不装载该 root，报告结构错误 |
| 目录枚举、读取或权限失败 | 报 discovery.filesystem，整个 discovery 失败 |
| 同 id 的 file、folder、dataset 或多 root 展开 | 报 discovery.duplicate-id，绝不选赢家 |
| 顶层 import 抛错 | 报 discovery.import-failed，保留 root 与 entry |
| default export、factory brand 或 dataset key 无效 | 报 discovery.invalid-export 或 discovery.invalid-dataset-key |
| source closure、owner capability 或 leak gate 失败 | 保留对应结构化 code，零 Sandbox 资源 |
| snapshot 复核失败 | 报 discovery.raced，调用方重试完整 discovery |

同一稳定扫描批次中的独立问题可以聚合报告。任何错误都使整次 discovery 不可用；list、check、dry 和 exp 不得到部分 Eval 集。

## 身份与结果沿用

Discovery snapshot 保存 root identity、entry kind、entry path、cutoff、展开规则与 source closure。它是 Eval definition identity 的输入，不由 query 或 View 事后猜出展示字段。

folder entry 截止能改变哪些模块被定义为独立 Eval，因此改变 cutoff、root 或 entry kind 会使受影响 Eval 重新规划。普通目录中未被 import 的文件不因“被扫描过”进入 source closure。

## 生产入口验收

| 入口 | 必须证明 |
| --- | --- |
| niceeval list | root、entry、cutoff 的稳定 human 与 JSON 投影 |
| niceeval check | overlap、duplicate、root entry、symlink 与 escape 在资源前失败 |
| niceeval exp --dry | 真正装载同一 discovery，但不 dispatch 或创建 Sandbox |
| niceeval exp | 同一 snapshot 决定选择、fingerprint 与运行范围 |
| 真实文件系统 fixture | folder cutoff、file/folder冲突、nested root、symlink alias、escape、load throw 与 race 均可复核 |
