import type {
  AttemptEvidenceDomainView,
  AttemptObservabilityDomainView,
  Sample,
  SampleSnapshot,
  SourcesDomainView,
} from "../../analysis/index.ts";
import type { Report } from "../definition.ts";

/**
 * Closed, host-owned values which a built-in Report asks the execution
 * boundary to retain for a later product projection.  They are deliberately
 * made from SampleSnapshot and published DomainViews only: a result can never
 * retain a Sample, Record reader, callback, or deferred I/O capability.
 */
export type BuiltInShowResult =
  | {
      readonly kind: "leaderboard";
      readonly snapshot: SampleSnapshot;
      readonly evidence: AttemptEvidenceDomainView;
    }
  | {
      readonly kind: "attempt";
      readonly snapshot: SampleSnapshot;
      readonly evidence: AttemptEvidenceDomainView;
      readonly observability: AttemptObservabilityDomainView;
    }
  | {
      readonly kind: "source";
      readonly snapshot: SampleSnapshot;
      readonly evidence: AttemptEvidenceDomainView;
      readonly sources: SourcesDomainView;
      readonly file?: string;
    }
  | {
      readonly kind: "execution";
      readonly snapshot: SampleSnapshot;
      readonly observability: AttemptObservabilityDomainView;
    }
  | {
      readonly kind: "timing";
      readonly snapshot: SampleSnapshot;
      readonly observability: AttemptObservabilityDomainView;
    };

/** One producer is registered only for an exact built-in Report object. */
export interface BuiltInShowResultProducer {
  readonly produce: (sample: Sample) => Promise<BuiltInShowResult>;
}

/**
 * A small named result collection attached to every closed ReportExecution.
 * An empty collection is the intentional custom-Report case, so a custom
 * Report can never be inferred to be a built-in domain document by title,
 * route, or semantic-tree shape.
 */
export interface ReportExecutionResults {
  readonly format: "niceeval.report-execution-results/v1";
  readonly builtInShow: readonly BuiltInShowResult[];
}

const builtInShowProducers = new WeakMap<Report, BuiltInShowResultProducer>();

/** @internal Built-in factories opt in by exact Report identity. */
export function registerBuiltInShowResult<Definition extends Report>(
  report: Definition,
  producer: BuiltInShowResultProducer,
): Definition {
  builtInShowProducers.set(report, Object.freeze({ produce: producer.produce }));
  return report;
}

/** @internal The Host is the only code which invokes a registered producer. */
export function builtInShowResultProducer(
  report: Report,
): BuiltInShowResultProducer | undefined {
  return builtInShowProducers.get(report);
}

/** Freezes the one result slot without copying or reopening any closed view. */
export function freezeReportExecutionResults(
  input: BuiltInShowResult | undefined,
): ReportExecutionResults {
  return Object.freeze({
    format: "niceeval.report-execution-results/v1" as const,
    builtInShow: Object.freeze(input === undefined ? [] : [input]),
  });
}

/** Returns the exact built-in domain result, if this execution has one. */
export function builtInShowResult(
  results: ReportExecutionResults,
): BuiltInShowResult | undefined {
  return results.builtInShow[0];
}
