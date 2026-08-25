# Experiment Pilot 抽样 —— Architecture

## 规划顺序

```text
discover Experiment + Eval
  -> apply each Experiment.evals
  -> apply CLI Eval prefixes
  -> verify one shared candidate Eval-ID set
  -> select Eval IDs once
  -> expand Experiment × selected Eval × attempts
  -> fingerprint / carry / dispatch
```

选择只处理 Eval ID，不读取 Verdict、成本、历史执行时间或文件大小。
因此相同签入配置不会因历史结果不同而抽到不同题。

## 稳定 sample 算法

`eval-id-sha256/v1` 为每个 candidate 计算：

```text
sha256("niceeval/pilot/v1\0" + decimalSeed + "\0" + evalId)
```

Runner 按 digest bytes 升序排列，digest 相同再按 Eval ID 升序，取前 N 项。
最终 selected IDs 按这份 ranking 保存，不能由并发完成顺序重排。

算法版本进入 selection identity。
未来更换算法必须产生不同版本，旧 Run 仍按 manifest 中保存的版本解释。

## Record 形状

```ts
interface EvalSelectionManifest {
  readonly mode: "all" | "first" | "sample";
  readonly candidateEvalIds: readonly string[];
  readonly candidateDigest: string;
  readonly selectedEvalIds: readonly string[];
  readonly selectedDigest: string;
  readonly requestedCount?: number;
  readonly seed?: number;
  readonly algorithm: "all/v1" | "eval-id/v1" | "eval-id-sha256/v1";
  readonly finality: "full" | "non-final";
}
```

candidate 与 selected 数组都按各自规范顺序保存。
`finality` 按 `selectedEvalIds` 是否包含全部 `candidateEvalIds` 计算，不由作者手写。

candidate 数组先按规范化 Eval ID 的 Unicode code point 升序排列。
`all` 与 `first` 保留该顺序；`sample` 保留 hash ranking 顺序。
`candidateDigest` 与 `selectedDigest` 分别是对这两个最终数组的 JCS 字节计算 SHA-256，不对未排序 discovery 结果求哈希。

Run 的 SampleManifest 强引用这份 manifest。
`SampleManifest.candidateEvalIds` 必须等于 `candidateEvalIds`，而execution entries 的 Eval ID 必须来自 `selectedEvalIds`。
query 与 View 读取已保存的选择与 coverage，不重新执行抽样算法。

## Completion 与 coverage

Run completion 回答选中计划有没有完成。
Pilot finality 回答选中计划是否包含完整候选总体。

两条轴可以组合：

| Completion | Finality | 含义 |
|---|---|---|
| complete | full | 全量计划完整结束 |
| complete | non-final | Pilot 完整结束，但不是全量结果 |
| incomplete / interrupted | full | 全量计划有执行缺口 |
| incomplete / interrupted | non-final | Pilot 自身也没有完成 |

## Carry 到完整 Run

新 full Run 为完整 candidate set 写入自己的 SampleManifest。
每个历史 Pilot Attempt 仍逐项通过正常 fingerprint、终态、资格与模式门。

命中的 Attempt 以 carried provenance 进入 full Run；未选择的 Eval 形成新计划项。
Pilot 的 non-final 标记不会传染给已经补齐且完成的 full Run。
