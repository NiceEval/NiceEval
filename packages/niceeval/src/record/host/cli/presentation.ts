import type {
  RecordAttachmentMigrationTarget,
  RecordMaintenanceOperationFailure,
  RecordMigrateOperationPlan,
} from "../types.ts";

function assertNever(value: never): never {
  throw new Error(`Unreachable Record CLI presentation value: ${String(value)}`);
}

export function renderRecordMaintenanceFailure(
  failure: RecordMaintenanceOperationFailure,
  _recordPath: string,
): string {
  switch (failure._tag) {
    case "RecordMaintenanceBusy":
      return `${failure.code}\nClose the Record command holding the lock, then retry.\n`;
    case "RecordMigrationPlanStale":
      return `${failure.code}\nReview the new migration plan and rerun migrate.\n`;
    case "RecordMigrationInvalid":
      return `${failure.code}\nfamily: ${failure.family}\nThe committed source is invalid; no uncommitted step was published.\n`;
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

function renderMigrationImpact(attachments: readonly RecordAttachmentMigrationTarget[]): string {
  return [...new Map(attachments.map((attachment) => {
    const key = `${attachment.family}@${attachment.fromRevision}->${attachment.toRevision}`;
    return [key, attachment] as const;
  })).values()].map((attachment) => {
    const retention = attachment.retention;
    const lines = [
      `impact ${attachment.family}@${attachment.fromRevision}->${attachment.toRevision}:`,
      `  retained facts: ${retention.retainedFacts.length === 0 ? "none declared" : retention.retainedFacts.join(", ")}`,
      `  dropped facts: ${retention.droppedFacts.length === 0 ? "none declared" : retention.droppedFacts.join(", ")}`,
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
    case "RecordMigrationReady": {
      const impact = renderMigrationImpact(plan.attachments);
      return `Record migration plan\nformat: ${plan.format}\nsteps: ${plan.attachments.length}\npending seals: ${plan.pendingSeals.length}\nresume: ${plan.resumedSteps} committed steps already current\n${impact === "" ? "" : `${impact}\n`}`;
    }
    default:
      return assertNever(plan);
  }
}
