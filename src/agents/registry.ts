// agent 注册表:按名字选(--agent <name>)。核心只认 Agent 契约,不按名字分支。

import type { Agent } from "../types.ts";
import { t } from "../i18n/index.ts";

export function buildRegistry(agents: readonly Agent[]): Map<string, Agent> {
  const m = new Map<string, Agent>();
  for (const a of agents) m.set(a.name, a);
  return m;
}

export function resolveAgent(registry: Map<string, Agent>, name: string): Agent {
  const a = registry.get(name);
  if (!a) {
    const known = [...registry.keys()].join(", ") || t("cli.none");
    throw new Error(t("agent.unknown", { name, known }));
  }
  return a;
}
