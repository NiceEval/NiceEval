---- MODULE Profile ----
EXTENDS Naturals, FiniteSets
CONSTANT N, K, Corrected
P == 1..N
Keys == 1..K
VARIABLES key, pc, disk, published, retry, lease, live, seeds
v == <<key,pc,disk,published,retry,lease,live,seeds>>
Init == /\ seeds={} /\ key \in [P -> Keys] /\ pc=[p \in P |-> "start"] /\ disk=[p \in P |-> "blank"]
        /\ published=[k \in Keys |-> 0] /\ retry=[p \in P |-> 0] /\ lease=P /\ live=TRUE
\* watchdog.py:1546-1593. Each worker has a granted private slot and at most one independent seed.
Begin(p) == /\ live /\ p \in lease /\ pc[p]="start"
            /\ pc'=[pc EXCEPT ![p]=IF published[key[p]]=0 THEN "intent" ELSE "ok"]
            /\ UNCHANGED <<key,disk,published,retry,lease,live,seeds>>
\* watchdog.py:1606-1649,1159-1220. Intent survives partial temp file and verified completed rename.
Copy(p) == /\ live /\ pc[p] \in {"intent","copy","verified"} /\ p \in lease
           /\ pc'=[pc EXCEPT ![p]=CASE @="intent" -> "copy" [] @="copy" -> "verified" [] OTHER -> "prepared"]
           /\ disk'=[disk EXCEPT ![p]=IF pc[p]="intent" THEN "partial" ELSE "full"]
           /\ UNCHANGED <<key,published,retry,lease,live,seeds>>
\* watchdog.py:1675-1730; journal commit precedes response. A lost reply does not remove the publication.
Publish(p) == /\ live /\ pc[p] \in {"prepared","lost"} /\ retry[p]<3 /\ p \in lease /\ published[key[p]] \in {0,p}
              /\ seeds'=seeds \cup {p} /\ published'=[published EXCEPT ![key[p]]=p] /\ (\E reply \in {"ok","lost"}: pc'=[pc EXCEPT ![p]=reply])
              /\ retry'=[retry EXCEPT ![p]=IF @<3 THEN @+1 ELSE @]
              /\ UNCHANGED <<key,disk,lease,live>>
WaitReply(p) == /\ live /\ pc[p]="lost" /\ p \in lease /\ published[key[p]]=p  \* docker-profile/runtime.ts:1021-1069; receipt loss or terminal timeout.
                /\ pc'=[pc EXCEPT ![p]=IF retry[p]=3 THEN "unknown" ELSE "ok"]
                /\ UNCHANGED <<key,disk,published,retry,lease,live,seeds>>
\* docker-profile/runtime.ts:1021-1069, watchdog.py:1681-1688. Other operation wins: definitive conflict three times.
Conflict(p) == /\ live /\ p \in lease /\ pc[p] \in {"prepared","conflict"} /\ published[key[p]] \notin {0,p}
               /\ retry'=[retry EXCEPT ![p]=@+1] /\ pc'=[pc EXCEPT ![p]=IF Corrected THEN "winner" ELSE IF retry[p]=2 THEN "falseUnknown" ELSE "conflict"]
               /\ UNCHANGED <<key,disk,published,lease,live,seeds>>
\* watchdog.py:1649-1673,1506-1543; interrupted capture cannot be consumed.
Fail(p) == /\ live /\ pc[p] \in {"intent","copy","verified","prepared"}
           /\ pc'=[pc EXCEPT ![p]="failed"] /\ disk'=[disk EXCEPT ![p]="blank"]
           /\ UNCHANGED <<key,published,retry,lease,live,seeds>>
\* watchdog.py:761-771,1400-1412,1627-1635; expiry/cancellation fences later client frames.
Expire(p) == /\ live /\ p \in lease /\ lease'=lease \ {p} /\ UNCHANGED <<pc,key,disk,published,retry,live,seeds>>
\* watchdog.py:715-736,1852-1892; a process stop kills all handler threads. Separate Invocation can still take over.
Crash == live /\ live'=FALSE /\ UNCHANGED <<pc,key,disk,published,retry,lease,seeds>>
Recover == /\ ~live /\ live'=TRUE  \* watchdog.py:1861-1922; scrub in-flight operations at startup.
           /\ pc'=[p \in P |-> IF pc[p] \in {"intent","copy","verified","prepared","conflict","falseUnknown","winner"} THEN "failed" ELSE pc[p]]
           /\ disk'=[p \in P |-> IF pc'[p]="failed" THEN "blank" ELSE disk[p]]
           /\ UNCHANGED <<key,published,retry,lease,seeds>>
\* watchdog.py:1677,1732-1747: stale fenced request and terminal host idle.
Idle == UNCHANGED v
Next == Crash \/ Recover \/ Idle \/ \E p \in P: Begin(p) \/ Copy(p) \/ Publish(p) \/ WaitReply(p) \/ Conflict(p) \/ Fail(p) \/ Expire(p)
Spec == Init /\ [][Next]_v
VerifiedOnly == \A k \in Keys: published[k]=0 \/ (published[k] \in seeds /\ disk[published[k]]="full" /\ key[published[k]]=k)
UniquePublication == \A k \in Keys: Cardinality({p \in seeds: key[p]=k})<=1
NoFalseAmbiguity == \A p \in P: pc[p]#"falseUnknown"
====
