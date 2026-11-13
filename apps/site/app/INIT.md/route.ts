import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Emit the promoted stable guide into the deployment at build time. A public symlink
// outside the site directory is not a self-contained deployment asset.
export const dynamic = "force-static";

export async function GET() {
  const guide = await readFile(resolve(process.cwd(), "stable/INIT.md"), "utf8");
  return new Response(guide, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
