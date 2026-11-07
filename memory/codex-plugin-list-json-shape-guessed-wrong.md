# `codex plugin list --json` 的真实输出形状被猜错，`installedVersion` 对任何真实安装恒返回 undefined

**现象**：`src/agents/codex.ts` 的 `installedVersion()` 解析 `codex plugin list --json --marketplace <name>`
的输出时,按 `Array.isArray(raw) ? raw : (raw.plugins ?? [])` 取列表、按 `p.id` 匹配。真实
`codex-cli 0.144.1` 跑这个命令,输出是:

```json
{ "installed": [{ "pluginId": "commit@duyet-claude-plugins", "name": "commit", "version": "1.3.2", ... }],
  "available": [] }
```

顶层键是 `installed`(不是 `plugins`),已安装条目的标识字段是 `pluginId`(不是 `id`)。旧解析逻辑
两个假设全部落空:`Array.isArray(raw)` 为 false,`raw.plugins` 是 `undefined`,`?? []` 兜成空数组,
`.find()` 找不到任何条目,函数稳定返回 `undefined`——`resolvedVersion` 在生产环境**对任何一次真实
安装都会被省略**,不是「偶尔取不到」的兜底分支,是这条路径从一开始就没对过。

`src/agents/codex.test.ts` 原有两条 `resolvedVersion` 单测分别构造了「裸数组、按 `id` 命中」和
「`{ plugins: [...] }`、按 `name` 命中」两种形状,两种都是猜的,`FakeSandbox` 的 canned response
让测试测出「解析逻辑内部自洽」而不是「解析逻辑对得上真实 CLI」——真实 CLI 输出的第三种形状
(`{ installed: [...] }` + `pluginId`)完全没被覆盖过。

**根因**：实现时没有对着真实 `codex plugin list --json` 输出核对字段名,凭直觉起了 `plugins`/`id`
这两个看起来合理但不存在的键名(对照 claude-code 侧 `claude plugin list --json` 输出确实是裸数组
+ `id` 字段,两边字段名不能类推)。

**修法**：`installedVersion()` 改为优先读 `raw.installed`(保留裸数组分支做前向兼容),条目匹配
字段优先 `pluginId`,`id`/`name` 作为后备(修在 `src/agents/codex.ts`)。`src/agents/codex.test.ts`
的两条旧测试改成真实形状 + 一条新增用例显式证伪旧猜测的 `{ plugins: [...] }` 形状不再命中
(`resolvedVersion 取不到时优雅省略:list 输出旧的 { plugins: [...] } 猜测形状...不再命中`)。

**发现方式**：不是代码审查,是 e2e/projects/codex 的 native plugin 真机验收(见
[[native-plugin-marketplace-name-not-caller-assignable]] 用的同一个 fixture,
`duyet/codex-claude-plugins` commit `82de4021a311034a9596e891baf3a8266fb33bf7` 的 `commit` plugin)
真跑出来的:`t.check(plugin?.resolvedVersion, equals("1.3.2"))` 断言失败,连带暴露了
[[brief-crashes-on-preview-undefined]]。修复后同一 fixture 复跑两次(`node ../../../bin/niceeval.js
exp native-plugin --force`)均 `resolvedVersion: "1.3.2"` 正确落 manifest,`verify-agent-setup.mts`
深等通过。

已修复:`src/agents/codex.ts` `installedVersion()`(2026-07-13,native plugin 真机 e2e 复现并当场修复)。
