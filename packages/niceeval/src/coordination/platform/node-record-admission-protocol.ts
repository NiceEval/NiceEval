export type AdmissionRequest =
  | {
      readonly id: number;
      readonly operation: "enqueue";
      readonly path: string;
      readonly ticketId: string;
      readonly host: string;
      readonly pid: number;
      readonly deadline: number;
      readonly enqueuedAt: number;
    }
  | {
      readonly id: number;
      readonly operation: "try-admit";
      readonly path: string;
      readonly ticketId: string;
      readonly sequence: number;
      readonly host: string;
      readonly pid: number;
      readonly deadline: number;
      readonly now: number;
    }
  | {
      readonly id: number;
      readonly operation: "cancel-writer";
      readonly path: string;
      readonly ticketId: string;
      readonly host: string;
      readonly pid: number;
      readonly deadline: number;
      readonly now: number;
    }
  | {
      readonly id: number;
      readonly operation: "release-writer";
      readonly path: string;
      readonly ticketId: string;
      readonly sequence: number;
      readonly host: string;
      readonly pid: number;
      readonly deadline: number;
      readonly now: number;
    }
  | {
      readonly id: number;
      readonly operation: "request-barrier";
      readonly path: string;
      readonly barrierId: string;
      readonly nonce: string;
      readonly host: string;
      readonly pid: number;
      readonly deadline: number;
      readonly requestedAt: number;
    }
  | {
      readonly id: number;
      readonly operation: "try-activate-barrier";
      readonly path: string;
      readonly barrierId: string;
      readonly nonce: string;
      readonly host: string;
      readonly pid: number;
      readonly deadline: number;
      readonly now: number;
    }
  | {
      readonly id: number;
      readonly operation: "cancel-barrier";
      readonly path: string;
      readonly barrierId: string;
      readonly nonce: string;
      readonly host: string;
      readonly pid: number;
      readonly deadline: number;
      readonly now: number;
    }
  | { readonly id: number; readonly operation: "close" };

export type AdmissionInput = AdmissionRequest extends infer Request
  ? Request extends AdmissionRequest ? Omit<Request, "id"> : never
  : never;

export type EnqueueResult =
  | { readonly state: "blocked-by-barrier" }
  | { readonly state: "queued"; readonly sequence: number };

export type AdmissionResponse =
  | { readonly id: number; readonly state: "success"; readonly result: unknown }
  | {
      readonly id: number;
      readonly state: "failure";
      readonly error: { readonly code: string; readonly message: string };
    };

export function isAdmissionResponse(value: unknown): value is AdmissionResponse {
  if (typeof value !== "object" || value === null) return false;
  const id = Reflect.get(value, "id");
  const state = Reflect.get(value, "state");
  if (!Number.isSafeInteger(id) || (state !== "success" && state !== "failure")) return false;
  if (state === "success") return Object.prototype.hasOwnProperty.call(value, "result");
  const error = Reflect.get(value, "error");
  return typeof error === "object" && error !== null &&
    typeof Reflect.get(error, "code") === "string" &&
    typeof Reflect.get(error, "message") === "string";
}
