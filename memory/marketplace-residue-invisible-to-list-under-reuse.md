# 复用沙箱下 marketplace 残根对 list 不可见,按回读列表收敛摘不到它

## 现象

`plugins` + `sandboxReuse: true` 的实验(MemoryBench nowledge 条件,e2b),每条泳道第 1 题通过,
第 2 题起全部死在 agent setup:
`Error: marketplace 'nowledge-community' is already added from a different source; remove it before adding this source`。
2026-07-30 首次 36 条批次 4 过 29 死;修复第一版(按 `marketplace list --json` 回读播种、可见才摘)
在 dev-e2b 3-attempt 冒烟里原样复死——list 回读是 `{"marketplaces": []}`,add 仍报同名冲突。
另一个观察:终端 FAILURES 里这条错误的 tail 是空行,完整正文只在 attempt 的 `result.json` 里。

## 根因

codex 的 marketplace 注册状态分两半:`config.toml` 的 `[marketplaces.<name>]` 表(source / sparse_paths),
和磁盘上的 marketplace 数据目录。adapter 安装顺序第 1 步把声明的 `configFile` **整层替换**进
`config.toml`——复用沙箱的第 2 条 attempt 上,这一步抹掉了第 1 条 attempt 写进去的注册表项,
磁盘目录却还在。此后 `marketplace list --json` 只读 config、报空;`marketplace add` 却检查磁盘残根,
报「同名不同源」。所以「按 list 可见才摘」的收敛在这个形态上必然摘不到。

两个曾经的错误归因,都被本地隔离 `CODEX_HOME` 复现推翻:
- 「插件的 install_hooks.py 把注册改写成托管源」——该脚本根本不碰 marketplace(拉源码核实);
- 「同源重加本身不幂等」——同源同 sparse 的重复 add 是 exit 0 的空操作。
真正触发「不同源」的唯一步骤是 config 整层替换 + 磁盘残根的组合。

## 修法

摘除无条件化(commit 见本条同批;契约在
`docs/feature/adapters/architecture/coding-agent-extensions.md`「安装收敛:不假设沙箱空白」):

- marketplace:每条 attempt 按声明名字直接 `plugin marketplace remove <name>`,不先查 list。
  真机事实:remove 对 config 里没有、只剩磁盘残根的注册照样清得掉(rc=0);对真不存在 rc=1
  (`is not configured or installed` / claude `not found`),按已收敛容忍。摘除的其它失败也不单独
  报错——紧随其后的 add 是权威失败面,摘不干净它带着 CLI 原话失败。
- Plugin:list 驱动移除同名安装(卸得掉的都卸),`plugin add` 对 cache 残留是收编而非报错
  (真机:`codex plugin remove` 幂等 rc=0,重复 remove 也 rc=0)。
- 落点:`src/agents/codex.ts`、`src/agents/claude-code.ts`、`src/agents/marketplace.ts`。
  验证:MemoryBench `dev-e2b/codex-e2b--nowledge`(复用 1 泳道 × 3 attempts,判据是第 2、3 条的
  agent setup)。

适用场景:任何「CLI 状态分两半、一半被我们整层重写」的收敛都别信单边回读;
摘除类命令能容忍不存在时,无条件执行 + 让后继的建设性命令当权威失败面,比「先查再摘」可靠。
关联:[[native-plugin-marketplace-name-not-caller-assignable]]、[[codex-plugin-list-json-shape-guessed-wrong]]。
