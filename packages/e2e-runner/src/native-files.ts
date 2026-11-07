// @test-file is a NiceEval execution-entry hint, not a Concord marker identity.
export function nativeEntryForSource(declarationFile: string, source: string): string {
  const paths = [...new Set([...source.matchAll(/^\s*\/\/\s*@test-file\s+(\S+)\s*$/gmu)].map(match => match[1]!))];
  if (paths.length === 0) return declarationFile;
  if (paths.length !== 1) throw new Error(`Ambiguous NiceEval native entry for ${declarationFile}`);
  const path = paths[0]!;
  if (!path.startsWith("e2e/") || /[\\\0\r\n]/u.test(path) || path.split("/").some(part => part === "" || part === "." || part === "..")) throw new Error(`Invalid NiceEval native entry: ${path}`);
  return path;
}
