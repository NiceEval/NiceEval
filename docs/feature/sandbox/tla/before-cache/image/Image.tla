---- MODULE Image ----
EXTENDS Naturals, FiniteSets
CONSTANT K, Readers, Corrected
Keys == 1..K
P == 1..Readers
VARIABLES phase, disk, lease, hold, failed, active, owner, head, del
v == <<phase,disk,lease,hold,failed,active,owner,head,del>>
Init == /\ phase=[k \in Keys |-> "empty"] /\ disk={} /\ lease=[p \in P |-> 0] /\ hold=[p \in P |-> 0]
        /\ failed={} /\ active=P /\ owner=[k \in Keys |-> 0] /\ head=0 /\ del={}
\* docker-cache-repository.ts:1624-1739; one operation-specific generation per key in this slice.
Reserve(k,p) == /\ phase[k]="empty" /\ p \in active /\ phase'=[phase EXCEPT ![k]="building"]
                /\ owner'=[owner EXCEPT ![k]=p] /\ UNCHANGED <<disk,lease,hold,failed,active,head,del>>
\* docker-before-cache.ts:1048-1051 verified provider commit; partial image never indexed.
Make(k) == /\ phase[k]="building" /\ owner[k] \in active /\ k \notin disk /\ disk'=disk \cup {k}
           /\ UNCHANGED <<phase,lease,hold,failed,active,owner,head,del>>
\* docker-cache-repository.ts:1770-1799; separate from INSERT index and head.
Publish(k) == /\ phase[k]="building" /\ k \in disk /\ owner[k] \in active
              /\ phase'=[phase EXCEPT ![k]="published"] /\ UNCHANGED <<disk,lease,hold,failed,active,owner,head,del>>
\* docker-cache-repository.ts:1799-1825; startup validation of a published row at :1542 can also index.
Index(k) == /\ phase[k]="published" /\ owner[k] \in active /\ phase'=[phase EXCEPT ![k]="indexed"]
            /\ head'=k /\ UNCHANGED <<disk,lease,hold,failed,active,owner,del>>
\* docker-cache-repository.ts:1585-1623 atomic reader handoff. Owner may also read other keys.
Acquire(k,p) == /\ p \in active /\ p#owner[k] /\ lease[p]=0 /\ phase[k]="indexed" /\ lease'=[lease EXCEPT ![p]=k]
                /\ UNCHANGED <<phase,disk,hold,failed,active,owner,head,del>>
\* docker-before-cache.ts:728-765,645-677,880; no provider container exists yet during handoff.
PrepareHold(p) == /\ lease[p]#0 /\ p \in active /\ hold[p]=0 /\ hold'=[hold EXCEPT ![p]=lease[p]]
                  /\ UNCHANGED <<phase,disk,lease,failed,active,owner,head,del>>
Release(p) == /\ lease[p]#0 /\ lease'=[lease EXCEPT ![p]=0] /\ UNCHANGED <<phase,disk,hold,failed,active,owner,head,del>>  \* docker-before-cache.ts:579-598; release the exact lease ID.
DropHold(p) == /\ hold[p]#0 /\ hold'=[hold EXCEPT ![p]=0] /\ UNCHANGED <<phase,disk,lease,failed,active,owner,head,del>>  \* docker-before-cache.ts:645-677; retire the matching durable hold.
\* docker-before-cache.ts:1077-1093. Abort/throw after index before local handoff. Release build lease first.
Abort(k) == /\ owner[k] \in active /\ phase[k] \in {"building","published","indexed"} /\ k \notin failed
            /\ failed'=failed \cup {k} /\ owner'=[owner EXCEPT ![k]=0]
            /\ phase'=[phase EXCEPT ![k]=IF Corrected /\ @ \in {"published","indexed"} THEN @ ELSE "unverified"]
            /\ UNCHANGED <<disk,lease,hold,active,head,del>>
\* docker-before-cache.ts:949-958,1094-1102; only cross-entry claims veto this path, assume no container refs.
Cleanup(k) == /\ k \in failed /\ k \in disk /\ phase[k]="unverified" /\ k \notin del
              /\ disk'=disk \ {k} /\ UNCHANGED <<phase,lease,hold,failed,active,owner,head,del>>
\* docker-cache-repository.ts:1926-1993. Simultaneous lookups cannot slip between guard and delete lock.
GcReserve(k) == /\ phase[k]="indexed" /\ k#head /\ owner[k]=0 /\ \A p \in P: lease[p]#k /\ hold[p]#k
                /\ phase'=[phase EXCEPT ![k]="deleting"] /\ del'=del \cup {k} /\ UNCHANGED <<disk,lease,hold,failed,active,owner,head>>
\* docker-before-cache.ts:986-999,1000-1008. Remove occurs outside SQLite. settle independent.
Remove(k) == /\ k \in del /\ k \in disk /\ disk'=disk \ {k} /\ UNCHANGED <<phase,lease,hold,failed,active,owner,head,del>>
Settle(k) == /\ k \in del /\ del'=del \ {k} /\ phase'=[phase EXCEPT ![k]=IF k \in disk THEN "indexed" ELSE "tombstone"]  \* docker-cache-repository.ts:1996-2025; settle or retry after evidence.
             /\ UNCHANGED <<disk,lease,hold,failed,active,owner,head>>
\* docker-before-cache.ts:1061-1075,313-344. Death anywhere leaves previously acquired rows.
Complete(k) == /\ phase[k]="indexed" /\ owner[k]#0 /\ owner'=[owner EXCEPT ![k]=0]
               /\ UNCHANGED <<phase,disk,lease,hold,failed,active,head,del>>
Crash(p) == /\ p \in active /\ active'=active \ {p} /\ UNCHANGED <<phase,disk,lease,hold,failed,owner,head,del>>  \* docker-before-cache.ts:289-344; process can die between requests.
\* docker-before-cache.ts:289-309,331-396; recover dead producer only. Valid published salvage has no head update.
Recover(k) == /\ owner[k]#0 /\ owner[k] \notin active /\ owner'=[owner EXCEPT ![k]=0]
              /\ phase'=[phase EXCEPT ![k]=CASE @="building" -> "unverified" [] @="published" -> "indexed" [] OTHER -> @]
              /\ UNCHANGED <<disk,lease,hold,failed,active,head,del>>
Idle == UNCHANGED v  \* docker-before-cache.ts:313-344; no actor or external deletion request is required by this safety slice.
Next == Idle \/ (\E p \in P: Crash(p) \/ Release(p) \/ PrepareHold(p) \/ DropHold(p))
        \/ (\E k \in Keys: Make(k) \/ Publish(k) \/ Index(k) \/ Abort(k) \/ Cleanup(k) \/ GcReserve(k) \/ Remove(k) \/ Settle(k) \/ Complete(k) \/ Recover(k) \/ (\E p \in P: Reserve(k,p) \/ Acquire(k,p)))
ReadableIndex == \A k \in Keys: phase[k]="indexed" => k \in disk
Protected == \A p \in active: (lease[p]=0 \/ lease[p] \in disk) /\ (hold[p]=0 \/ hold[p] \in disk)
RegularGcSafe == \A k \in del: \A p \in P: lease[p]#k /\ hold[p]#k
====
