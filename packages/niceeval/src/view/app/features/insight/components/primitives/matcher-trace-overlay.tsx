import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { MatcherFilterDebuggerContent, MatcherFilterRowState } from "./matcher-filter-debugger.tsx";

interface TraceOverlay {
  readonly owner: string;
  readonly rows: ReadonlyMap<string, MatcherFilterRowState>;
}

const TraceOverlayRows = createContext<TraceOverlay | undefined>(undefined);
const SetTraceOverlay = createContext<Dispatch<SetStateAction<TraceOverlay | undefined>> | undefined>(undefined);
const TraceReveal = createContext<
  | {
      readonly anchor: string | undefined;
      readonly setAnchor: (anchor: string | undefined) => void;
    }
  | undefined
>(undefined);

export function MatcherTraceOverlay({ children }: { readonly children: ReactNode }) {
  const [overlay, setOverlay] = useState<TraceOverlay>();
  const [anchor, setAnchor] = useState<string>();
  return (
    <SetTraceOverlay.Provider value={setOverlay}>
      <TraceOverlayRows.Provider value={overlay}>
        <TraceReveal.Provider value={{ anchor, setAnchor }}>{children}</TraceReveal.Provider>
      </TraceOverlayRows.Provider>
    </SetTraceOverlay.Provider>
  );
}

export function useAssertionTraceOverlay(debuggerContent: MatcherFilterDebuggerContent | undefined) {
  const owner = useId();
  const setOverlay = useContext(SetTraceOverlay);
  useEffect(
    () => () => setOverlay?.((current) => (current?.owner === owner ? undefined : current)),
    [owner, setOverlay],
  );
  return (open: boolean) => {
    if (!open) {
      setOverlay?.((current) => (current?.owner === owner ? undefined : current));
      return;
    }
    const rows = new Map<string, MatcherFilterRowState>();
    for (const row of debuggerContent?.atEvaluation.rows ?? []) {
      if (row.conversationTarget !== undefined) rows.set(row.conversationTarget.anchor, row.state);
    }
    setOverlay?.({ owner, rows });
  };
}

export function useAssertionTraceRow(anchor: string | undefined): MatcherFilterRowState | undefined {
  const overlay = useContext(TraceOverlayRows);
  return anchor === undefined ? undefined : overlay?.rows.get(anchor);
}

export function useTraceReveal() {
  return useContext(TraceReveal);
}
