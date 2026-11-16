import { writeFileSync } from "node:fs";

// Replace only the external SDK. NiceEval still plans the Sandbox and constructs
// its creation metadata; allocation stops before contacting the E2B service.
export class Sandbox {
  static async create(template, options) {
    writeFileSync(process.env.NICEEVAL_LABEL_RECEIPT, JSON.stringify((options || template).metadata));
    throw new Error("fixture refused allocation after recording Provider creation metadata");
  }
}
export class CommandExitError extends Error {}
export class NotFoundError extends Error {}
export class RateLimitError extends Error {}
