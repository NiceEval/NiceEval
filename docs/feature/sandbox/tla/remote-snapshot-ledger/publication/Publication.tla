------------------------------- MODULE Publication -------------------------------
EXTENDS TLC

CONSTANT RememberFailedClose

VARIABLES row, lease, remoteReady, oldReply, publication, producerHold, hit,
          runHold, sandboxHold, instance, replacement

vars == <<row, lease, remoteReady, oldReply, publication, producerHold, hit,
          runHold, sandboxHold, instance, replacement>>

Init ==
    /\ row = "preparing"
    /\ lease = "producer"
    /\ remoteReady = FALSE
    /\ oldReply = "waiting"
    /\ publication = [author |-> "none", currentLease |-> "none"]
    /\ producerHold = FALSE
    /\ hit = FALSE
    /\ runHold = FALSE
    /\ sandboxHold = FALSE
    /\ instance = "none"
    /\ replacement = FALSE

ProviderReady ==
    /\ row = "preparing"
    /\ ~remoteReady
    /\ remoteReady' = TRUE
    /\ UNCHANGED <<row, lease, oldReply, publication, producerHold, hit,
                   runHold, sandboxHold, instance, replacement>>

Expire ==
    /\ row = "preparing"
    /\ lease = "producer"
    /\ lease' = "expired"
    /\ UNCHANGED <<row, remoteReady, oldReply, publication, producerHold, hit,
                   runHold, sandboxHold, instance, replacement>>

TakeOver ==
    /\ row = "preparing"
    /\ lease = "expired"
    /\ lease' = "waiter"
    /\ UNCHANGED <<row, remoteReady, oldReply, publication, producerHold, hit,
                   runHold, sandboxHold, instance, replacement>>

Publish(actor) ==
    /\ row = "preparing"
    /\ remoteReady
    /\ lease = actor
    /\ row' = "ready"
    /\ publication' = [author |-> actor, currentLease |-> lease]
    /\ oldReply' = IF actor = "producer" THEN "published" ELSE oldReply
    /\ producerHold' = (actor = "producer")
    /\ hit' = (actor = "waiter")
    /\ runHold' = (actor = "waiter")
    /\ UNCHANGED <<lease, remoteReady, sandboxHold, instance, replacement>>

ProducerPublishes == Publish("producer")
WaiterPublishes == Publish("waiter")

RejectLatePublish ==
    /\ remoteReady
    /\ lease # "producer"
    /\ oldReply = "waiting"
    /\ oldReply' = "rejected"
    /\ UNCHANGED <<row, lease, remoteReady, publication, producerHold, hit,
                   runHold, sandboxHold, instance, replacement>>

HitWithHold ==
    /\ row = "ready"
    /\ ~hit
    /\ hit' = TRUE
    /\ runHold' = TRUE
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, producerHold,
                   sandboxHold, instance, replacement>>

ReleaseProducerHold ==
    /\ producerHold
    /\ producerHold' = FALSE
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, hit, runHold,
                   sandboxHold, instance, replacement>>

Handoff ==
    /\ row \in {"ready", "deleting"}
    /\ runHold \/ producerHold
    /\ instance = "none"
    /\ sandboxHold' = TRUE
    /\ instance' = "creating"
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, producerHold, hit,
                   runHold, replacement>>

InstanceStarts ==
    /\ instance = "creating"
    /\ instance' = "live"
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, producerHold,
                   hit, runHold, sandboxHold, replacement>>

ReleaseRunHold ==
    /\ hit /\ runHold
    /\ hit' = FALSE
    /\ runHold' = FALSE
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, producerHold,
                   sandboxHold, instance, replacement>>

Retire ==
    /\ row = "ready"
    /\ row' = "deleting"
    /\ UNCHANGED <<lease, remoteReady, oldReply, publication, producerHold, hit,
                   runHold, sandboxHold, instance, replacement>>

ReserveReplacement ==
    /\ row \in {"deleting", "claimed", "deleted"}
    /\ ~replacement
    /\ replacement' = TRUE
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, producerHold, hit,
                   runHold, sandboxHold, instance>>

InstanceDeleteFails ==
    /\ row = "deleting" /\ instance = "live"
    /\ instance' = "unconfirmed"
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, producerHold,
                   hit, runHold, sandboxHold, replacement>>

RecloseFailedInstance ==
    /\ ~RememberFailedClose
    /\ instance = "unconfirmed" /\ sandboxHold
    /\ sandboxHold' = FALSE
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, producerHold,
                   hit, runHold, instance, replacement>>

ConfirmInstanceDeleted ==
    /\ instance = "live"
    /\ instance' = "deleted"
    /\ sandboxHold' = FALSE
    /\ UNCHANGED <<row, lease, remoteReady, oldReply, publication, producerHold,
                   hit, runHold, replacement>>

ClaimDelete ==
    /\ row = "deleting"
    /\ ~producerHold /\ ~runHold /\ ~sandboxHold
    /\ row' = "claimed"
    /\ UNCHANGED <<lease, remoteReady, oldReply, publication, producerHold, hit,
                   runHold, sandboxHold, instance, replacement>>

DeleteSnapshot ==
    /\ row = "claimed"
    /\ row' = "deleted"
    /\ UNCHANGED <<lease, remoteReady, oldReply, publication, producerHold, hit,
                   runHold, sandboxHold, instance, replacement>>

Work ==
    \/ ProviderReady \/ Expire \/ TakeOver \/ ProducerPublishes \/ WaiterPublishes
    \/ RejectLatePublish \/ HitWithHold \/ ReleaseProducerHold \/ Handoff
    \/ InstanceStarts \/ ReleaseRunHold \/ Retire \/ ReserveReplacement
    \/ InstanceDeleteFails \/ RecloseFailedInstance \/ ConfirmInstanceDeleted
    \/ ClaimDelete \/ DeleteSnapshot

Pause == ~ENABLED Work /\ UNCHANGED vars

Next ==
    \/ ProviderReady \/ Expire \/ TakeOver \/ ProducerPublishes \/ WaiterPublishes
    \/ RejectLatePublish \/ HitWithHold \/ ReleaseProducerHold \/ Handoff
    \/ InstanceStarts \/ ReleaseRunHold \/ Retire \/ ReserveReplacement
    \/ InstanceDeleteFails \/ RecloseFailedInstance \/ ConfirmInstanceDeleted
    \/ ClaimDelete \/ DeleteSnapshot \/ Pause

Spec ==
    /\ Init /\ [][Next]_vars
    /\ WF_vars(ClaimDelete)
    /\ WF_vars(DeleteSnapshot)

OnlyCurrentLeasePublishes ==
    publication.author = publication.currentLease

ReadyWithOwnHold == hit => runHold

NoDeleteWithLiveSandboxHold ==
    row \in {"claimed", "deleted"} => instance \notin {"creating", "live", "unconfirmed"}

RetiredSnapshotEventuallySettles ==
    (row = "deleting" /\ ~producerHold /\ ~runHold /\ ~sandboxHold) ~> (row = "deleted")

=============================================================================
