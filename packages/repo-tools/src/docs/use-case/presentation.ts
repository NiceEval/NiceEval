import { isTraceError, type TraceError } from "../trace/errors.js";
import { docsTraceErrorDocument, renderDocsTraceError } from "../trace-command-presentation.js";
import { TraceMutationError, type TraceCoordinationError } from "../trace/relation-mutation.js";
import { isUseCaseDomainError, type UseCaseDomainError } from "./errors.js";
import type { UseCaseCreateReceipt } from "./model.js";

export type UseCasePresentationError = UseCaseDomainError | TraceError | TraceCoordinationError;

function errorDocument(error: UseCasePresentationError): object {
  if (!isUseCaseDomainError(error)) return docsTraceErrorDocument(error);
  switch (error._tag) {
    case "UseCaseInputInvalid":
      return { _tag: error._tag, source: error.source, message: error.message };
    case "UseCaseParentMissing":
      return { _tag: error._tag, parent: error.parent, nextStep: error.nextStep };
    case "UseCaseIndexInvalid":
    case "UseCaseTargetConflict":
      return { _tag: error._tag, path: error.path, message: error.message };
    case "UseCaseIoError":
      return { _tag: error._tag, operation: error.operation, path: error.path, message: error.message };
  }
}

function humanError(error: UseCasePresentationError): string {
  if (isTraceError(error) || error instanceof TraceMutationError) return renderDocsTraceError(error);
  switch (error._tag) {
    case "UseCaseInputInvalid":
      return `${error._tag}: ${error.source}: ${error.message}`;
    case "UseCaseParentMissing":
      return `${error._tag}: no Feature matches ${JSON.stringify(error.parent)}. ${error.nextStep}`;
    case "UseCaseIndexInvalid":
    case "UseCaseTargetConflict":
      return `${error._tag}: ${error.path}: ${error.message}`;
    case "UseCaseIoError":
      return `${error._tag}: ${error.operation} ${error.path}: ${error.message}`;
  }
}

export function renderUseCaseError(error: UseCasePresentationError, json: boolean): string {
  return json
    ? `${JSON.stringify({ ok: false, error: errorDocument(error) }, null, 2)}\n`
    : `${humanError(error)}\n`;
}

export function renderUseCaseReceipt(receipt: UseCaseCreateReceipt, json: boolean): string {
  if (json) return `${JSON.stringify(receipt, null, 2)}\n`;
  return [
    `${receipt.dryRun ? "Would create" : "Created"} Use Case ${receipt.useCase.title}`,
    `Path: ${receipt.useCase.ref}`,
    `Parent: ${receipt.parent.ref}`,
    `Changed paths: ${receipt.changedPaths.join(", ")}`,
    `Generation: ${receipt.generation} → ${receipt.nextGeneration}`,
  ].join("\n") + "\n";
}
