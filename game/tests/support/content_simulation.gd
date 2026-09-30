extends RefCounted
## Test-only candidate authority. Never loads candidate data into the production profile.
const Core=preload("res://src/match_core.gd")
const Scenarios=preload("res://tests/support/balance_scenarios.gd")
const RIVALS:Array[String]=["starter","guard","lancer","archer","flanker","rush","elite"]
class CandidateCore:
    extends "res://src/match_core.gd"
    var definitions:Array[Dictionary]=[]
    func card(id:int)->Dictionary:
        return definitions[id].duplicate(true) if id>=0 and id<definitions.size() else {}
    func configure(values:Array)->bool:
        if values.size()<30 or values.size()>31:
            return false
        var checked:Array[Dictionary]=[]
        for index in range(values.size()):
            if not values[index] is Dictionary:
                return false
            var row:Dictionary=values[index].duplicate(true)
            if row.size()!=9 or not integer(row.get("id"),index,index) or not integer(row.get("element"),0,9) or not integer(row.get("role"),0,4):
                return false
            for name in ["cost","attack","health"]:
                if not integer(row.get(name),1,8 if name=="cost" else (12 if name=="attack" else 30)):
                    return false
            if row.get("kind")!=TYPES[int(row.role)] or not row.get("ru") is String or not row.get("en") is String:
                return false
            for name in ["id","element","cost","attack","health","role"]:
                row[name]=int(row[name])
            checked.append(row)
        definitions=checked
        return true
    func start_trial(seed_value:int,lists:Array)->bool:
        if lists.size()!=2:
            return false
        var decks:Array=[]
        for list in lists:
            if not list is Array or list.size()!=15:
                return false
            var counts:Dictionary={}
            var ids:Array[int]=[]
            for item in list:
                if not integer(item,0,definitions.size()-1):
                    return false
                var id:int=int(item)
                counts[id]=int(counts.get(id,0))+1
                if int(counts[id])>2:
                    return false
                ids.append(id)
            decks.append(ids)
        _start_checked(seed_value,decks)
        return true

static func simulate(rows:Array,decks:Array,seed_value:int,policy:String,subject:int,watched:int)->Dictionary:
    var g=CandidateCore.new()
    if not g.configure(rows) or not g.start_trial(seed_value,decks):
        return {"ok":false,"error":"candidate_start_rejected"}
    var rng:=RandomNumberGenerator.new()
    rng.seed=seed_value*313+7
    var plays:int=0
    var passes:int=0
    for step in range(180):
        if int(g.state.winner)!=-1:
            break
        var actor:int=int(g.state.active)
        var action:Dictionary=Scenarios.choose(g,policy,rng)
        if action.type=="play" and actor==subject and int(g.state.players[actor].hand[int(action.hand)])==watched:
            plays+=1
        if action.type=="pass" and int(g.state.turn)<=2:
            passes+=1
        var result:Dictionary=g.apply(actor,action)
        if not result.ok or int(g.state.players[actor].coins)<0:
            return {"ok":false,"error":"illegal_simulated_command"}
    var capped:bool=int(g.state.winner)==-1
    if capped:
        g.end_on_time_limit()
    var replay=CandidateCore.new()
    if not replay.configure(rows) or not replay.start_trial(seed_value,decks):
        return {"ok":false,"error":"replay_start_rejected"}
    for entry in g.commands:
        if entry.command.type=="limit":
            replay.end_on_time_limit()
        elif not replay.apply(int(entry.player),entry.command).ok:
            return {"ok":false,"error":"replay_command_rejected"}
    if replay.digest()!=g.digest():
        return {"ok":false,"error":"candidate_replay_drift"}
    return {"ok":true,"seed":seed_value,"subject":subject,"policy":policy,"first":int(g.state.first),"winner":int(g.state.winner),"won":int(g.state.winner)==subject,"draw":int(g.state.winner)==2,"reason":str(g.state.reason),"turns":int(g.state.turn),"actions":g.commands.size(),"watchedPlays":plays,"openingPasses":passes,"forcedLimit":capped,"finalHash":g.digest(),"journalHash":JSON.stringify(g.commands).sha256_text(),"replayVerified":true}

static func run_trial(input:Dictionary)->Dictionary:
    if not Core.integer(input.get("seed"),1,1000000000) or not Core.integer(input.get("count"),1,64) or not input.get("candidate") is Dictionary:
        return {"ok":false,"error":"invalid_bounded_trial"}
    var c:Dictionary=input.candidate
    for key in ["baseRows","candidateRows","baseDeck","candidateDeck"]:
        if not c.get(key) is Array:
            return {"ok":false,"error":"invalid_candidate_input"}
    var baseline=Core.new()
    var validator=CandidateCore.new()
    if not validator.configure(c.baseRows) or c.baseRows.size()!=30:
        return {"ok":false,"error":"invalid_base_rows"}
    for id in range(30):
        if validator.card(id)!=baseline.card(id):
            return {"ok":false,"error":"control_is_not_accepted_catalogue"}
    if not validator.configure(c.candidateRows):
        return {"ok":false,"error":"invalid_candidate_rows"}
    var result:Array[Dictionary]=[]
    var watched:int=int(str(c.testedCard).substr(1))
    var reference:int=int(str(c.reference).substr(1))
    for rival in RIVALS:
        for policy in ["greedy","positional"]:
            for n in range(int(input.count)):
                for side in [0,1]:
                    for condition in ["control","candidate"]:
                        var subject_deck:Array=c.baseDeck if condition=="control" else c.candidateDeck
                        var decks:Array=[subject_deck,Scenarios.deck(rival)] if side==0 else [Scenarios.deck(rival),subject_deck]
                        var row:Dictionary=simulate(c.baseRows if condition=="control" else c.candidateRows,decks,int(input.seed)+n,policy,side,reference if condition=="control" else watched)
                        if not row.ok:
                            return row
                        row.condition=condition
                        row.rival=rival
                        result.append(row)
    return {"schemaVersion":1,"ok":true,"kind":"paired_candidate_simulation_not_player_telemetry","rules":Core.RULES_ID,"seedStart":int(input.seed),"count":int(input.count),"rivals":RIVALS,"policies":["greedy","positional"],"rows":result,"acceptedCatalogueChanged":false,"replaysVerified":result.size()}
