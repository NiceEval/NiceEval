import { createE2EContext } from "@niceeval/testkit";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { expect } from "vitest";
export const context = createE2EContext({
  repoId: "instabox",
  project: {
    from: process.cwd(),
    prefix: "niceeval-instabox-",
    omitTopLevel: ["node_modules", "test", ".niceeval", ".e2e-artifacts"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [resolve("node_modules/.bin/niceeval")] },
});
// Real Provider boundary only: prove cleanup without consulting product storage.
export async function verifyMachinesAbsent(receipt: string): Promise<void> {
  const ids = (await readFile(receipt, "utf8")).trim().split("\n");
  for (const id of ids) {
    const url = `https://api.instabox.sh/v1/machines/${encodeURIComponent(id)}`;
    const headers = { "X-API-Key": process.env.INSTABOX_API_KEY! };
    const response = await fetch(url, { headers });
    const status = response.status;
    if (status !== 404) {
      const deleted = await fetch(url, { method: "DELETE", headers: { ...headers, "X-Confirm-Delete": id } });
      if (!deleted.ok) throw new Error(`Test Machine cleanup failed: HTTP ${deleted.status}`);
      const operation = await deleted.json();
      const done = await fetch(`https://api.instabox.sh/v1/operations/${operation.id}?wait=25s`, { headers });
      expect((await done.json()).state).toBe("succeeded");
    }
    console.info(`Machine ${id}: provider cleanup HTTP ${status}`);
    expect(status, "Machine must already be deleted when the CLI settles").toBe(404);
  }
}
