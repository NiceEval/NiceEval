---------------------------- MODULE Recovery ----------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS CloseRun, HasAfter
Keys == 1..3
Actors == 1..2
VARIABLES phase, gen, members, actor, live, run, after, registered,
          calls, lastCallGen, callsAtRetirement, reported
vars == <<phase, gen, members, actor, live, run, after, registered,
          calls, lastCallGen, callsAtRetirement, reported>>
Init == /\ phase = "active" /\ gen = 1 /\ members = [k \in Keys |-> gen+k]
        /\ actor = 0 /\ live = FALSE /\ run = "active"
        /\ after = IF HasAfter THEN "pending" ELSE "not-required"
        /\ registered = HasAfter /\ calls = 0 /\ lastCallGen = 0
        /\ callsAtRetirement = 0 /\ reported = FALSE
Claim(a) == /\ phase \in {"active","recovering"} /\ ~live /\ gen < 4
            /\ phase' = "recovering" /\ gen' = gen+1 /\ actor' = a /\ live' = TRUE
            /\ members' = [k \in Keys |-> members[k]+1]
            /\ UNCHANGED <<run,after,registered,calls,lastCallGen,callsAtRetirement,reported>>
RunFence == /\ CloseRun /\ phase = "recovering" /\ live
            /\ run = "active" /\ run' = "recovering"
            /\ UNCHANGED <<phase,gen,members,actor,live,after,registered,calls,
                           lastCallGen,callsAtRetirement,reported>>
RunClose == /\ CloseRun /\ phase = "recovering" /\ live
            /\ run = "recovering" /\ run' = "interrupted"
            /\ UNCHANGED <<phase,gen,members,actor,live,after,registered,calls,
                           lastCallGen,callsAtRetirement,reported>>
StartAfter == /\ phase = "recovering" /\ live /\ after \in {"pending","running"}
              /\ (~CloseRun \/ run = "interrupted") /\ lastCallGen # gen
              /\ after' = "running" /\ calls' = calls+1 /\ lastCallGen' = gen
              /\ UNCHANGED <<phase,gen,members,actor,live,run,registered,callsAtRetirement,reported>>
FinishAfter == /\ phase = "recovering" /\ live /\ after = "running" /\ lastCallGen = gen
               /\ after' = "completed" /\ registered' = FALSE /\ callsAtRetirement' = calls
               /\ UNCHANGED <<phase,gen,members,actor,live,run,calls,lastCallGen,reported>>
Crash == /\ live /\ gen < 4 /\ live' = FALSE
         /\ UNCHANGED <<phase,gen,members,actor,run,after,registered,calls,
                        lastCallGen,callsAtRetirement,reported>>
Free == /\ phase = "recovering" /\ live /\ after \in {"not-required","completed"}
        /\ (~CloseRun \/ run = "interrupted")
        /\ phase' = "free" /\ gen' = gen+1 /\ live' = FALSE /\ actor' = 0
        /\ members' = [k \in Keys |-> members[k]+1] /\ reported' = TRUE
        /\ UNCHANGED <<run,after,registered,calls,lastCallGen,callsAtRetirement>>
Done == /\ reported /\ UNCHANGED vars
Next == (\E a \in Actors: Claim(a)) \/ RunFence \/ RunClose \/ StartAfter \/ FinishAfter \/ Crash \/ Free \/ Done
Spec == Init /\ [][Next]_vars
WholeSetGeneration == \A k \in Keys: members[k] = gen+k
RecoveryClosesRun == reported => run = "interrupted"
AfterFollowsRun == calls > 0 => run = "interrupted"
RetirementIsAtomic == /\ (\neg registered => after \in {"not-required","completed"})
                      /\ (after = "completed" => ~registered)
NoReplayAfterRetirement == callsAtRetirement > 0 => calls = callsAtRetirement
=========================================================================
