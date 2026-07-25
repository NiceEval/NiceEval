# 裁决:缓存口径收敛成 `--rerun` 三档,`--force` 删除

**裁决**(2026-07-25)。「上一轮的结果哪些还算数」是一根轴,给一个旋钮三档:

| 写法 | 算数的判定 | 本次跑什么 |
|---|---|---|
| 不带 | `passed` + `failed` | `errored` / `skipped` / 缺失序号 |
| `--rerun` = `--rerun failed` | 只有 `passed` | 上面那些,加全部 `failed` |
| `--rerun all` | 无 | 选中矩阵每一条 |

档位词表与 `--keep-sandbox[=failed|all]` 同构,裸写都是保守的 `failed` 档。`--force` 整体删除
(它就是 `--rerun all`)。

**起因。** 真实使用里最常见的动作没有档位:改了**不在指纹里**的东西(agent 的 prompt、被测服务的
实现)之后想复验失败项。不加 flag 是 `5 of 5 carried in from cache · 0 to run`(`failed` 也是可复用
终态),加 `--force` 连 4 条 `passed` 一起重烧。只能手工把失败的 eval id 列在命令行上——而那些 id
还得自己从 `.niceeval/` 里挖(`show` 的表格被终端宽度截成几个字符、`COLUMNS=200` 不生效,最后是写
node 脚本遍历 `result.json` 拿到的,见
[show-table-truncates-identity-columns](show-table-truncates-identity-columns.md))。

**否决「加一个 `--retry-failed` 布尔 flag」。** 两个布尔表达同一根轴,要额外定义组合语义
(`--force --retry-failed` 是什么?),而且不消除用户抱怨的那件事——`--force` 的名字不告诉你它是
「全部」而不是「该重跑的」。一根轴一个旋钮,三档在 `--help` 一行里同时可见,反直觉自然消失。

**这个档位本来就存在,只是拿不到。** `--keep-sandbox=failed` 为了留现场,内部早就在做「`passed`
携带、`failed` 重跑」;`--rerun failed` 是把那个口径拆出来独立可用,不是新机制。

**配套(同批定稿在 docs)。** 结束反馈的 `NEXT` 面板在有失败时多一行
`Retry: niceeval exp <本次位置参数> --rerun`——按判定收窄本来就不需要 id,操作者不必再去挖清单;
全部命中缓存的零派发运行里这一行尤其是要的那条命令。

落点:`docs/runner.md`「缓存:指纹去重」、`docs/feature/experiments/use-case/rerun.md`(原 force.md)、
`docs/feature/experiments/cli.md`(flag 表 + NEXT 面板 + AI 循环)。
