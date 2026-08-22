import type {
  RecordAttachmentMigrationTarget,
  RecordAutomaticMigrationResult,
  RecordMaintenanceOperationFailure,
  RecordMigrateOperationPlan,
} from "../types.ts";

function assertNever(value: never): never {
  throw new Error(`Unreachable Record CLI presentation value: ${String(value)}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function recoveryCommands(restoreCommit: string, recordPath: string): string {
  const root = shellQuote(recordPath);
  const commit = shellQuote(restoreCommit);
  const sentinel = shellQuote(`${recordPath}/migration.in-progress`);
  return [
    `Restore command: git -C ${root} restore --source=${commit} --staged --worktree -- .`,
    `Verify command: git -C ${root} diff --quiet ${commit} -- . && git -C ${root} diff --cached --quiet ${commit} -- .`,
    `Clear sentinel after verification: rm -f -- ${sentinel}`,
  ].join("\n") + "\n";
}

export function renderRecordMaintenanceFailure(
  failure: RecordMaintenanceOperationFailure,
  recordPath: string,
): string {
  switch (failure._tag) {
    case "RecordMaintenanceBusy":
      return `${failure.code}\nClose the Record command holding the lock, then retry.\n`;
    case "RecordMigrationInterrupted":
      return `${failure.code}\n${
        failure.restoreSafe === true
          ? "Restore the complete Record from the recorded Git commit; do not rerun migrate on mixed bytes."
          : "Inspect and preserve concurrent Record edits before choosing a manual recovery; no automatic Git restore command is safe."
      }\n${
        failure.restoreSafe === true && failure.restoreCommit !== undefined
          ? recoveryCommands(failure.restoreCommit, recordPath)
          : ""
      }`;
    case "RecordMigrationPlanStale":
      return `${failure.code}\nReview the new migration plan and rerun migrate.\n`;
    case "RecordMigrationGitRestoreRequired":
      return `${failure.code}\nCommit, restore, or otherwise obtain a clean Git restore point for this Record before migrating.\n`;
    case "RecordMigrationInvalid":
      return `${failure.code}\nRestore the Record from Git before retrying migration.\n`;
    case "RecordMigrationRecoveryRequired":
      return `${failure.code}\n${
        failure.restoreSafe
          ? "Restore the complete Record from Git before retrying migration."
          : "Inspect and preserve concurrent Record edits before choosing a manual recovery; no automatic Git restore command is safe."
      }\nCause: ${failure.causeCode}\n${
        failure.restoreSafe ? recoveryCommands(failure.restoreCommit, recordPath) : ""
      }`;
    case "RecordFormatUnsupported":
      return `${failure.code}\nInstall a NiceEval version that supports this Record format.\n`;
    case "RecordMigrationRequired":
      return `${failure.code}\nRun: niceeval migrate\n`;
    case "RecordMaintenanceOperationFailed":
      return `${failure.code}\n`;
    default:
      return assertNever(failure);
  }
}

function failureCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const code = Reflect.get(value, "code");
  return typeof code === "string" ? code : undefined;
}

/** Shared CLI wording for ordinary-entry automatic migration failures. */
export function renderAutomaticMigrationFailure(error: unknown): string | undefined {
  const code = failureCode(error);
  if (code === "record-auto-migration-git-save-required") {
    return "record-auto-migration-git-save-required\n" +
      "Save every portable Record byte first (for example: git add .niceeval/record && git commit), then retry the same command.\n";
  }
  if (code === "record-maintenance-busy" || code === "record-writer-busy") {
    return `${code}\nClose the command using this Record, then retry.\n`;
  }
  if (code === "record-format-unsupported") {
    return "record-format-unsupported\nUse the NiceEval version that wrote this future or unknown Record format.\n";
  }
  if (code === "record-migration-recovery-required" || code === "record-migration-interrupted") {
    return `${code}\nRestore and verify the complete Record from Git before retrying.\n`;
  }
  return undefined;
}

/** Shared CLI notice emitted exactly once after an automatic migration. */
export function renderAutomaticMigrationResult(
  result: RecordAutomaticMigrationResult,
): string | undefined {
  if (result.state !== "migrated") return undefined;
  const droppedFacts = [...new Set(result.attachments.flatMap(
    (attachment) => attachment.retention.droppedFacts,
  ))];
  const rerunRecommendations = [...new Set(result.attachments.flatMap(
    (attachment) => attachment.retention.rerunRecommendation === null
      ? []
      : [attachment.retention.rerunRecommendation],
  ))];
  return `Record automatically migrated ${result.attachments.length} attachment${
    result.attachments.length === 1 ? "" : "s"
  }; restore commit ${result.restoreCommit}.${
    droppedFacts.length === 0 ? "" : ` Dropped facts: ${droppedFacts.join(", ")}.`
  }${rerunRecommendations.length === 0 ? "" : ` ${rerunRecommendations.join(" ")}`}\n`;
}

function renderMigrationImpact(attachments: readonly RecordAttachmentMigrationTarget[]): string {
  return [...new Map(attachments.map((attachment) => {
    const key = `${attachment.family}@${attachment.fromSchemaVersion}->${attachment.toSchemaVersion}`;
    return [key, attachment] as const;
  })).values()].map((attachment) => {
    const retention = attachment.retention;
    const lines = [
      `impact ${attachment.family}@${attachment.fromSchemaVersion}->${attachment.toSchemaVersion}:`,
      `  retained facts: ${retention.retainedFacts.length === 0 ? "none" : retention.retainedFacts.join(", ")}`,
      `  dropped facts: ${retention.droppedFacts.length === 0 ? "none" : retention.droppedFacts.join(", ")}`,
    ];
    if (retention.rerunRecommendation !== null) {
      lines.push(`  rerun recommendation: ${retention.rerunRecommendation}`);
    }
    return lines.join("\n");
  }).join("\n");
}

export function renderMigrationPlan(plan: RecordMigrateOperationPlan): string {
  switch (plan._tag) {
    case "RecordMigrationAlreadyCurrent":
      return `Record migration plan: already-current\nformat: ${plan.format}\n`;
    case "RecordMigrationUnsupported":
      return `Record migration plan: unsupported-format\nformat: ${plan.format}\n`;
    case "RecordMigrationRestoreRequired": {
      const impact = renderMigrationImpact(plan.attachments);
      return `Record migration plan: migration-required\nformat: ${plan.format}\nattachments: ${plan.attachments.length}\n${
        impact === "" ? "" : `${impact}\n`
      }backup: ${plan.backup.state}\n`;
    }
    case "RecordMigrationReady": {
      const impact = renderMigrationImpact(plan.attachments);
      return `Record migration plan: migration-required\nformat: ${plan.format}\nattachments: ${plan.attachments.length}\n${
        impact === "" ? "" : `${impact}\n`
      }backup: git-restore-point\nrestore commit: ${plan.restoreCommit}\n`;
    }
    default:
      return assertNever(plan);
  }
}
