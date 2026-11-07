# Netlify report preview 仍消费 MemoryBench 的旧 Record

在当前 main 契约上执行 `CONTEXT=deploy-preview bash netlify-preview/build-report-preview.sh`，MemoryBench `2-0` 安装当前 NiceEval candidate 后，`niceeval view --out` 返回 `record-format-unsupported`，并提示使用写入该 future or unknown Record format 的 NiceEval 版本。

## Impact

任何真实触及 Record reader、report、view 或 CLI 的 PR 都会在 Netlify report preview 阶段失败，直到预览 fixture 由当前 Record producer 重新生成。

## Reproduction

```sh
CONTEXT=deploy-preview bash netlify-preview/build-report-preview.sh
```

脚本克隆 MemoryBench `2-0`、安装当前 NiceEval candidate，然后在 `niceeval view --out` 返回 `record-format-unsupported`。

## Scope

当前修正只让与 report preview 消费边界无关的 PR 跳过该任务。涉及 Record reader、report、view 或 CLI 的变更仍会运行预览并暴露这个问题；要恢复这些变更的绿灯，需要用当前 producer 重新生成可公开消费的 fixture。
