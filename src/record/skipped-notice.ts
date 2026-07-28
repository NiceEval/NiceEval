// 把 unreadable 目录按 producer 版本分组——被跳过的 niceeval 自身落盘(incompatible)
// 里,同一个 producer.version 的往往不止一份,给每份重复拼同一条 npx 提示没有意义。
// 中性 results 层实现,show / view 两个宿主共用同一份分组结果,各自按自己的 CLI 语法
// (show 走 `--run <结果根>`,view 走单快照路径)拼各自的命令文案。

import type { Producer, UnreadableRun } from "./types.ts";

/** 一组「同一 niceeval 版本写的、schemaVersion 不兼容」的落盘。 */
export interface SkippedVersionGroup {
  schemaVersion: number | undefined;
  producer: Producer;
  /** 该组下每份落盘的目录(绝对路径),保留原始顺序。 */
  dirs: string[];
}

/**
 * 把 `unreadable` 拆成「可按版本分组给出统一 npx 建议的」与「其余原样列出的」两部分。
 * 只有 reason 为 `incompatible` 且 `producer.name === "niceeval"`、`producer.version`
 * 存在时才分组——第三方 harness 如实报名字版本、不拼 npx(docs/feature/record/library.md 的裁决);
 * 版本信息缺失时也没有可执行的统一建议,归入 `rest`。分组键是 `(producer.version, schemaVersion)`,
 * 因为同一 producer.version 理论上 schemaVersion 恒定,但落盘可能来自更旧的 patch 版本,
 * 拆开更保守。
 */
export function groupIncompatibleVersionSkips(unreadable: readonly UnreadableRun[]): {
  groups: SkippedVersionGroup[];
  rest: UnreadableRun[];
} {
  const byKey = new Map<string, SkippedVersionGroup>();
  const rest: UnreadableRun[] = [];
  for (const s of unreadable) {
    if (s.reason === "incompatible" && s.producer?.name === "niceeval" && s.producer.version) {
      const key = `${s.producer.version}\u0000${s.schemaVersion ?? ""}`;
      let group = byKey.get(key);
      if (!group) {
        group = { schemaVersion: s.schemaVersion, producer: s.producer, dirs: [] };
        byKey.set(key, group);
      }
      group.dirs.push(s.dir);
    } else {
      rest.push(s);
    }
  }
  return { groups: [...byKey.values()], rest };
}
