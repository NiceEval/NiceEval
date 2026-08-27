import * as Cause from "effect/Cause";

const detail = (error: unknown): string | undefined =>
  typeof error === "object" &&
      error !== null &&
      "detail" in error &&
      typeof error.detail === "string" &&
      error.detail.length > 0
    ? error.detail
    : undefined;

/** Preserve Effect v4 Cause structure while making detail-only tagged errors readable. */
export const formatCause = <E>(cause: Cause.Cause<E>): string =>
  Cause.pretty(Cause.map(cause, (error) => {
    if (error instanceof Error && error.message.length === 0) {
      const message = detail(error);
      if (message !== undefined) error.message = message;
    }
    return error;
  }));
