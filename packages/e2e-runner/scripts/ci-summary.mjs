// Render CI transport receipts; this does not decide whether the gate passes.
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const categories = new Set(["pass", "regression", "infra", "configuration", "invalid", "cancelled"]);
const safe = (id) => id.replace(/[^A-Za-z0-9._-]/g, "-");
const escape = (text) =>
  (
    String(text ?? "")
      .split(/\r?\n/)
      .find((line) => line.trim()) ?? ""
  )
    .replaceAll("|", "\\|")
    .replaceAll("`", "'")
    .replaceAll("<", "&lt;");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

export function renderFailures({
  artifactRoot,
  matrix,
  takeoverMatrix,
  takeoverPlan,
  jobs = [],
  matrixResult,
  takeoverResult,
}) {
  const rows = [];
  const job = (kind, id) => jobs.find((entry) => entry.name === `${kind} (${id})`);
  const absent = (kind, id, fallback) => {
    const conclusion = job(kind, id)?.conclusion ?? fallback;
    return {
      category: conclusion === "cancelled" ? "cancelled" : "infra",
      detail: `Job ${conclusion ?? "unknown"}; terminal summary was not produced.`,
    };
  };
  const add = (cell, item, category, detail, receipt) =>
    rows.push([cell, item, categories.has(category) ? category : "invalid", detail, receipt]);
  for (const cell of matrix) {
    const file = join(artifactRoot, `e2e-${safe(cell.id)}`, "summary.json");
    if (!existsSync(file)) {
      const finding = absent("e2e", cell.id, matrixResult);
      add(cell.id, "matrix cell", finding.category, finding.detail, relative(artifactRoot, file));
      continue;
    }
    try {
      const summary = read(file);
      if (!categories.has(summary.category) || !Array.isArray(summary.results)) throw Error("Invalid cell summary");
      const failures = summary.results.filter((result) => result.category !== "pass");
      for (const result of failures)
        add(cell.id, result.id, result.category, result.detail, result.receiptPath ?? file);
      if (summary.category !== "pass" && !failures.length)
        add(cell.id, "matrix cell", summary.category, summary.detail, file);
      if (
        summary.category === "pass" &&
        job("e2e", cell.id)?.conclusion &&
        job("e2e", cell.id).conclusion !== "success"
      ) {
        const finding = absent("e2e", cell.id, matrixResult);
        add(
          cell.id,
          "matrix cell",
          finding.category,
          "Scenarios passed; a surrounding job step failed or was cancelled.",
          file,
        );
      }
    } catch {
      add(
        cell.id,
        "matrix cell",
        "invalid",
        "Terminal summary is malformed or unreadable.",
        relative(artifactRoot, file),
      );
    }
  }
  for (const cell of takeoverMatrix) {
    const directory = join(artifactRoot, `e2e-takeover-${safe(cell.id)}`);
    const owners = takeoverPlan?.cells?.find((entry) => entry.id === cell.id)?.owners;
    const indexes = owners
      ? owners.map((_, index) => String(index))
      : existsSync(directory)
        ? readdirSync(directory)
            .filter((name) => /^\d+$/.test(name))
            .sort((a, b) => Number(a) - Number(b))
        : [];
    if (!indexes.length) {
      const finding = absent("takeover", cell.id, takeoverResult);
      add(
        cell.id,
        "takeover",
        finding.category,
        finding.detail,
        `${relative(artifactRoot, directory)}/takeover-summary.json`,
      );
    }
    let failures = 0;
    for (const index of indexes) {
      const file = join(directory, index, "takeover-summary.json");
      const item = owners?.[Number(index)]?.selector ?? `takeover ${index}`;
      if (!existsSync(file)) {
        const finding = absent("takeover", cell.id, takeoverResult);
        add(cell.id, item, finding.category, finding.detail, relative(artifactRoot, file));
        failures++;
        continue;
      }
      try {
        const summary = read(file);
        if (!categories.has(summary.category) || !Array.isArray(summary.runs)) throw Error("Invalid takeover summary");
        if (summary.category === "pass") continue;
        const first = summary.runs.find((run) => run.category !== "pass");
        add(
          cell.id,
          item,
          summary.category,
          first?.detail ?? summary.detail,
          first?.receiptPath ?? relative(artifactRoot, file),
        );
        failures++;
      } catch {
        add(cell.id, item, "invalid", "Takeover summary is malformed or unreadable.", relative(artifactRoot, file));
        failures++;
      }
    }
    if (
      indexes.length &&
      !failures &&
      job("takeover", cell.id)?.conclusion &&
      job("takeover", cell.id).conclusion !== "success"
    ) {
      const finding = absent("takeover", cell.id, takeoverResult);
      add(
        cell.id,
        "takeover job",
        finding.category,
        "Owners passed; a surrounding job step failed or was cancelled.",
        relative(artifactRoot, directory),
      );
    }
  }
  return [
    "### E2E failure classifications",
    "",
    ...(rows.length
      ? [
          "| Matrix cell | Item | Classification | First diagnostic | Receipt |",
          "| --- | --- | --- | --- | --- |",
          ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
        ]
      : ["No failed matrix cells or takeover items reported."]),
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const planFile = join(env.ARTIFACT_ROOT, "takeover-plan", "e2e-takeover-plan.json");
  appendFileSync(
    env.GITHUB_STEP_SUMMARY,
    renderFailures({
      artifactRoot: resolve(env.ARTIFACT_ROOT),
      matrix: JSON.parse(env.MATRIX_JSON || "[]"),
      takeoverMatrix: JSON.parse(env.TAKEOVER_MATRIX_JSON || "[]"),
      takeoverPlan: existsSync(planFile) ? read(planFile) : undefined,
      jobs: JSON.parse(env.JOBS_JSON || "[]"),
      matrixResult: env.MATRIX_RESULT,
      takeoverResult: env.TAKEOVER_RESULT,
    }),
  );
}
