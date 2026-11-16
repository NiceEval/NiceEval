// Built-in factories own reconstruction; the Plugin linker never branches on Agent runtime kind.
import { basename, extname, resolve } from "node:path";
import type { Agent, SkillSpec, McpServer } from "./types.ts";
import type { SandboxCommand } from "../sandbox/commands.ts";
import type { PluginAgentExtensions } from "../plugin/contracts.ts";
import { omitUndefined } from "../shared/omit-undefined.ts";

type CodingAgentKind = "codex" | "claudeCode" | "bub";
interface ExtensionConfig {
  readonly skills?: readonly SkillSpec[] | undefined;
  readonly mcpServers?: readonly McpServer[] | undefined;
  readonly plugins?: readonly { readonly name: string }[] | undefined;
  readonly pythonPlugins?: readonly { readonly package: string }[] | undefined;
  readonly configFile?: string | undefined;
  readonly settingsFile?: string | undefined;
  readonly before?: readonly SandboxCommand[] | undefined;
  readonly after?: readonly SandboxCommand[] | undefined;
}
// 合并补丁边界：显式 undefined 不得抹掉既有配置。
type ExtensionPatch = { readonly [Key in keyof ExtensionConfig]?: Exclude<ExtensionConfig[Key], undefined> };
export interface PluginAgentContribution {
  readonly extension: PluginAgentExtensions;
  readonly source: string;
}
const factories = new WeakMap<Agent, (contributions: readonly PluginAgentContribution[]) => Agent>();
function skillNames(skill: SkillSpec): readonly string[] {
  if (skill.kind === "repo") return skill.skills ?? [];
  if (skill.name !== undefined) return [skill.name];
  const path = resolve(skill.path);
  const file = basename(path);
  if (file.toLowerCase() === "skill.md") return [basename(resolve(path, ".."))];
  if (extname(file).toLowerCase() === ".md") return [basename(file, extname(file))];
  return [file];
}
/** Registration captures factory options without evaluating connection or credential providers. */
export function attachCodingAgentExtensions<Config extends ExtensionConfig>(
  agent: Agent,
  kind: CodingAgentKind,
  config: Config | undefined,
  rebuild: (config: Config) => Agent,
): Agent {
  factories.set(agent, (contributions) => {
    let merged = { ...config };
    const names = new Map<string, string>();
    const unique = (field: string, values: readonly string[], source: string): void => {
      for (const name of values) {
        const id = `${field}:${name}`;
        const previous = names.get(id);
        if (previous !== undefined)
          throw new TypeError(`Duplicate Agent ${field} ${JSON.stringify(name)} at ${previous} and ${source}.`);
        names.set(id, source);
      }
    };
    const record = (value: ExtensionConfig, source: string) => {
      unique("skill", (value.skills ?? []).flatMap(skillNames), source);
      unique(
        "MCP server",
        (value.mcpServers ?? []).map((server) => server.name),
        source,
      );
      unique(
        "native plugin",
        (value.plugins ?? []).map((plugin) => plugin.name),
        source,
      );
      unique(
        "Python plugin",
        (value.pythonPlugins ?? []).map((plugin) => plugin.package),
        source,
      );
      if (value.configFile !== undefined) unique("configFile", ["configFile"], source);
      if (value.settingsFile !== undefined) unique("settingsFile", ["settingsFile"], source);
    };
    record(config ?? {}, `${kind} factory`);
    for (const { extension, source } of contributions) {
      const targeted = ["codex", "claudeCode", "bub"].some((field) => Object.hasOwn(extension, field));
      if (targeted && extension[kind] === undefined)
        throw new TypeError(`${source} has no agent.${kind} extension for the selected Adapter.`);
      if (kind === "bub" && extension.mcpServers !== undefined)
        throw new TypeError(`${source}: Bub does not support agent.mcpServers.`);
      // 合并补丁边界：未提供的扩展不能覆盖已声明的配置。
      const addition: ExtensionPatch = omitUndefined({
        ...extension[kind],
        ...omitUndefined({ skills: extension.skills, mcpServers: extension.mcpServers }),
      });
      record(addition, source);
      const append = <T>(first: readonly T[] | undefined, second: readonly T[] | undefined) =>
        second === undefined ? first : [...(first ?? []), ...second];
      const skills = append(merged.skills, addition.skills);
      const mcpServers = append(merged.mcpServers, addition.mcpServers);
      const before = append(merged.before, addition.before);
      const after = append(merged.after, addition.after);
      const plugins = append(merged.plugins, addition.plugins);
      const pythonPlugins = append(merged.pythonPlugins, addition.pythonPlugins);
      merged = {
        ...merged,
        ...addition,
        ...omitUndefined({ skills, mcpServers, before, after, plugins, pythonPlugins }),
      };
    }
    return rebuild(merged as Config);
  });
  return agent;
}
export function extendCodingAgent(agent: Agent, contributions: readonly PluginAgentContribution[]): Agent {
  if (contributions.length === 0) return agent;
  const extend = factories.get(agent);
  if (extend === undefined)
    throw new TypeError("Plugin agent extensions require a built-in Codex, Claude Code or Bub Adapter.");
  return extend(contributions);
}
