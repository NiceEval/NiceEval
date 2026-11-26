------------------------------ MODULE Checkpoint ------------------------------
EXTENDS Naturals
CONSTANT Atomic

Lines == 1..2
Executions == 1..3
VARIABLES head, bytes, ready, saved, pred, pc, writer, stale, crashed, crashRequest, lostReply
vars == <<head, bytes, ready, saved, pred, pc, writer, stale, crashed, crashRequest, lostReply>>

Init ==
    /\ head = [l \in Lines |-> 0]
    /\ bytes = [e \in Executions |-> {}]
    /\ ready = [e \in Executions |-> {}]
    /\ saved = {}
    /\ pred = [e \in Executions |-> head]
    /\ pc = [e \in Executions |-> "new"]
    /\ writer = 1
    /\ stale = FALSE
    /\ crashed = 0
    /\ crashRequest = FALSE
    /\ lostReply = FALSE

Observe ==
    /\ pc[writer] = "new"
    /\ pred' = [pred EXCEPT ![writer] = head]
    /\ pc' = [pc EXCEPT ![writer] = "staging"]
    /\ UNCHANGED <<head, bytes, ready, saved, writer, stale, crashed, crashRequest, lostReply>>

Stage(l) ==
    /\ pc[writer] = "staging"
    /\ l \notin bytes[writer]
    /\ \A i \in Lines: i < l => i \in bytes[writer]
    /\ bytes' = [bytes EXCEPT ![writer] = @ \cup {l}]
    /\ UNCHANGED <<head, ready, saved, pred, pc, writer, stale, crashed, crashRequest, lostReply>>

Current(e) == e = writer /\ e # crashed

CommitRequest(e) ==
    /\ pc[e] \in {"staging", "interrupted"}
    /\ bytes[e] = Lines

RecordWrite(e) == stale' = (stale \/ e # writer \/ pc[e] = "interrupted")

PublishAll(e) ==
    /\ Atomic
    /\ CommitRequest(e)
    /\ Current(e)
    /\ ready[e] = {}
    /\ pred[e] = head
    /\ ready' = [ready EXCEPT ![e] = Lines]
    /\ head' = [l \in Lines |-> e]
    /\ saved' = saved \cup {e}
    /\ pc' = [pc EXCEPT ![e] = "reply"]
    /\ RecordWrite(e)
    /\ UNCHANGED <<bytes, pred, writer, crashed, crashRequest, lostReply>>

\* The split configuration is a counterfactual that exposes intermediate writes.
PublishOne(e,l) ==
    /\ ~Atomic
    /\ CommitRequest(e)
    /\ Current(e)
    /\ l \notin ready[e]
    /\ \A i \in Lines: head[i] = (IF i \in ready[e] THEN e ELSE pred[e][i])
    /\ ready' = [ready EXCEPT ![e] = @ \cup {l}]
    /\ head' = [head EXCEPT ![l] = e]
    /\ RecordWrite(e)
    /\ UNCHANGED <<bytes, pred, saved, pc, writer, crashed, crashRequest, lostReply>>

FinishOneAtATime(e) ==
    /\ ~Atomic
    /\ CommitRequest(e)
    /\ Current(e)
    /\ ready[e] = Lines
    /\ saved' = saved \cup {e}
    /\ pc' = [pc EXCEPT ![e] = "reply"]
    /\ RecordWrite(e)
    /\ UNCHANGED <<head, bytes, pred, ready, writer, crashed, crashRequest, lostReply>>

CrashUncommitted ==
    /\ pc[writer] = "staging"
    /\ crashed = 0
    /\ crashed' = writer
    /\ crashRequest' = (bytes[writer] = Lines)
    /\ pc' = [pc EXCEPT ![writer] = "interrupted"]
    /\ UNCHANGED <<head, bytes, ready, saved, pred, writer, stale, lostReply>>

LateWrite(e) ==
    /\ e = crashed
    /\ crashRequest
    /\ ~Current(e)
    /\ UNCHANGED vars

Discard ==
    /\ pc[writer] = "interrupted"
    /\ writer \notin saved
    /\ bytes' = [bytes EXCEPT ![writer] = ready[writer]]
    /\ pc' = [pc EXCEPT ![writer] = "skipped"]
    /\ UNCHANGED <<head, ready, saved, pred, writer, stale, crashed, crashRequest, lostReply>>

LoseReply ==
    /\ pc[writer] = "reply"
    /\ ~lostReply
    /\ lostReply' = TRUE
    /\ pc' = [pc EXCEPT ![writer] = "retry"]
    /\ UNCHANGED <<head, bytes, ready, saved, pred, writer, stale, crashed, crashRequest>>

ReadUnavailable ==
    /\ pc[writer] = "retry"
    /\ pc' = [pc EXCEPT ![writer] = "unknown"]
    /\ UNCHANGED <<head, bytes, ready, saved, pred, writer, stale, crashed, crashRequest, lostReply>>

Ack ==
    /\ pc[writer] = "reply"
    /\ writer \in saved
    /\ pc' = [pc EXCEPT ![writer] = "done"]
    /\ UNCHANGED <<head, bytes, ready, saved, pred, writer, stale, crashed, crashRequest, lostReply>>

RereadSaved ==
    /\ pc[writer] = "retry"
    /\ writer \in saved
    /\ pc' = [pc EXCEPT ![writer] = "done"]
    /\ UNCHANGED <<head, bytes, ready, saved, pred, writer, stale, crashed, crashRequest, lostReply>>

RecoverSaved ==
    /\ pc[writer] = "unknown"
    /\ writer \in saved
    /\ pc' = [pc EXCEPT ![writer] = "done"]
    /\ UNCHANGED <<head, bytes, ready, saved, pred, writer, stale, crashed, crashRequest, lostReply>>

NextRun ==
    /\ pc[writer] \in {"done", "skipped"}
    /\ writer < 3
    /\ writer' = writer + 1
    /\ UNCHANGED <<head, bytes, ready, saved, pred, pc, stale, crashed, crashRequest, lostReply>>

Done == writer = 3 /\ pc[writer] \in {"done", "skipped"} /\ UNCHANGED vars

Progress ==
    \/ Observe \/ Ack \/ RereadSaved \/ RecoverSaved \/ Discard \/ NextRun
    \/ (\E l \in Lines: Stage(l))
    \/ (\E e \in Executions: PublishAll(e) \/ FinishOneAtATime(e) \/ (\E l \in Lines: PublishOne(e,l)))

Next ==
    \/ Progress \/ CrashUncommitted \/ LoseReply \/ ReadUnavailable \/ Done
    \/ (\E e \in Executions: LateWrite(e))

Spec == Init /\ [][Next]_vars /\ WF_vars(Progress)

NoHalfCommit ==
    /\ \A e \in Executions: ready[e] = (IF e \in saved THEN Lines ELSE {})
    /\ \A l \in Lines: head[l] # 0 => (head[l] \in saved /\ l \in bytes[head[l]])
    /\ head[1] = head[2]

\* Payloads on a lineage can all be identical. Checkpoint identity is (execution, lineage).
CheckpointIdNoABA ==
    \A e \in saved: \A l \in Lines: pred[e][l] < e /\ e <= head[l]

NoLateCommit == ~stale

SettlesAfterCrash ==
    <> (/\ writer = 3
        /\ \A e \in Executions:
            /\ pc[e] \in {"done", "skipped"}
            /\ (pc[e] = "done") = (e \in saved))
=============================================================================
