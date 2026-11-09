# Eval 发现边界 —— Library

作者继续使用 [Eval 目录入口](../../feature/eval/README.md#文件夹入口一道题一个目录) 与 [Config.evalRoots](../../feature/eval/library/sharing.md#配置外部根)。
本方向不增加 Eval factory 或过滤字段；它为既有发现结果增加下述 provenance 与结构诊断。

## 入口语言

`eval.tsx` 同样是 folder entry，父目录必须位于 discovery root 的命名子目录中。
root 内直接出现 `eval.ts` 或 `eval.tsx` 没有非空 id，以 `discovery.root-folder-entry` 失败。
普通 file entry、目录截止与重复 id 的基础行为沿用 Feature，不在本页重新定义。

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

root 输入与 package owner 沿用 [外部根配置](../../feature/eval/library/sharing.md#配置外部根)；本方向只增加 root 间的物理重叠检查。

所有 configured root 在发现前以真实路径规范化。两个 root 的真实路径相同，或任一真实路径是另一个的祖先或后代时，整体以 discovery.root-overlap 失败，即使它们有不同 mount 或暂时不会产生重复 id。

这条规则保证一个物理目录只有一个 discovery owner。folder-entry cutoff 不会成为重叠 root 的例外。

## 没有过滤 API

本方向不扩展 [现行配置的选择边界](../../feature/eval/library/sharing.md#安装与内容边界)，也不引入 `discovery.ignore`、`glob`、`priority`、`override` 或 `childEntries`。

## 生产入口验收

1. niceeval list 必须把 file、folder、array 与 keyed record 的 root、entry、cutoff 稳定投影出来。
2. niceeval check 必须在 Sandbox link 前拒绝重叠 root、重复 id、root entry 与非法 symlink entry。
3. niceeval exp --dry 与真实运行必须消费同一份 frozen discovery，不能因并发或文件遍历顺序选择不同 Eval。
