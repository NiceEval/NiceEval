------------------------- MODULE InstaboxRetry -------------------------
VARIABLES phase, prior, renewed
v == <<phase, prior, renewed>>

Init == /\ phase = "ready" /\ prior = "none" /\ renewed = FALSE

Submit == /\ phase = "ready" /\ phase' = "sent" /\ prior' = "pending"
          /\ UNCHANGED renewed
Allocate == /\ prior = "pending" /\ prior' = "live"
            /\ UNCHANGED <<phase, renewed>>
Rejected == /\ phase = "sent" /\ prior = "pending"
            /\ phase' = "retryable" /\ prior' = "rejected"
            /\ UNCHANGED renewed
LoseReply == /\ phase = "sent" /\ phase' = "unknown"
             /\ UNCHANGED <<prior, renewed>>

\* The POST uses the original allocation key. It cannot schedule another Machine.
ReplaySameRequest == /\ phase = "unknown" /\ phase' = "replayed"
                     /\ UNCHANGED <<prior, renewed>>
Receive == /\ phase \in {"sent", "replayed"} /\ prior = "live"
           /\ phase' = "initializing" /\ UNCHANGED <<prior, renewed>>
Unresolved == /\ phase = "replayed" /\ phase' = "awaitDeadline"
              /\ UNCHANGED <<prior, renewed>>

Ready == /\ phase = "initializing" /\ phase' = "usable"
         /\ UNCHANGED <<prior, renewed>>
InitializationFailed == /\ phase = "initializing" /\ phase' = "deleting"
                        /\ UNCHANGED <<prior, renewed>>
\* Accepted DELETE alone does not establish absence.
ConfirmDeletion == /\ phase = "deleting" /\ phase' = "retryable"
                   /\ prior' = "deleted" /\ UNCHANGED renewed
CannotConfirmDeletion == /\ phase = "deleting" /\ phase' = "awaitDeadline"
                         /\ UNCHANGED <<prior, renewed>>
Renew == /\ phase = "retryable" /\ phase' = "renewed" /\ renewed' = TRUE
         /\ UNCHANGED prior
Expire == /\ phase = "awaitDeadline" /\ prior = "live"
          /\ phase' = "ended" /\ prior' = "expired" /\ UNCHANGED renewed
RejectAfterExit == /\ phase = "awaitDeadline" /\ prior = "pending"
                   /\ phase' = "ended" /\ prior' = "rejected" /\ UNCHANGED renewed
Done == /\ phase \in {"usable", "renewed", "ended"} /\ UNCHANGED v

Next == Submit \/ Allocate \/ Rejected \/ LoseReply \/ ReplaySameRequest
        \/ Receive \/ Unresolved \/ Ready \/ InitializationFailed
        \/ ConfirmDeletion \/ CannotConfirmDeletion \/ Renew \/ Expire
        \/ RejectAfterExit \/ Done
Spec == Init /\ [][Next]_v

RetryRequiresReconciliation == renewed => prior \in {"rejected", "deleted"}
========================================================================
