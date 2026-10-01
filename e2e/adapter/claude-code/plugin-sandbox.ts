import { shell, uploadDirectory } from "niceeval/sandbox";
import { sandbox } from "./sandbox.ts";

export const pluginMarketplacePath = "/tmp/niceeval-e2e-plugin-marketplace";

export const pluginSandbox = sandbox
  .before(uploadDirectory({
    id: "plugin-marketplace",
    source: new URL("./fixtures/plugin-marketplace/", import.meta.url),
    to: pluginMarketplacePath,
  }))
  .before(shell({
    id: "plugin-mcp-server",
    command: "npm install --prefix /tmp/niceeval-e2e-plugin-fixture --no-save --no-package-lock @modelcontextprotocol/server-everything@2026.7.4",
  }));
