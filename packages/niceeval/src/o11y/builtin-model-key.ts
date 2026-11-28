export function builtinModelKeys(model: string): readonly string[] {
  const bare = model.slice(model.lastIndexOf("/") + 1);
  const undated = bare.replace(/-\d{8}$/u, "").replace(/-\d{4}-\d{2}-\d{2}$/u, "");
  return [model, bare, undated];
}
