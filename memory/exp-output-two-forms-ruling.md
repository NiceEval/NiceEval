---
format: concord.document/v1
id: exp-output-two-forms-ruling
title: 裁决:exp 输出收敛为「人读文本 + `--json`」,`--output` 三档 profile 删除(2026-07-23)
createdAt: 2026-07-23T16:46:08+08:00
createdAtSource:
  kind: first-recorded
  path: memory/exp-output-two-forms-ruling.md
  commit: 2c473122456b4472c361ddfa2890918c3c88f1b1
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---
# 裁决:exp 输出收敛为「人读文本 + `--json`」,`--output` 三档 profile 删除(2026-07-23)

**裁决**:`niceeval exp` 与 `show` 对齐为全 CLI 统一原则——**每条命令一个人读 text 面,`--json` 是机器面**。`--output human|agent|ci` 整个删除:不加 flag 是人读文本(TTY live 面板,非 TTY 自动降级只追加流,CI 日志页用它),`--json` 是 stdout NDJSON 事件流(agent 与 CI adapter 共用)。附带:exp 的 `--json <path>` 聚合文件出口删除(与 boolean 形态冲突;归 `show --json` 重定向或事件流重定向,`Json(path)` 留库 reporter),`NICEEVAL key=value` 与 `niceeval:` 两套自造方言删除(词法就是 JSON)。落 docs:`docs/feature/experiments/cli.md`;实现 TODO 在 `plan/exp-json-machine-form.md`。

**起因**:show 的 `--json` 定稿(见 [[show-scope-slice-json-ruling]])后用户连环追问「agent 档还需要吗」「能不能只有 --json,不加就是人,ci 和 agent 用一套」。逐项对照证实 agent/ci 是同一消费者模型的两套参数(heartbeat 30/60s、上限 5/50、流路由、词法前缀),没有模型差。

**关键认识**:log 档还要自造 `NICEEVAL key=value` 词法,唯一原因是想同时给人和机器读。拆开纠缠即净:人读的追加文本已存在(非 TTY human 降级流,本来就有 start/失败行/心跳/摘要),CI 日志页给人看用它正好;机器要可解析就直接 JSON——自造 envelope 语法(小写词单行/大写词 block、key=value 转义)整个不需要存在。

**曾选方案与否决理由**:

- 三档收敛为 human/log 两档、统一 `NICEEVAL` 词法(同日中间稿,docs 已写又撤)——否决:log 仍是「半人半机」的骑墙形态,既要人扫读又要机器解析,于是自造词法不可避免;按读者拆两面后词法问题消失。
- 机器面用 `RESULT` 多行 block 收尾——随词法一起否决:NDJSON 下 `result` 就是一个普通事件对象,不需要 block 语法。
- `--json` 同时保留 `<path>` 取值(布尔/路径双形态)——否决:`--json foo` 与 eval 前缀位置参数歧义;聚合文件本身冗余——`show --json` 或流重定向信息都更全,唯一的运行期独占事实(completion)已进 `result` 事件。
- auto 档 / CI 环境变量嗅探——随三档一起消失:非交互只有一个人读降级形态,没有第二档可供环境标记区分;机器面永远显式 opt-in,不靠环境猜。
- 失败风暴 suppression 应用到机器面——否决:上限是人的注意力保护,机器逐事件消费,截断反而是信息损失。

**补充裁决(2026-07-23,同日评审)**:非 TTY 人读文本与 `--json` 同规则走单一 stdout 有序流,stderr 只留启动期用法/配置错误;TTY 人读保持 stderr live 面板 + stdout 最终摘要(同一终端设备按写入序交错,无跨流乱序问题)。起因=三档删除稿把「两个 OS stream 被 CI runner 分开缓冲会乱序」的论据只留给了 `--json`,而 CI 日志页(非 TTY 人读)沿用「永久事件走 stderr、摘要走 stdout」的 TTY 边界,回到了旧 ci 档明文要避免的双流乱序;论据保留、结论丢失。同批修掉的还有:observability.md 的 `Json(path)` 仍挂着已删除的 `--json <path>` 接线、early-exit.md 残留 `NICEEVAL` 方言示例、五处 profile 术语残留、exp cli.md 机器面示例 `error` 事件与 `errored:0` 计数矛盾。
