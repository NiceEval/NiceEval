# 实验改名与结果重绑

Experiment 的 id 由 `experiments/` 下的文件路径决定。实验文件改名会产生新的 `experimentId`；历史结果不会自动跨越这个身份边界。

`niceeval exp rename` 让作者显式声明旧 id 的结果现在归属于新 id，并把旧 id 下的终态结果重绑到新 id。这个命令本身就是人工授权边界：它不要求新旧 fingerprint 相同。迁移不运行 Eval、Agent 或 Sandbox，不修改旧记录，并为每条新结果保留可追溯的来源证据。

## 命令

```bash
# 只读预览
niceeval exp rename codex codex-5.6-luna --dry

# 执行迁移
niceeval exp rename codex codex-5.6-luna

# 机器可读的单份计划或结果文档
niceeval exp rename codex codex-5.6-luna --json
```

命令只支持一个旧 id 到一个新 id。旧 id 从 Record 读取；新 id 必须由当前项目的 `experiments/` 发现。命令不移动实验源码，也不删除或改写旧结果树。

`--dry` 与正式执行使用同一份完整预检。预览逐条列出将迁移的 eval、来源 locator、目标身份，以及被排除或阻断的原因；它不创建目录或写入文件。`--json` 输出一个 JSON 文档，不输出 NDJSON 事件流。

## 迁移资格

命令在写盘前完成整批预检。以下条件必须同时成立：

1. `oldId` 与 `newId` 不同。
2. `oldId` 下至少有一条当前 Record reader 可读的终态历史。
3. `newId` 是当前项目发现到的 Experiment；`oldId` 是否仍能从源码发现不影响迁移。
4. 候选 eval 仍由 `newId` 当前选中。
5. 候选结果的 verdict 是 `passed` 或 `failed`；`errored` 与 `skipped` 不迁移。
6. `newId` 下不存在同一 eval 的任何终态结果。
7. 所有候选都能保留其 artifact 引用，且来源 locator 可唯一解析。

命令用新实验当前解析结果计算目标 fingerprint，让后续运行能直接 carry；原 fingerprint 只作为来源审计写进 `renamedFrom`。因此即使配置身份或物理规划产生了差异，显式 rename 仍会重绑结果。作者必须只在确认这些旧结果应归入新实验时执行正式命令，并先用 `--dry` 核对范围。

旧实验含有新实验不再选择的 eval 时，这些条目列为 `excluded`，不进入迁移，也不阻断其它合格条目。除此之外，任何资格错误都使整批零写入。命令不提供覆盖优先级，不以旧结果替换新 id 下已有结果。

## 写盘结果

正式执行为 `newId` 创建一个已封口 snapshot。该 snapshot 的 `knownEvalIds`、物理 attempts 与 manifest 集合覆盖本批全部迁移条目；运行期选择计划不进入结果配置。

每条迁移结果：

- 使用 `newId`、当前 configHash、当前 fingerprint 与新的 locator；
- 保留 verdict、assertions、usage、timing 与证据 artifact；
- 通过 `artifactBase` 引用来源证据，不复制或硬链 artifact；
- 写入 `renamedFrom`，记录旧 experimentId、旧 locator、迁移时刻与原 fingerprint。

```ts
interface RenamedResult {
  experimentId: string;
  locator: string;
  fingerprint: string;
  at: string;
}

interface EvalResult {
  renamedFrom?: RenamedResult;
}
```

`renamedFrom` 与 `acceptedFrom` 是不同的审计事实。前者由人确认跨 Experiment 身份的结果归属，并把结果锚定到新身份的当前 fingerprint；后者在同一实验身份中确认 fingerprint 差异。迁移自带新的 Record schemaVersion，旧 reader 按既有版本纪律拒绝读取，不对字段使用 sidecar。

旧结果树保持原样，因此迁移失败可直接修正当前实验后重试；迁移成功也不会让旧历史消失。`show --exp <oldId>` 与 `show --exp <newId>` 仍分别读取两个命名空间，不把二者静默合并。

迁移不携带活锁、Session、进行中的 Run、Sandbox 实例或留存状态。报告和后续 carry 只把新 snapshot 当作 `newId` 的结果；读取面可以用 `renamedFrom` 解释来源。

## 与 carry 和 accept 的边界

| 动作 | 身份变化 | fingerprint | 授权结果 |
|---|---|---|---|
| carry | 无 | 相同 | 自动沿用历史结果 |
| accept | 无 | 不同 | 人工重锚到当前 fingerprint |
| exp rename | experimentId 改变 | 锚定到新身份当前值 | 人工重绑结果归属并留下 `renamedFrom` |

三个动作共用 fingerprint 与 manifest 的比较实现，不建立第二套配置等价算法。

## 失败反馈

人读错误必须点名旧 id、新 id、受影响 eval，以及可以执行的下一步。机器输出使用稳定的 reason：

- `source-empty`
- `target-not-found`
- `target-has-results`
- `source-unreadable`
- `artifact-unavailable`
- `nothing-to-migrate`

目标已有结果时列出冲突 eval，提示保留目标结果或显式清理目标历史后重新预览；命令自身不删除数据。

## 验收

1. 文件从 `codex.ts` 改名为 `codex-5.6-luna.ts` 且配置未变时，迁移后 `exp codex-5.6-luna --dry` 把迁入的 passed/failed 规划为 carried。
2. 即使旧 fingerprint 与新实验当前 fingerprint 不同，迁移仍写入新 fingerprint，并在 `renamedFrom.fingerprint` 保留旧值。
3. 多条合格结果只生成一个 snapshot，每条有新 locator，且 `show` 能经 `artifactBase` 读取原证据。
4. `renamedFrom` 能把每条新结果追溯到旧 id 与旧 locator，并与 `acceptedFrom` 区分。
5. 目标已有任一冲突结果时整批零写入；旧结果树在成功和失败路径都逐字不变。
6. `--dry` 不写盘；`--json` 的计划、拒绝与成功形状稳定且不混入人读文本。
