# Eval 发现边界

Eval 文件树既是模块树，也是用户可读的题目目录。递归扫描若不承认目录入口的所有权，就会把一个任务目录中的共享模块、fixture 或子任务误认成另一条 Eval，并让同一物理内容拥有不稳定的发现身份。

本 Roadmap 用 folder-entry ownership 定义结构边界。一个目录中显式存在 eval.ts 或 eval.tsx 时，该目录由这条 folder entry 完整拥有；发现器将入口加入发现清单后停止向其后代递归。

## 解决的 Frog / DX

Frog 中的发现摩擦表现为：同一目录既像一条 Eval 又像一棵可继续扫描的根，CLI 只给最终 id 而不说明从哪里发现，以及 symlink、重叠根或装载失败只能靠猜扫描顺序定位。

作者只需用目录结构表达所有权。用户在 list、check 和 dry 中同时看到 discovery root、实际 entry 与停止递归的原因，因此能够判断该改配置、入口文件还是目录组织。

## 核心心智

Discovery root 是允许扫描的边界。entry 是一个实际被导入的 Eval 模块。folder entry 是目录所有权边界，不是优先级较高的同名候选，也不是 ignore 规则。

目录内存在 folder entry 时，其后代作为这条 Eval 可导入的模块或资产存在。它们继续受 owner root、source capture、transfer 和泄漏检查约束。

file entry 与 folder entry 都从路径推导 Eval id。所有根完成独立扫描和装载后，最终 id 只允许有一个 owner；发现器不按根、目录、文件系统或并发完成顺序替换冲突项。

## 范围

本方向包含：

- eval.ts 与 eval.tsx 的 folder-entry ownership 和递归截止；
- 稳定的 root、entry、id 与装载顺序；
- root 重叠、重复 id、symlink、escape 与 load failure 的封闭语义；
- list、check、dry 和 JSON 的发现 provenance。

本方向不包含：

- include、exclude、ignore、glob、优先级选择、入口替换或按 pattern 改名；
- 新的 Eval factory、Dataset、Assertion、Sandbox、Result 类型或外部题协议；
- 通过不导入的 child entry 来跳过其安全验证后再从别处运行它。

## Assertion 决策

发现没有新的 Assertion。它没有 Attempt subject，也不会在运行后求值。公开 owner 是 Config 的 discovery root 与 discovery loader；最终 Eval definition、source closure 与普通 Assertion 保持自己的 owner。

## 删除与迁移边界

folder entry 下的 child entry 作为父 Eval 的普通模块或资产处理，不取得独立 discovery owner。要保留 child Eval，移动父 folder entry，或把 child 放入不受该 folder entry 管辖的目录。

没有兼容 flag、优先级、ignore、glob 或双重扫描路径。一个目录在同一 discovery transaction 中只由一个 folder entry 或普通递归规则管理。

## 所有权与身份

| 事实 | owner | identity |
| --- | --- | --- |
| local 或 package discovery root | project Config / package mount | root kind + logical root + owner root |
| file entry | entry module | root-relative entry path + file kind |
| folder entry 与后代截止 | folder entry module | root-relative directory + folder kind |
| final Eval id | discovered Eval | mount prefix + root-relative base id + dataset key |
| source closure、asset 与 transfer | Eval definition | owner root capability + reachable input identity |

folder ownership 是 definition identity 的一部分。把同一路径由 file entry 改为 folder entry，或把 folder entry 移走以暴露 child entry，会重新建立受影响 Eval 的发现身份，不能静默沿用结果。

## 入口

- [Library](library.md) — 入口语言、公开 provenance 与没有新增过滤 API 的边界。
- [CLI](cli.md) — root、entry、cutoff、JSON、dry、退出码和审计。
- [Architecture](architecture.md) — 扫描算法、稳定排序、symlink、错误与生产验收。
