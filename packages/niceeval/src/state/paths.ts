export function isStatePath(path: string): boolean {
  if (path.includes("\0")) return false;
  const body = path.startsWith("~/") ? path.slice(2) : path.startsWith("/") ? path.slice(1) : "";
  return body.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
