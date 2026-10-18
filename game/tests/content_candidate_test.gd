extends SceneTree
const Core=preload("res://src/match_core.gd")
const Data=preload("res://src/content_catalog.gd")
const Simulation=preload("res://tests/support/content_simulation.gd")
var failed:bool=false
var checks:int=0
func check(ok:bool,text:String)->void:
    checks+=1
    if not ok:
        failed=true
        print("CONTENT_CANDIDATE_FAIL "+text)
func _initialize()->void:
    var rows:Array=Data.ROWS.duplicate(true)
    var extra:Dictionary=rows[14].duplicate(true)
    extra.id=30
    extra.cost=3
    extra.attack=3
    extra.health=4
    rows.append(extra)
    var fixture=Simulation.CandidateCore.new()
    check(fixture.configure(rows),"candidate accepted only inside isolated runner")
    var base:Array=Core.STARTER.duplicate()
    var alt:Array=base.duplicate()
    alt[9]=30
    check(Core.new().card(30).is_empty(),"production cannot read experimental ID")
    check(not Core.new().start_with_decks(42,[alt,base]).ok,"production deck rejects experimental ID")
    check(fixture.start_trial(42,[alt,base]),"private candidate deck actually starts")
    var broken:Array=rows.duplicate(true)
    broken[30].kind="execute-arbitrary-effect"
    check(not fixture.configure(broken),"unhandled semantic role rejected")
    broken=rows.duplicate(true)
    broken[30].cost=0
    check(not fixture.configure(broken),"illegal zero cost rejected natively")
    for policy in ["greedy","positional"]:
        for seed in [42,9001]:
            var a:Dictionary=Simulation.simulate(rows,[alt,base],seed,policy,0,30)
            var b:Dictionary=Simulation.simulate(rows,[alt,base],seed,policy,0,30)
            check(a.get("ok",false) and a==b,"reproducible whole candidate game and replay")
    var result:Dictionary=Simulation.run_trial({"seed":42,"count":1,"candidate":{"baseRows":Data.ROWS,"candidateRows":rows,"baseDeck":base,"candidateDeck":alt,"testedCard":"c030","reference":"c014"}})
    check(result.get("ok",false) and result.rows.size()==56 and result.replaysVerified==56,"complete mirrored seven-archetype smoke with both policies")
    if not failed:
        print("MULTIMENTAL_CONTENT_CANDIDATE_PASS checks="+str(checks)+" paired_games=56")
    quit(1 if failed else 0)
