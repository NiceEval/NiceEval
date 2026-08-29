import {
  createE2EContext,
  type ArtifactStageEntry,
} from "@niceeval/testkit";
import { join, resolve } from "node:path";

/**
 * 每个 owner 在自己的副本内通过安装后 CLI 生成 Record；这里仅声明副本
 * 生命周期和 candidate 的 node_modules 链接，不隐藏产品 argv 或 expected。
 */
export const inspectionProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-inspection-",
  omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

/**
 * Inspection Repo 的机械 E2E context。每个 owner 保留完整公开 argv 与 expected。
 */
export const inspectionE2E = createE2EContext({
  repoId: "inspection",
  project: inspectionProjectCopy,
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

/**
 * 失败时只收集本 case 由公开 `exp` 产生的 opaque Record。
 */
export function inspectionCaseArtifacts(): readonly ArtifactStageEntry[] {
  return [
    { source: ".niceeval", target: ".niceeval", optional: true },
  ];
}
