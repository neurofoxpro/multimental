extends SceneTree
const Core=preload("res://src/match_core.gd")
const Data=preload("res://src/content_catalog.gd")
const Legacy=preload("res://tests/support/legacy_card_formula.gd")
var checks:int=0
var failures:int=0
func check(ok:bool,label:String)->void:
    checks+=1
    if not ok:
        failures+=1
        print("CONTENT_RUNTIME_FAIL "+label)
func _initialize()->void:
    var g=Core.new()
    var old=Legacy.new()
    check(Core.CARD_COUNT==30 and Core.Deck.CARD_COUNT==30,"thirty accepted IDs and grant unchanged")
    check(Core.RULES_ID=="terrain-sweep-v3-balance1","same compatible combat rules")
    for id in range(30):
        check(g.card(id)==old.card(id),"accepted row matches legacy formula "+str(id))
        var changed:Dictionary=g.card(id)
        changed.health=999
        check(g.card(id).health==old.card(id).health,"callers never modify frozen catalogue")
        for source in range(9):
            for facing in range(4):
                var board:Array=[]
                board.resize(9)
                for blocker in [1,4,7]:
                    board[blocker]={"id":(id+1)%30,"direction":0,"owner":1,"attack":2,"health":4}
                var unit:Dictionary={"id":id,"direction":facing}
                check(g.attack_cells(source,unit,board)==old.attack_cells(source,unit,board),"all accepted ranges and blockers preserved")
    check(g.card(-1).is_empty() and g.card(30).is_empty(),"candidate ID cannot enter accepted runtime")
    for seed in [1,2,42,77,9001,9002,2147483646]:
        g.start(seed)
        old.start(seed)
        check(g.digest()==old.digest(),"same initial state/PRNG")
        for step in range(180):
            if int(g.state.winner)!=-1:
                break
            var action:Dictionary=g.choose_ai()
            check(action==old.choose_ai(),"same selected command before data migration")
            var player:int=int(g.state.active)
            check(g.apply(player,action)==old.apply(player,action),"same events and result")
            check(g.digest()==old.digest(),"same intermediate state/PRNG")
        if int(g.state.winner)==-1:
            g.end_on_time_limit()
            old.end_on_time_limit()
        check(g.digest()==old.digest() and g.commands==old.commands,"same final result and journal")
        var replay=Core.new()
        replay.replay(seed,g.commands,g.initial_decks)
        check(replay.digest()==g.digest(),"accepted replay survives data migration")
    if failures==0:
        print("MULTIMENTAL_CONTENT_RUNTIME_PASS checks="+str(checks)+" accepted_cards=30 old_replay_equivalence=true")
    quit(0 if failures==0 else 1)
