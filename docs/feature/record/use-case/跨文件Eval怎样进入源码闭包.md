---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 跨文件 Eval 怎样进入源码闭包

Eval import 项目评分函数或通过 NiceEval loader 读取数据时，入口文件不足以代表执行输入。Runner 在 capture 边界形成
`niceeval.sources` Run Attachment，为每个 source item 保存 stable identity、canonical project-relative path、digest 与 Content。

```ts
// evals/login.eval.ts
import { gradeLogin } from "../helpers/grade-login.ts";

const cases = await loadYaml("evals/data/cases.yaml", decodeCases);
```

本例的 closure 包含 Eval、评分函数与 loader input。Sources builder 把 bytes 交给 Host；Host 在 transaction 外读取并计算 digest，
以 bounded Content chunks 写入 generic rows。source site 只以 identity/digest/coordinate join，不暴露 physical row 或 chunk。

computed `import()`、直接 `fs.readFile()`、外部 package resolution 与运行时拼接 path 不能由静态 closure 猜测。需要成为输入的项目
文件应经过受支持 loader；Sandbox 中产生或传输的文件进入相应 File Changes / Artifact family。

source closure identity 用于 reuse，Sources Attachment 用于离线核对已发生事实。Record reader 不重新扫描 import、不读取当前
worktree，也不从 cache 补历史。多个 Attempt 通过 origin Run 共用同一 closure；要交给其它项目时使用 Host 生成的
sealed-only `RecordSnapshot`。
