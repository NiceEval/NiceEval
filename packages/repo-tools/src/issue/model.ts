export interface IssueRepository {
  readonly host: string;
  readonly repository: string;
}

export interface IssueIdentity extends IssueRepository { readonly number: number }

export interface RemoteIssue extends IssueIdentity {
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  readonly isPullRequest: boolean;
}

export type IssueOperation =
  | "create"
  | "body-set"
  | "labels-add"
  | "labels-remove"
  | "comment-add"
  | "close"
  | "reopen";

export type IssuePayload =
  | { readonly operation: "create"; readonly title: string; readonly body: string }
  | { readonly operation: "body-set"; readonly body: string }
  | { readonly operation: "labels-add" | "labels-remove"; readonly labels: readonly string[] }
  | { readonly operation: "comment-add"; readonly body: string }
  | { readonly operation: "close"; readonly reason?: "completed" | "not_planned" }
  | { readonly operation: "reopen" };

export interface CreateIdentity extends IssueRepository {
  readonly kind: "machine-origin" | "manual";
  readonly originKey?: string;
}

export interface IssuePlanReceipt {
  readonly format: "niceeval.issue-plan/v1";
  readonly id: string;
  readonly schema: 1;
  readonly plannedAt: number;
  readonly expiresAt: number;
  readonly operation: IssueOperation;
  readonly repository: IssueRepository;
  readonly identity: IssueIdentity | CreateIdentity;
  readonly remotePreimageDigest: string;
  readonly payloadDigest: string;
  readonly payload: IssuePayload;
}

export interface IssueMutationResult { readonly issue: RemoteIssue }
