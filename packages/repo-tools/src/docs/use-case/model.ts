export interface UseCaseCreateInput {
  readonly slug: string;
  readonly parent: string;
  readonly title: string;
  readonly body: string;
  readonly dryRun: boolean;
}

export interface UseCaseCreateReceipt {
  readonly format: "niceeval.docs-use-case/create-v1";
  readonly operation: "use-case-create";
  readonly dryRun: boolean;
  readonly parent: {
    readonly ref: string;
    readonly title: string;
  };
  readonly useCase: {
    readonly slug: string;
    readonly ref: string;
    readonly title: string;
  };
  readonly snapshotDigest: string;
  readonly generation: number;
  readonly nextGeneration: number;
  readonly preimages: readonly {
    readonly path: string;
    readonly digest: string | null;
  }[];
  readonly plannedDigests: readonly {
    readonly path: string;
    readonly digest: string;
  }[];
  readonly changedPaths: readonly string[];
  readonly committed: boolean;
}
