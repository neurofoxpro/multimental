extends SceneTree
const Audit=preload("res://tests/support/balance_audit.gd")
const Competition=preload("res://tests/support/balance_competition.gd")
const Matrix=preload("res://tests/support/balance_matrix_partition.gd")
const Core=preload("res://src/match_core.gd")
const Scenarios=preload("res://tests/support/balance_scenarios.gd")
var checks:int=0
var failures:int=0
func check(value:bool,title:String)->void:
    checks+=1
    if not value:
        failures+=1
        print("BALANCE_AUDIT_TEST_FAIL "+title)
func _initialize()->void:
    for policy in Audit.POLICIES:
        for seed_value in [42,71]:
            print("BALANCE_AUDIT_STAGE match policy=",policy," seed=",seed_value)
            var a:Dictionary=Audit.one(seed_value,"guard","archer",policy,240)
            var b:Dictionary=Audit.one(seed_value,"guard","archer",policy,240)
            check(a.get("ok",false) and a==b,"same exact seeded match and replay")
            var g=Core.new()
            g.start_with_decks(seed_value,[Scenarios.deck("guard"),Scenarios.deck("archer")])
            check(a.initialHash==g.digest(),"same actual production start")
            check(a.opening[int(a.first)].hand==5 and a.opening[1-int(a.first)].hand==4,"actual starting draw not patched")
            check(a.opening[int(a.first)].coins==1 and a.opening[1-int(a.first)].coins==1,"first turn income and pending one-time second-player compensation")
            check(a.replayVerified and a.canonicalStart,"pure replay equivalence")
    print("BALANCE_AUDIT_STAGE pass_only")
    var loop:Dictionary=Audit.one(42,"starter","starter","pass-only",240,"current",true)
    check(loop.ok and loop.forcedLimit and loop.cycle.is_empty(),"pass-only income accumulation cannot claim an identical state cycle")
    check(loop.replayVerified and int(loop.actions)==241 and str(loop.reason)=="limit","240 pass commands are bounded by a deterministic limit without false cycle evidence")
    check(not Audit.one(42,"starter","starter","pass-only",240).ok,"diagnostic policy cannot enter the primary matrix")
    check(not Audit.one(42,"unknown","starter","greedy",240).ok,"unknown deck rejected")
    check(not Audit.shard({"schemaVersion":1,"plan":"standard-start-v1","policy":"greedy","profile":"current","seeds":[true],"maxCommands":240}).ok,"bool seed cannot become integer")
    var coverage:Dictionary={}
    for name in Competition.DECKS:
        var cards:Array[int]=Competition.deck(name)
        var unique:Dictionary={}
        for id in cards:
            unique[id]=true
            coverage[id]=int(coverage.get(id,0))+1
        check(cards.size()==15 and unique.size()==15,"mixed deck legal unique size")
    var equal_coverage:bool=coverage.size()==30
    for count in coverage.values():
        if int(count)!=5:equal_coverage=false
    check(equal_coverage,"mixed decks cover every accepted card five times")
    for pair_id in Competition.POLICY_PAIRS:
        print("BALANCE_AUDIT_STAGE pair=",pair_id)
        var mixed_a:Dictionary=Competition.one(42,"mix0","mix1",pair_id,240)
        var mixed_b:Dictionary=Competition.one(42,"mix0","mix1",pair_id,240)
        check(mixed_a.get("ok",false) and mixed_a==mixed_b,"mixed exact seeded match deterministic")
        check(mixed_a.replayVerified and mixed_a.canonicalStart,"mixed replay and production start")
    check(Matrix.partition_ok() and Matrix.GROUPS.size()==5,"five bounded matrix shards cover each ordered 10x10 pairing exactly once")
    check(not Competition.shard({"schemaVersion":1,"plan":"mixed-competition-v1","policyPair":"greedy-greedy","seeds":[true],"maxCommands":240}).ok,"mixed bool seed rejected")
    if failures==0:print("MULTIMENTAL_BALANCE_AUDIT_TEST_PASS checks="+str(checks))
    quit(0 if failures==0 else 1)
