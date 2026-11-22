import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Deployment configuration stays in Secrets. Never print raw network errors.
const names = [
  "E2E_MODEL_BASE_URL", "E2E_MODEL_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_KEY",
  "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "OPENCODE_API_KEY", "TS_AUTHKEY",
];
export function sensitiveValues(env) {
  const values = new Set();
  for (const name of names) {
    const value = env[name];
    if (!value) continue;
    values.add(value);
    if (name.endsWith("BASE_URL")) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new Error("Invalid model endpoint configuration");
      }
      values.add(url.origin);
      values.add(url.hostname);
    }
  }
  for (const value of [...values]) {
    values.add(encodeURIComponent(value));
    values.add(value.replaceAll("/", "\\/"));
  }
  return [...values].sort((a, b) => b.length - a.length);
}
export function redactArtifacts(source, destination, values) {
  if (fs.existsSync(destination)) throw new Error("Artifact destination must be new");
  fs.mkdirSync(destination, { recursive: true });
  if (!fs.existsSync(source)) return;
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error("Artifact root must not be a link");
  const extensions = new Set([".json", ".jsonl", ".md", ".txt", ".log", ".xml", ".yaml", ".yml", ".csv", ".html"]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(source, file);
      // Do not publish sensitive path names, symlinks, archives or binary traces.
      if (values.some((value) => relative.includes(value))) continue;
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile() || !extensions.has(path.extname(file))) continue;
      const bytes = fs.readFileSync(file);
      if (bytes.includes(0)) continue;
      let text;
      try { text = decoder.decode(bytes); } catch { continue; }
      for (const value of values) text = text.split(value).join("<redacted>");
      const target = path.join(destination, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    }
  }
  walk(source);
}
async function main() {
  const values = sensitiveValues(process.env);
  switch (process.argv[2]) {
    case "mask":
      for (const value of values) {
        console.log(`::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
      }
      break;
    case "artifacts":
      redactArtifacts(process.env.ARTIFACT_SOURCE, process.env.ARTIFACT_SAFE, values);
      console.log("Sanitized text artifacts prepared; binary files and links excluded.");
      break;
    default:
      throw new Error("Unknown privacy operation");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Model privacy operation failed; no raw diagnostics are emitted.");
    process.exitCode = 1;
  });
}
