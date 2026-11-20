extends RefCounted
## Canonical game starts only. No personal profile, view, socket or wall-clock authority.
const Core=preload("res://src/match_core.gd")
const Scenarios=preload("res://tests/support/balance_scenarios.gd")
const DECKS:Array[String]=["starter","guard","lancer","archer","flanker","rush","elite"]
const POLICIES:Array[String]=["greedy","positional","random"]
class HistoricalCore:
    extends "res://src/match_core.gd"
    func card(id:int)->Dictionary:
        var row:Dictionary=super.card(id)
        if id in [5,13]: row.attack=1
        if id in [3,11,19]: row.health=2
        if id in [7,15]: row.health=3
        return row

static func cycle_key(g, policy:String, rngs:Array)->String:
    var players:Array=[]
    for p in g.state.players:
        players.append({"deck":p.deck,"hand":p.hand,"coins":p.coins,"maximum":p.maximum,"missed":p.missed,"opening":int(p.started)==0})
    var key:Dictionary={"active":g.state.active,"players":players,"board":g.state.board,"terrain":g.state.terrain,"placed":g.state.placed_cell,"center":g.state.center_unlocked,"income":g.state.income_bonus,"turn_phase":mini(int(g.state.turn),13),"core_rng":g.random_state}
    # Greedy has no external random state. Stochastic policies must include theirs.
    if policy!="greedy" and policy!="pass-only":
        key.policy_rng=[str(rngs[0].state),str(rngs[1].state)]
    return JSON.stringify(key).sha256_text()

static func choose(g, policy:String, rng:RandomNumberGenerator)->Dictionary:
    if policy=="pass-only": return {"type":"pass"}
    if policy=="random":
        var legal:Array=g.legal(int(g.state.active))
        var result:Dictionary=legal[rng.randi_range(0,legal.size()-1)].duplicate(true)
        if result.type=="play": result.direction=rng.randi_range(0,3)
        return result
    return Scenarios.choose(g,policy,rng)

static func one(seed_value:int,left:String,right:String,policy:String,limit:int,profile:String="current",diagnostic:bool=false)->Dictionary:
    if not Core.integer(seed_value,1,2147483646) or left not in DECKS or right not in DECKS or (policy not in POLICIES and not(diagnostic and policy=="pass-only")) or limit<1 or limit>240 or profile not in ["current","before"]:
        return {"ok":false,"error":"invalid_simulation_request"}
    var g=Core.new() if profile=="current" else HistoricalCore.new()
    var decks:Array=[Scenarios.deck(left),Scenarios.deck(right)]
    if not g.start_with_decks(seed_value,decks).ok:
        return {"ok":false,"error":"invalid_deck"}
    var initial:String=g.digest()
    var control=Core.new() if profile=="current" else HistoricalCore.new()
    if not control.start_with_decks(seed_value,decks).ok or control.digest()!=initial or g.initial_decks!=decks:
        return {"ok":false,"error":"noncanonical_start"}
    var opening:Array=[]
    for p in g.state.players: opening.append({"hand":p.hand.size(),"deck":p.deck.size(),"coins":p.coins})
    var rngs:Array=[]
    for player in [0,1]:
        var rng:=RandomNumberGenerator.new()
        rng.seed=seed_value*313+player*97+7
        rngs.append(rng)
    var seen:Dictionary={}
    var cycle:Dictionary={}
    var plays:Dictionary={}
    var passes:int=0
    for index in range(limit):
        if int(g.state.winner)!=-1: break
        var key:String=cycle_key(g,policy,rngs)
        if seen.has(key) and cycle.is_empty(): cycle={"firstCommand":seen[key],"repeatCommand":index,"hash":key}
        seen[key]=index
        var actor:int=int(g.state.active)
        var action:Dictionary=choose(g,policy,rngs[actor])
        if action.type=="play":
            var id:String=str(g.state.players[actor].hand[int(action.hand)])
            plays[id]=int(plays.get(id,0))+1
        elif action.type=="pass" and int(g.state.turn)<=2: passes+=1
        if not g.apply(actor,action).ok: return {"ok":false,"error":"illegal_command"}
        for p in g.state.players:
            if int(p.coins)<0: return {"ok":false,"error":"negative_coins"}
        if g.state.board.size()!=9 or g.count_cells(0)+g.count_cells(1)>9: return {"ok":false,"error":"invalid_board"}
    var capped:bool=int(g.state.winner)==-1
    if capped:g.end_on_time_limit()
    var replay=Core.new() if profile=="current" else HistoricalCore.new()
    if not replay.start_with_decks(seed_value,decks).ok: return {"ok":false,"error":"replay_start"}
    for entry in g.commands:
        if entry.command.type=="limit":replay.end_on_time_limit()
        elif not replay.apply(int(entry.player),entry.command).ok:return {"ok":false,"error":"replay_command"}
    if replay.digest()!=g.digest():return {"ok":false,"error":"replay_mismatch"}
    return {"ok":true,"seed":seed_value,"left":left,"right":right,"policy":policy,"profile":profile,"first":int(g.state.first),"winner":int(g.state.winner),"reason":str(g.state.reason),"turns":int(g.state.turn),"actions":g.commands.size(),"forcedLimit":capped,"cycle":cycle,"opening":opening,"openingPasses":passes,"plays":plays,"initialHash":initial,"finalHash":g.digest(),"journalHash":JSON.stringify(g.commands).sha256_text(),"replayVerified":true,"canonicalStart":true}

static func shard(request:Dictionary)->Dictionary:
    if request.get("schemaVersion")!=1 or request.get("plan")!="standard-start-v1" or request.get("policy") not in POLICIES or request.get("profile") not in ["current","before"] or not request.get("seeds") is Array or request.seeds.size()<1 or request.seeds.size()>4 or not Core.integer(request.get("maxCommands"),240,240):return {"ok":false,"error":"invalid_shard"}
    var rows:Array=[]
    for seed_value in request.seeds:
        if not Core.integer(seed_value,1,2147483646):return {"ok":false,"error":"invalid_seed"}
        for left in DECKS:
            for right in DECKS:
                var row:Dictionary=one(int(seed_value),left,right,str(request.policy),240,str(request.profile))
                if not row.ok:return row
                rows.append(row)
    return {"schemaVersion":1,"ok":true,"plan":"standard-start-v1","rules":Core.RULES_ID,"rows":rows,"engine":Engine.get_version_info(),"limitsAreClockMinutes":false,"sourceGameplayChanged":false}
