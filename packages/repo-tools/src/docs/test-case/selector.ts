import { Match, Result } from "effect";
import { CaseNotCurrent, CasePathStale, InvalidCaseToken } from "./errors.js";
import type { CaseRelationsSidecar } from "./sidecar.js";

export interface CaseSelector { readonly path: string; readonly caseId: `necase_${string}` }

export function parseCaseSelector(selector: string): Result.Result<CaseSelector, InvalidCaseToken> {
  const index = selector.lastIndexOf("#");
  const path = selector.slice(0, index);
  const caseId = selector.slice(index + 1);
  if (index < 1 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..") || !/^necase_[0-9A-HJKMNP-TV-Z]{16}$/u.test(caseId)) {
    return Result.fail(new InvalidCaseToken({ selector }));
  }
  return Result.succeed({ path, caseId: caseId as `necase_${string}` });
}

export function selectCurrentCase(sidecar: CaseRelationsSidecar, selector: CaseSelector) {
  const relation = sidecar.current[selector.caseId];
  return Match.value(relation).pipe(
    Match.when(undefined, () => Result.fail(new CaseNotCurrent({ selector: `${selector.path}#${selector.caseId}` }))),
    Match.orElse((current) => selector.path === sidecar.testFile
      ? Result.succeed(current)
      : Result.fail(new CasePathStale({ selector: `${selector.path}#${selector.caseId}`, currentSelector: `${sidecar.testFile}#${selector.caseId}` }))),
  );
}
