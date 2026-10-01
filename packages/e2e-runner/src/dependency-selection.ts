import { Schema } from "effect";
import { parse } from "yaml";

const record = Schema.Record(Schema.String, Schema.Unknown);
const decodeRecord = Schema.decodeUnknownSync(record);
const decodeLock = Schema.decodeUnknownSync(Schema.Struct({
  lockfileVersion: Schema.Literal("9.0"),
  importers: Schema.Record(Schema.String, record),
  packages: Schema.Record(Schema.String, record),
  snapshots: Schema.Record(Schema.String, record),
}));
const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const stable = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) =>
  entry !== null && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
    : entry);

// Only the root Next installation belongs to the independently checked site.
const rootProductInput = (input: Record<string, unknown>): Record<string, unknown> => {
  const output = { ...input };
  if (output.devDependencies !== undefined) {
    const dependencies = { ...decodeRecord(output.devDependencies) };
    delete dependencies.next;
    output.devDependencies = dependencies;
  }
  return output;
};

/** Compare all manifest fields, retaining unknown fields as shared inputs. */
export const rootManifestAffectsProduct = (before: string, after: string): boolean =>
  stable(rootProductInput(decodeRecord(JSON.parse(before)))) !== stable(rootProductInput(decodeRecord(JSON.parse(after))));

const parseLock = (text: string) => {
  const raw = decodeRecord(parse(text));
  return { raw, lock: decodeLock(raw) };
};

const importerFingerprint = (parsed: ReturnType<typeof parseLock>, id: string): string => {
  const original = parsed.lock.importers[id];
  if (original === undefined) return "absent";
  const importer = id === "." ? rootProductInput(original) : original;
  const closure = new Map<string, unknown>();
  const visit = (name: string, version: string): void => {
    if (version.startsWith("link:")) return;
    const key = `${name}@${version}`;
    // Aliases contain the target package name in the resolved version.
    const resolved = parsed.lock.snapshots[key] === undefined ? version : key;
    if (closure.has(resolved)) return;
    const snapshot = parsed.lock.snapshots[resolved];
    const packageKey = resolved.replace(/\(.*$/, "");
    const metadata = parsed.lock.packages[packageKey];
    if (snapshot === undefined || metadata === undefined) throw new Error(`Incomplete dependency closure: ${id}: ${resolved}`);
    closure.set(resolved, { snapshot, metadata });
    for (const group of ["dependencies", "optionalDependencies"] as const) {
      for (const [dependency, target] of Object.entries(decodeRecord(snapshot[group] ?? {}))) {
        visit(dependency, Schema.decodeUnknownSync(Schema.String)(target));
      }
    }
  };
  for (const group of dependencyGroups) {
    for (const [name, dependency] of Object.entries(decodeRecord(importer[group] ?? {}))) {
      const resolved = Schema.decodeUnknownSync(Schema.Struct({ specifier: Schema.String, version: Schema.String }))(dependency);
      visit(name, resolved.version);
    }
  }
  return stable({ importer, closure: Object.fromEntries(closure) });
};

/** Return importer roots, or the shared root when lock settings change. */
export const changedLockImporters = (before: string, after: string): readonly string[] => {
  const left = parseLock(before);
  const right = parseLock(after);
  const settings = (raw: Record<string, unknown>) => Object.fromEntries(Object.entries(raw)
    .filter(([key]) => !["importers", "packages", "snapshots"].includes(key)));
  if (stable(settings(left.raw)) !== stable(settings(right.raw))) return ["."];
  return [...new Set([...Object.keys(left.lock.importers), ...Object.keys(right.lock.importers)])]
    .filter((id) => importerFingerprint(left, id) !== importerFingerprint(right, id)).sort();
};
