---- MODULE SseApproval ----
EXTENDS Naturals

CONSTANTS CheckCloseBeforeDelivery, ShareReceiptBeforeCancel

VARIABLES turn, transport, read, receipt, observed
vars == <<turn, transport, read, receipt, observed>>

Init ==
    /\ turn = "idle"
    /\ transport = [phase |-> "none", opened |-> 0, identity |-> 0, cancels |-> 0]
    /\ read = [inFlight |-> 0, buffered |-> FALSE, decoded |-> FALSE]
    /\ receipt = [phase |-> "none", waiter |-> "none", repeated |-> "none"]
    /\ observed = [shutdown |-> FALSE, abort |-> FALSE, staleCursor |-> FALSE,
                   postCloseFrame |-> FALSE, waitingOn |-> 0, resumedOn |-> 0]

Opening == turn = "opening"
Driving == turn \in {"first", "second"}
TransportClosed == transport.phase \in {"late", "cancel", "settled"}
TransportSettled == transport.phase = "settled"

StartRequest ==
    /\ turn = "idle"
    /\ turn' = "opening"
    /\ transport' = [transport EXCEPT !.phase = "opening", !.opened = @ + 1, !.identity = @ + 1]
    /\ UNCHANGED <<read, receipt, observed>>

ReceiveBody ==
    /\ transport.phase = "opening"
    /\ transport' = [transport EXCEPT !.phase = "open"]
    /\ UNCHANGED <<turn, read, receipt, observed>>

HandOffCursor ==
    /\ Opening
    /\ transport.phase = "open"
    /\ ~observed.shutdown
    /\ ~observed.abort
    /\ turn' = "first"
    /\ observed' = [observed EXCEPT !.staleCursor = observed.shutdown]
    /\ UNCHANGED <<transport, read, receipt>>

StartRead ==
    /\ Driving
    /\ transport.phase = "open"
    /\ read.inFlight = 0
    /\ read' = [read EXCEPT !.inFlight = @ + 1]
    /\ UNCHANGED <<turn, transport, receipt, observed>>

RejectConcurrentRead ==
    /\ Driving
    /\ transport.phase = "open"
    /\ read.inFlight = 1
    /\ UNCHANGED vars

ReceiveFrame ==
    /\ transport.phase = "open"
    /\ read.inFlight = 1
    /\ ~read.buffered
    /\ ~read.decoded
    /\ read' = [read EXCEPT !.buffered = TRUE]
    /\ UNCHANGED <<turn, transport, receipt, observed>>

DecodeFrame ==
    /\ read.buffered
    /\ read' = [read EXCEPT !.buffered = FALSE, !.decoded = TRUE]
    /\ UNCHANGED <<turn, transport, receipt, observed>>

DeliverPending ==
    /\ read.inFlight = 1
    /\ read.decoded \/ TransportClosed
    /\ LET deliver == read.decoded /\ (~TransportClosed \/ ~CheckCloseBeforeDelivery)
       IN /\ observed' = [observed EXCEPT !.postCloseFrame = @ \/ (deliver /\ TransportClosed)]
          /\ turn' \in IF deliver /\ turn = "first" THEN {"first", "pauseReady"} ELSE {turn}
    /\ read' = [read EXCEPT !.inFlight = 0, !.decoded = FALSE]
    /\ UNCHANGED <<transport, receipt>>

PauseTurn ==
    /\ turn = "pauseReady"
    /\ transport.phase = "open"
    /\ ~observed.abort
    /\ turn' = "waiting"
    /\ observed' = [observed EXCEPT !.waitingOn = transport.identity]
    /\ UNCHANGED <<transport, read, receipt>>

EndWaitingSend ==
    /\ turn = "waiting"
    /\ turn' = "waitingForAnswer"
    /\ UNCHANGED <<transport, read, receipt, observed>>

TakeApprovalSlot ==
    /\ turn = "waitingForAnswer"
    /\ turn' = "approving"
    /\ UNCHANGED <<transport, read, receipt, observed>>

ResumeAfterApproval ==
    /\ turn = "approving"
    /\ transport.phase = "open"
    /\ turn' = "second"
    /\ observed' = [observed EXCEPT !.resumedOn = transport.identity]
    /\ UNCHANGED <<transport, read, receipt>>

ReceiveEof ==
    /\ Driving
    /\ transport.phase = "open"
    /\ read.inFlight = 1
    /\ ~read.buffered
    /\ ~read.decoded
    /\ turn' = "eof"
    /\ read' = [read EXCEPT !.inFlight = 0]
    /\ transport' = [transport EXCEPT !.phase = "eof"]
    /\ UNCHANGED <<receipt, observed>>

CompleteTurn ==
    /\ turn = "eof"
    /\ ~observed.abort
    /\ turn' = "completed"
    /\ transport' = [transport EXCEPT !.phase = "settled"]
    /\ receipt' = [receipt EXCEPT !.phase = "settled"]
    /\ UNCHANGED <<read, observed>>

StartClose ==
    /\ CASE transport.phase = "opening" ->
                transport' = [transport EXCEPT !.phase = "late"]
         [] transport.phase = "open" ->
                transport' = [transport EXCEPT !.phase = "cancel", !.cancels = @ + 1]
         [] OTHER -> transport' = [transport EXCEPT !.phase = "settled"]
    /\ receipt' = [receipt EXCEPT
        !.phase = IF transport.phase = "open" /\ ~Opening /\ ~ShareReceiptBeforeCancel
                  THEN "publishing"
                  ELSE "pending",
        !.waiter = "waiting"]
    /\ read' = [read EXCEPT !.buffered = FALSE]

ExplicitClose ==
    /\ Driving \/ turn = "pauseReady"
    /\ StartClose
    /\ turn' = "closing"
    /\ UNCHANGED observed

ApproveFailed ==
    /\ turn = "approving"
    /\ StartClose
    /\ turn' = "rejecting"
    /\ UNCHANGED observed

ObserveAbort ==
    /\ Opening \/ Driving \/ turn \in {"pauseReady", "eof"}
    /\ StartClose
    /\ turn' = "rejecting"
    /\ observed' = [observed EXCEPT !.abort = TRUE]

ShutDownAttempt ==
    /\ Opening \/ Driving \/ turn \in {"pauseReady", "waiting", "waitingForAnswer", "approving", "eof"}
    /\ StartClose
    /\ turn' = "closing"
    /\ observed' = [observed EXCEPT !.shutdown = TRUE]

RepeatReturn ==
    /\ receipt.phase \in {"publishing", "pending", "settled"}
    /\ receipt.repeated = "none"
    /\ receipt' = [receipt EXCEPT !.repeated = IF receipt.phase = "publishing" THEN "different" ELSE "same"]
    /\ UNCHANGED <<turn, transport, read, observed>>

PublishLegacyReceipt ==
    /\ receipt.phase = "publishing"
    /\ receipt' = [receipt EXCEPT !.phase = "pending"]
    /\ UNCHANGED <<turn, transport, read, observed>>

ReceiveLateBody ==
    /\ transport.phase = "late"
    /\ transport' = [transport EXCEPT !.phase = "cancel", !.cancels = @ + 1]
    /\ UNCHANGED <<turn, read, receipt, observed>>

OpenSettlesWithoutBody ==
    /\ transport.phase = "late"
    /\ transport' = [transport EXCEPT !.phase = "settled"]
    /\ UNCHANGED <<turn, read, receipt, observed>>

TransportCancelSettles ==
    /\ transport.phase = "cancel"
    /\ transport' = [transport EXCEPT !.phase = "settled"]
    /\ UNCHANGED <<turn, read, receipt, observed>>

CleanupDeadline ==
    /\ observed.shutdown
    /\ receipt.waiter = "waiting"
    /\ receipt.phase # "settled"
    /\ receipt' = [receipt EXCEPT !.waiter = "expired"]
    /\ UNCHANGED <<turn, transport, read, observed>>

SettleCloseReceipt ==
    /\ receipt.phase = "pending"
    /\ TransportSettled
    /\ receipt' = [receipt EXCEPT !.phase = "settled"]
    /\ UNCHANGED <<turn, transport, read, observed>>

FinishClose ==
    /\ turn \in {"closing", "rejecting"}
    /\ read.inFlight = 0
    /\ receipt.phase = "settled" \/ (observed.shutdown /\ receipt.waiter = "expired")
    /\ turn' = IF turn = "rejecting" THEN "rejected" ELSE "closed"
    /\ UNCHANGED <<transport, read, receipt, observed>>

Done ==
    /\ turn \in {"completed", "rejected", "closed"}
    /\ receipt.phase = "settled"
    /\ UNCHANGED vars

Next ==
    \/ StartRequest
    \/ ReceiveBody
    \/ HandOffCursor
    \/ StartRead
    \/ RejectConcurrentRead
    \/ ReceiveFrame
    \/ DecodeFrame
    \/ DeliverPending
    \/ PauseTurn
    \/ EndWaitingSend
    \/ TakeApprovalSlot
    \/ ResumeAfterApproval
    \/ ReceiveEof
    \/ CompleteTurn
    \/ ExplicitClose
    \/ ApproveFailed
    \/ ObserveAbort
    \/ ShutDownAttempt
    \/ RepeatReturn
    \/ PublishLegacyReceipt
    \/ ReceiveLateBody
    \/ OpenSettlesWithoutBody
    \/ TransportCancelSettles
    \/ CleanupDeadline
    \/ SettleCloseReceipt
    \/ FinishClose
    \/ Done

Spec == Init /\ [][Next]_vars
             /\ WF_vars(PublishLegacyReceipt)
             /\ WF_vars(SettleCloseReceipt)

SingleInFlightRead == read.inFlight <= 1

NoFrameAfterClose == ~observed.postCloseFrame /\ (TransportClosed => ~read.buffered)

CancelAtMostOnce ==
    /\ transport.cancels <= 1
    /\ receipt.repeated # "different"
    /\ (receipt.phase = "settled" => TransportSettled)

WaitingKeepsTransport ==
    /\ (turn \in {"waiting", "waitingForAnswer", "approving"} =>
         /\ transport.phase = "open"
         /\ transport.identity = observed.waitingOn
         /\ transport.opened = 1
         /\ receipt.phase = "none")
    /\ (observed.resumedOn # 0 => observed.resumedOn = observed.waitingOn /\ transport.opened = 1)

NoCursorAfterShutdown == ~observed.staleCursor

ObservedAbortWins ==
    observed.abort => turn \notin {"waiting", "waitingForAnswer", "completed"}

CloseReceiptSettlesWhenTransportSettles ==
    (receipt.phase \in {"publishing", "pending"} /\ TransportSettled) ~> (receipt.phase = "settled")
====
