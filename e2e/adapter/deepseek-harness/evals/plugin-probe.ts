export const DSH_PLUGIN = {
  name: "@deepseek-ai/dsh-experimental-agent-team-profile",
  version: "0.1.7-rc.2",
  tool: "team_task_list",
} as const;

export const DSH_LOOPBACK_REPLY = "DSH-PLUGIN-LOOPBACK";

// Runs inside the Sandbox so the real CLI can reach the fixture without any model credentials or external network.
export const DSH_PLUGIN_PROBE = String.raw`
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

const dshHome = join(process.env.HOME, ".niceeval-dsh");
const manifest = JSON.parse(await readFile(join(dshHome, "profiles/headless/package.json"), "utf8"));
const plugin = ${JSON.stringify(DSH_PLUGIN)};
const installed = manifest.dependencies?.[plugin.name] === plugin.version &&
  manifest.dsh?.profile?.bundles?.includes(plugin.name) === true;

let firstRequestTools;
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/messages") {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const { model, tools } = JSON.parse(Buffer.concat(chunks).toString());
  firstRequestTools ??= (tools ?? []).map(({ name }) => name);
  const events = [
    { type: "message_start", message: {
      id: "loopback", type: "message", role: "assistant", model, content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 },
    } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ${JSON.stringify(DSH_LOOPBACK_REPLY)} } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(events.map((event) => "event: " + event.type + "\ndata: " + JSON.stringify(event) + "\n\n").join(""));
});

try {
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { stdout } = await promisify(execFile)("dsh", ["--profile", "headless", "Reply once."], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: "1",
      DEEPSEEK_API_KEY: "fixture-only",
      DEEPSEEK_BASE_URL: "http://127.0.0.1:" + server.address().port + "/v1",
    },
    timeout: 15_000,
  });
  console.log(JSON.stringify({ installed, reply: stdout.trim(), firstRequestTools: firstRequestTools ?? [] }));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
`;
