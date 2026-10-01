/** Maximum UTF-8 JSON bytes for any one fixed operation result field. */
export const INSPECTION_RESULT_BYTE_LIMIT = 512 * 1024;

/** Complete Experiment aggregates and cells include per-Assertion coverage. */
export const INSPECTION_EXPERIMENT_RESULT_BYTE_LIMIT = 4 * 1024 * 1024;

/** Full source content, Judge audit and base64 encoding for assertion detail only. */
export const INSPECTION_ASSERTION_DETAIL_BYTE_LIMIT = 32 * 1024 * 1024;
