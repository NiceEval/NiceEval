# 跨文件 Eval 怎样进入源码闭包

Eval 调用项目内另一个文件导出的函数时，入口文件本身不能代表完整执行输入。静态 local import 与
NiceEval loader 已读取的项目文件共同形成本次源码闭包。

## 本地评分函数

```ts
// evals/login.eval.ts
import { gradeLogin } from "../helpers/grade-login.ts";

export default defineEval({
  test: async (t) => gradeLogin(t),
});
```

这条 Eval 的闭包包含 `evals/login.eval.ts` 和 `helpers/grade-login.ts`。Run seal 前，Runner 为闭包内
每个项目文件写入 `niceeval.sources` 的 `SourceItemId`、canonical project-relative path、SHA-256 和
own blob。Report 从 Attempt 的 origin Run 查看当时内容，而不是后来修改过的函数。

## Loader 读取的数据

发现阶段通过 `loadText`、`loadYaml` 或 `loadJson` 读取的项目文件也属于源码闭包：

```ts
const cases = await loadYaml("evals/data/cases.yaml", decodeCases);
```

loader 提供显式 path 和 decode boundary，因此 Runner 可以在运行前把它加入稳定依赖集合。题面、rubric
或数据集变化时，对应 Eval 的 input / behavior identity 会变化；Sources 保存的则是那次运行实际使用的
事实。

## 不从静态闭包猜测动态输入

computed `import()`、直接 `fs.readFile()` 和运行时拼出的路径不由静态 import closure 自动证明。
需要成为 Eval 输入的项目文件应使用 NiceEval loader。Sandbox 运行期间传输的本地文件进入自己的
file-changes 或 Artifact 事实，不冒充 Sources item。

外部 package 的安装、resolution 和 provider 行为同样不由 Sources 自行猜测。它们属于 input、behavior
或 reuse identity，而不是“当前机器上能读取到的源码”。

## 两个用途保持分层

```text
source closure identity
  → 判断当前输入变化是否影响 reuse

niceeval.sources
  → 保存已发生运行的离线核对事实
```

Record 不重新扫描 import，也不判断新的 Eval 输入能否 reuse 历史 Attempt。source-site 持久导航只以 `SourceItemId`、digest
和坐标 join origin Run Sources；它不保存 host path、blob ref 或当前 worktree 位置。

## 相关阅读

- [Sources manifest](../architecture.md#sources-manifest)
- [多个 Attempt 怎样共用源码快照](多个Attempt怎样共用源码快照.md)
- [Eval 数据加载](../../eval/library.md)
