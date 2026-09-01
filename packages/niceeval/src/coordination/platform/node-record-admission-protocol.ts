interface AdmissionOwner {
  readonly host: string;
  readonly pid: number;
  readonly bootId: string;
  readonly processStart: string;
  readonly deadline: number;
}

export type AdmissionInput =
  | AdmissionOwner & {
      readonly operation: "enqueue";
      readonly ticketId: string;
      readonly enqueuedAt: number;
    }
  | AdmissionOwner & {
      readonly operation: "try-admit";
      readonly ticketId: string;
      readonly sequence: number;
      readonly now: number;
    }
  | AdmissionOwner & {
      readonly operation: "cancel-writer";
      readonly ticketId: string;
      readonly now: number;
    }
  | AdmissionOwner & {
      readonly operation: "release-writer";
      readonly ticketId: string;
      readonly sequence: number;
      readonly now: number;
    }
  | AdmissionOwner & {
      readonly operation: "request-barrier";
      readonly barrierId: string;
      readonly nonce: string;
      readonly requestedAt: number;
    }
  | AdmissionOwner & {
      readonly operation: "try-activate-barrier";
      readonly barrierId: string;
      readonly nonce: string;
      readonly now: number;
    }
  | AdmissionOwner & {
      readonly operation: "cancel-barrier";
      readonly barrierId: string;
      readonly nonce: string;
      readonly now: number;
    };

export type EnqueueResult =
  | { readonly state: "blocked-by-barrier" }
  | { readonly state: "queued"; readonly sequence: number };
