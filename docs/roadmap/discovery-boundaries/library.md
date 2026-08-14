# Eval 发现边界 —— Library

本方向不增加 defineEval、defineScoreEval、defineConfig 或 Config.evalRoots 的过滤字段。作者继续用既有 file entry、folder entry 和 discovery root 写法组织 Eval。

## 入口语言

```text
evals/search.eval.ts       -> Eval id "search"
evals/search/eval.ts       -> Eval id "search"
evals/search/eval.tsx      -> Eval id "search"
```

file entry 的名字必须以 .eval.ts 或 .eval.tsx 结束。folder entry 的名字必须正好是 eval.ts 或 eval.tsx，且它的父目录必须位于 discovery root 的命名子目录中。

```text
evals/payroll/eval.ts
evals/payroll/checks/smoke.eval.ts
```

上例只发现 payroll。payroll/eval.ts 拥有 payroll/ 目录；checks/smoke.eval.ts 是 payroll Eval 的普通模块或资产，不是第二条 Eval。

根目录中的 eval.ts 或 eval.tsx 没有非空 id，因此以 discovery.root-folder-entry 失败。file entry 与 folder entry 映射到同一 base id 时，以 discovery.duplicate-id 失败。

## 公开 provenance

每条 Eval descriptor 都提供它的发现 provenance。路径始终相对 logical root，绝不暴露宿主绝对路径。

```ts
type EvalDiscoveryRoot =
  | {
      readonly kind: "project";
      readonly root: "evals";
    }
  | {
      readonly kind: "package";
      readonly dependency: string;
      readonly mount: string;
      readonly root: string;
    };

type EvalDiscoveryEntry =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly baseId: string;
    }
  | {
      readonly kind: "folder";
      readonly path: string;
      readonly directory: string;
      readonly baseId: string;
    };

type EvalDiscoveryCutoff =
  | {
      readonly kind: "none";
      readonly reason: "file-entry";
    }
  | {
      readonly kind: "directory";
      readonly directory: string;
      readonly reason: "folder-entry-owns-descendants";
    };

interface EvalDiscovery {
  readonly root: EvalDiscoveryRoot;
  readonly entry: EvalDiscoveryEntry;
  readonly cutoff: EvalDiscoveryCutoff;
}

interface EvalDescriptor {
  readonly discovery: EvalDiscovery;
}
```

一个 entry 默认导出数组或 keyed record 时，所有展开 Eval 共用 entry、root 与 cutoff；它们以自己的完整 Eval id 区分。keyed record key 继续是合法单一路径片段，数组序号继续是该 entry 的稳定展开规则。

## root 与重叠

本地 project root 的默认 discovery root 是 evals。package root 继续由 Config.evalRoots 的 package、root 与 mount 表示；这个方向不改变 package owner、mount prefix 或安装身份的契约。

所有 configured root 在发现前以真实路径规范化。两个 root 的真实路径相同，或任一真实路径是另一个的祖先或后代时，整体以 discovery.root-overlap 失败，即使它们有不同 mount 或暂时不会产生重复 id。

这条规则保证一个物理目录只有一个 discovery owner。folder-entry cutoff 不会成为重叠 root 的例外。

## 没有过滤 API

不存在 discovery.ignore、exclude、include、glob、priority、override 或 childEntries。普通目录只要没有 folder entry，就按既有 entry 名称规则递归发现。

要让 child 成为独立 Eval，目录不能同时由祖先 folder entry 拥有。要让 child 成为父 Eval 的模块或资产，保留父目录中的 folder entry 即可；不需要再写忽略模式。

## 生产入口验收

1. niceeval list 必须把 file、folder、array 与 keyed record 的 root、entry、cutoff 稳定投影出来。
2. niceeval check 必须在 Sandbox link 前拒绝重叠 root、重复 id、root entry 与非法 symlink entry。
3. niceeval exp --dry 与真实运行必须消费同一份 frozen discovery，不能因并发或文件遍历顺序选择不同 Eval。
