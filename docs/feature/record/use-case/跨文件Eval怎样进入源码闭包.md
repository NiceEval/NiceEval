# 跨文件 Eval 怎样进入源码闭包

Eval 调用项目内另一个文件导出的函数时，入口文件本身不能代表完整执行输入。本地静态 import 递归进入该 Eval 的源码闭包。

## 本地评分函数

```ts
// evals/login.eval.ts
import { gradeLogin } from "../helpers/grade-login.ts";

export default defineEval({
  test: async (t) => gradeLogin(t),
});
```

这条 Eval 的源码闭包同时包含 `evals/login.eval.ts` 与 `helpers/grade-login.ts`。共享评分函数改变时，所有静态依赖它的 Eval 都形成新的源码闭包 identity。

Run 发布 `niceeval.sources/v1` 时保存闭包内源码的 manifest、digest 与 RecordAttachment-local bytes。Report 从 Attempt 的 origin Run 查看当时内容，不读取后来修改过的评分函数。

## 通过 loader 读取的数据

发现期通过 `loadText`、`loadYaml` 或 `loadJson` 读入的项目文件也属于源码闭包。修改题面、rubric 或数据集会改变依赖它的 Eval identity。

```ts
const cases = await loadYaml("evals/data/cases.yaml", decodeCases);
```

loader 同时给出显式路径和解码边界。它与本地静态 import 一样，可以在运行前形成稳定依赖集合。

## 不能从静态 closure 猜出的输入

computed `import()`、直接 `fs.readFile()` 和运行时拼出的路径不由静态 import closure 自动证明。直接 `fs` 读取的文件也不进入既有 Eval 源码闭包指纹。

需要发现期数据时使用 NiceEval loaders。Sandbox 运行中实际上传的本地文件写入 transfer manifest，并遵守自己的动态 identity 契约。

外部 package 的安装与 resolution identity 不由 Sources RecordAttachment 自行猜测。它属于 input、behavior 与 reuse identity 边界；版本文本不能由本用例提升为源码 bytes 证明。

## 两个用途保持分层

```text
源码闭包 identity
  → 判断源码变化是否让旧 Attempt 失去沿用资格

niceeval.sources/v1
  → 保存当时可离线查看和核对的源码事实
```

Record 只保存 producer 已形成的 source facts，不重新扫描 import，也不判断当前目标能否 reuse。依赖发现和比较语义变化时，由对应 behavior identity owner 更新自己的 domain。

## 相关阅读

- [修改评测源码后只重跑受影响项](../../experiments/use-case/缓存与沿用/修改评测源码.md)
- [本地测试文件与 transfer manifest](../../eval/use-case/criteria-files.md)
- [Eval 数据加载](../../eval/library.md)
