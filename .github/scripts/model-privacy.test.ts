import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sensitiveValues, redactArtifacts } from "./model-privacy.ts";

test("failure artifacts remove endpoint variants and keys without following links or publishing archives", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-privacy-"));
  try {
    const source = path.join(root, "raw"), destination = path.join(root, "safe");
    fs.mkdirSync(source);
    const endpoint = "https://private-model.example/v1";
    const key = "test-only-key-not-a-credential";
    const values = sensitiveValues({ OPENAI_BASE_URL: endpoint, OPENAI_API_KEY: key });
    fs.writeFileSync(path.join(source, "failure.log"), [endpoint, "private-model.example", key, encodeURIComponent(endpoint), endpoint.replaceAll("/", "\\/"), "controlled failure"].join("\n"));
    fs.writeFileSync(path.join(source, "trace.zip"), endpoint);
    fs.writeFileSync(path.join(source, "binary.json"), Buffer.from([0xff, 0xfe]));
    fs.writeFileSync(path.join(source, "nul.log"), "before\0after");
    fs.writeFileSync(path.join(root, "outside.log"), "outside");
    fs.symlinkSync(path.join(root, "outside.log"), path.join(source, "linked.log"));
    fs.writeFileSync(path.join(source, "private-model.example.log"), "sensitive filename");
    redactArtifacts(source, destination, values);
    assert.deepEqual(fs.readdirSync(destination), ["failure.log"]);
    const report = fs.readFileSync(path.join(destination, "failure.log"), "utf8");
    for (const value of values) assert.equal(report.includes(value), false);
    assert.match(report, /controlled failure/);
    assert.match(fs.readFileSync(path.join(source, "failure.log"), "utf8"), /private-model/);
    assert.throws(() => redactArtifacts(source, destination, values));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("endpoint validation fails closed without reflecting input", () => {
  for (const value of ["http://private.example", "https://user:pass@private.example", "https://private.example/?secret=value"]) {
    assert.throws(() => sensitiveValues({ E2E_MODEL_BASE_URL: value }), { message: "Invalid model endpoint configuration" });
  }
});
