/** A provider-owned native plugin pinned to one immutable npm version. */
export interface ExactNpmPlugin {
  readonly name: string;
  readonly version: string;
  readonly spec: string;
}

const PACKAGE = String.raw`(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*`;
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
const EXACT_NPM_SPEC = new RegExp(`^(${PACKAGE})@(${VERSION})$`);

/** Keep declaration order, but reject tags/ranges/duplicates before a Sandbox is created. */
export function normalizeExactNpmPlugins(
  input: readonly string[] | undefined,
  label: string,
): readonly ExactNpmPlugin[] {
  const seen = new Set<string>();
  return Object.freeze((input ?? []).map((raw, index) => {
    const spec = raw.trim();
    const match = EXACT_NPM_SPEC.exec(spec);
    if (match === null) {
      throw new TypeError(
        `${label}[${index}] must be an exact npm package@version (tags and ranges are not accepted).`,
      );
    }
    const [, name, version] = match;
    if (seen.has(name)) throw new TypeError(`${label} contains duplicate package ${name}.`);
    seen.add(name);
    return Object.freeze({ name, version, spec });
  }));
}

/** Readable identity: the normalized declaration itself is persisted in agentInstalls/config identity. */
export function exactNpmPluginRevision(plugins: readonly ExactNpmPlugin[]): string {
  return `exact-npm-v1:${plugins.map((plugin) => plugin.spec).join(",")}`;
}
