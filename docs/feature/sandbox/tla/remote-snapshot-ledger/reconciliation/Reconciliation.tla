----------------------------- MODULE Reconciliation -----------------------------
EXTENDS TLC

CONSTANT UseLookupStart

VARIABLES oldRow, replacement, provider, window, gc, absentAfterSettle

vars == <<oldRow, replacement, provider, window, gc, absentAfterSettle>>

Init ==
    /\ oldRow = "preparing"
    /\ replacement = FALSE
    /\ provider = "unrequested"
    /\ window = "open"
    /\ gc = "idle"
    /\ absentAfterSettle = FALSE

RecordAndSend ==
    /\ oldRow = "preparing"
    /\ provider = "unrequested"
    /\ provider' = "may-arrive"
    /\ UNCHANGED <<oldRow, replacement, window, gc, absentAfterSettle>>

RetireUnknown ==
    /\ oldRow = "preparing"
    /\ provider # "unrequested"
    /\ oldRow' = "deleting"
    /\ UNCHANGED <<replacement, provider, window, gc, absentAfterSettle>>

ReserveReplacement ==
    /\ oldRow # "preparing"
    /\ ~replacement
    /\ replacement' = TRUE
    /\ UNCHANGED <<oldRow, provider, window, gc, absentAfterSettle>>

LateReady ==
    /\ provider = "pending" \/ (provider = "may-arrive" /\ window = "open")
    /\ provider' = "ready"
    /\ UNCHANGED <<oldRow, replacement, window, gc, absentAfterSettle>>

ProviderPending ==
    /\ provider = "may-arrive"
    /\ window = "open"
    /\ provider' = "pending"
    /\ UNCHANGED <<oldRow, replacement, window, gc, absentAfterSettle>>

WindowEnds ==
    /\ provider # "unrequested"
    /\ window = "open"
    /\ window' = "ended"
    /\ provider' = IF provider = "may-arrive" THEN "absent" ELSE provider
    /\ UNCHANGED <<oldRow, replacement, gc, absentAfterSettle>>

ClaimAndQuery ==
    /\ oldRow = "deleting"
    /\ gc = "idle"
    /\ gc' =
        CASE provider = "ready" -> "found"
          [] provider = "pending" -> "pending"
          [] window = "open" -> "early-empty"
          [] OTHER -> "settled-empty"
    /\ UNCHANGED <<oldRow, replacement, provider, window, absentAfterSettle>>

AcceptAbsent ==
    /\ gc \in {"early-empty", "settled-empty"}
    /\ IF UseLookupStart THEN gc = "settled-empty" ELSE window = "ended"
    /\ gc' = "idle"
    /\ oldRow' = "deleted"
    /\ absentAfterSettle' = (gc = "settled-empty")
    /\ UNCHANGED <<replacement, provider, window>>

ReleaseClaim ==
    /\ gc \in {"early-empty", "pending"}
    /\ ~ENABLED AcceptAbsent
    /\ gc' = "idle"
    /\ UNCHANGED <<oldRow, replacement, provider, window, absentAfterSettle>>

DeleteFound ==
    /\ gc = "found"
    /\ provider = "ready"
    /\ provider' = "deleted"
    /\ gc' = "deleted"
    /\ UNCHANGED <<oldRow, replacement, window, absentAfterSettle>>

SettleDelete ==
    /\ gc = "deleted"
    /\ oldRow' = "deleted"
    /\ gc' = "idle"
    /\ UNCHANGED <<replacement, provider, window, absentAfterSettle>>

Pause ==
    /\ ~ENABLED (RecordAndSend \/ RetireUnknown \/ ReserveReplacement \/ LateReady \/ ProviderPending
                 \/ WindowEnds \/ ClaimAndQuery \/ AcceptAbsent \/ ReleaseClaim
                 \/ DeleteFound \/ SettleDelete)
    /\ UNCHANGED vars

Next ==
    \/ RecordAndSend \/ RetireUnknown \/ ReserveReplacement \/ LateReady \/ ProviderPending
    \/ WindowEnds \/ ClaimAndQuery \/ AcceptAbsent \/ ReleaseClaim
    \/ DeleteFound \/ SettleDelete \/ Pause

Spec ==
    /\ Init /\ [][Next]_vars
    /\ WF_vars(WindowEnds)
    /\ WF_vars(LateReady)
    /\ WF_vars(ClaimAndQuery)
    /\ WF_vars(AcceptAbsent)
    /\ WF_vars(ReleaseClaim)
    /\ WF_vars(DeleteFound)
    /\ WF_vars(SettleDelete)

UnknownRequestRetainedUntilSettle ==
    oldRow = "deleted" => (provider = "deleted" \/ absentAfterSettle)

RetiredSnapshotEventuallySettles ==
    (oldRow = "deleting") ~> (oldRow = "deleted" /\ provider \in {"deleted", "absent"})

=============================================================================
