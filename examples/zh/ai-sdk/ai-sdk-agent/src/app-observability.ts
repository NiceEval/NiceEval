type Observation = {
  update?(fields: Record<string, unknown>): void;
  score?(fields: Record<string, unknown>): void;
  end?(): void;
};

type StartObservation = (
  name: string,
  fields?: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Observation;

interface TraceScope {
  end(fields?: Record<string, unknown>): void;
  event(name: string, fields?: Record<string, unknown>): void;
}

const hasLangfuseEnv =
  Boolean(process.env.LANGFUSE_PUBLIC_KEY) &&
  Boolean(process.env.LANGFUSE_SECRET_KEY) &&
  Boolean(process.env.LANGFUSE_BASE_URL);

export async function startAppTrace(fields: Record<string, unknown>): Promise<TraceScope> {
  if (!hasLangfuseEnv) return noopTrace();

  try {
    const mod = (await import("@langfuse/tracing")) as { startObservation?: StartObservation };
    if (typeof mod.startObservation !== "function") return noopTrace();
    const trace = mod.startObservation("assistant-turn", fields);
    return {
      event(name, eventFields) {
        trace.update?.({ [`event.${name}`]: eventFields ?? {} });
      },
      end(endFields) {
        trace.update?.(endFields ?? {});
        trace.end?.();
      },
    };
  } catch (error) {
    process.stderr.write(
      `[langfuse] disabled: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return noopTrace();
  }
}

function noopTrace(): TraceScope {
  return {
    event() {},
    end() {},
  };
}
