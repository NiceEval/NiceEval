# `--rerun`:上一轮的结果哪些还算数

## 解决什么问题

默认口径下,上一轮判定为终态(`passed` / `failed`)的结果都算数:指纹未变就携带合入本次 Run,不重花 agent / sandbox 成本,本次只跑 `errored` / `skipped` 与计划内缺失的 attempt 序号。但有两种时刻,历史判定不该继续算数:

- **修了被测对象,要复验失败项。** 改了 agent 的 prompt、修了被测服务的 bug——这些都不在指纹里,失败的那几条不会自动重跑,而已通过的那些没必要再花一次钱。
- **外部世界变了,整批都不可信。** agent CLI 升了级、沙箱镜像里的依赖被重建。这时携带的旧「绿」掩盖的可能是真实回归:你以为在验证现状,其实在复读历史。

`--rerun` 一个旋钮定三档,回答的都是同一个问题——**上一轮的结果哪些还算数**:

| 写法 | 哪些算数 | 本次跑什么 |
|---|---|---|
| 不带 | `passed` 与 `failed` | `errored` / `skipped` / 缺失序号 |
| `--rerun` = `--rerun failed` | 只有 `passed` | 上面那些,加所有 `failed` |
| `--rerun all` | 都不算数 | 选中矩阵的每一条 |

档位词表与 [`--keep-sandbox[=failed|all]`](../../sandbox/cli.md) 同构,裸写都是保守的 `failed` 档。

## 全流程:修了 agent,只复验失败项

1. 上一轮 5 条里 1 条失败。直接重跑同一条命令,全部命中缓存——`failed` 也是确定的终态,默认算数:

   ```text
   │ 5 of 5 carried in from cache · 0 to run                                       │
   ```

2. 改了 agent 的 prompt(不在指纹里),要复验那一条。不必去结果树里挖失败的 eval id——按判定收窄就够了:

   ```sh
   niceeval exp compare/bub-e2b --rerun
   ```

   失败面板的 `NEXT` 也直接给这条命令(见 [CLI · 人看的结束反馈](../cli.md#人看的结束反馈))。

3. `PLAN` 面板如实反映新口径:上一轮的 4 条 `passed` 照常携带,只派发那 1 条:

   ```text
   │ 4 of 5 carried in from cache · 1 to run                                       │
   ```

4. 修好后不带 flag 再跑一次,全部命中缓存、零开销确认整组是绿的。

## 全流程:升级了 agent CLI,全量重验

1. 先收窄选择再 `--rerun all`——全量重跑是把矩阵的钱重新花一遍,范围越小越好:

   ```sh
   niceeval exp compare/bub-e2b memory/commit0-cachetool --rerun all
   ```

2. `--rerun all` 关闭携带:计划内每个 attempt 全新派发,没有 `reused`;本次的 tok 与 $ 是完整矩阵的真实开销,没有缓存摊薄(计数与成本口径见 [CLI · 运行中的 live 面板](../cli.md#运行中的-live-面板))。
3. 新结果落成新 Run 并成为下一轮携带的来源;历史 Run 保留,`niceeval view` 仍可对照升级前后的两轮。
4. 确认无回归后回到默认口径:后续 run 按指纹采信这轮产出的终态,「改一个 case 重跑」继续只花那一个 case 的时间(见 [缓存与携带](../cache.md))。

## 边界

- **三档都是一次性口径,不是长期开关。** 它们不改指纹定义,下次不带 flag 的 run 照常按默认口径携带。外部依赖如果频繁变化,把它显式纳入配置让指纹自然失效,比每次手动重跑更可靠(哪些改动会自然失效见[改什么会作废缓存](cache-invalidation.md))。
- **改了 eval 代码或配置不需要它**:指纹自己会变。这包括抽在公共 helper 里的断言、
  经 `loadYaml` / `loadJson` 读进来的数据行,以及裁判模型——它们都在[指纹](../cache.md#指纹两个哈希嵌套)里。
  `errored` / `skipped` 从不缓存、总会重试,也不需要它。
- **不重跑不等于藏起失败。** 默认口径下全部命中缓存的零派发运行,携入的 `failed` 照常进 `FAILURES` 并给下钻命令(见 [CLI · 全部命中缓存](../cli.md#全部命中缓存))——`--rerun` 解决的是「该重验的没重验」,不是「失败被吞掉」。
- **与执行模式的组合**:[`--reuse-sandbox`](../../sandbox/serial-reuse.md) 运行本就不消费携带,`--rerun` 在那里没有作用对象;[`--keep-sandbox`](../../sandbox/cli.md) 的 `failed` 档为了拿现场本就重跑 `failed`,与 `--rerun failed` 的口径一致,叠加不产生新语义。
- coding agent 的自动修复循环正常依赖指纹缓存省钱,改完被测对象用 `--rerun` 复验失败项,只在怀疑缓存口径本身时才上 `--rerun all`(见 [CLI · AI 常见循环](../cli.md#ai-常见循环))。

## 相关阅读

- [缓存与携带](../cache.md) —— 指纹构成、携带粒度、终态定义的单源。
- [改什么会作废缓存](cache-invalidation.md) —— 改哪些东西指纹自己会变,不必动 `--rerun`。
- [Results · 两类条目](../../record/architecture.md#resultjson) —— 携带条目怎样落盘与回指原 artifact。
