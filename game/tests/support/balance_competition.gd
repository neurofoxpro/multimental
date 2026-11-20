extends RefCounted
## Secondary BALANCE-01 experiment: systematic mixed decks and cross-policy play.
## Accepted gameplay is imported, never reimplemented here.
const Core=preload("res://src/match_core.gd")
const Deck=preload("res://src/deck_rules.gd")
const Scenarios=preload("res://tests/support/balance_scenarios.gd")
const DECKS:Array[String]=["mix0","mix1","mix2","mix3","mix4","mix5","mix6","mix7","mix8","mix9"]
const POLICY_PAIRS:Array[String]=["greedy-greedy","positional-positional","greedy-positional","positional-greedy"]
const PATTERN:Array[int]=[0,1,3,4,7]

static func deck(name:String)->Array[int]:
    var index:int=DECKS.find(name)
    if index<0:return []
    var cards:Array[int]=[]
    for offset in PATTERN:
        var element:int=posmod(index+offset,10)
        cards.append(element*2)
        cards.append(element*2+1)
        cards.append(20+element)
    var checked:Dictionary=Deck.validate_ids(cards)
    return checked.ids if checked.ok else []

static func policy_pair(id:String)->Dictionary:
    match id:
        "greedy-greedy": return {"left":"greedy","right":"greedy"}
        "positional-positional": return {"left":"positional","right":"positional"}
        "greedy-positional": return {"left":"greedy","right":"positional"}
        "positional-greedy": return {"left":"positional","right":"greedy"}
        _: return {}

static func cycle_key(g,policy_names:Array,rngs:Array)->String:
    var players:Array=[]
    for p in g.state.players:
        players.append({"deck":p.deck,"hand":p.hand,"coins":p.coins,"maximum":p.maximum,"missed":p.missed,"opening":int(p.started)==0})
    var key:Dictionary={"active":g.state.active,"players":players,"board":g.state.board,"terrain":g.state.terrain,"placed":g.state.placed_cell,"center":g.state.center_unlocked,"income":g.state.income_bonus,"turn_phase":mini(int(g.state.turn),13),"core_rng":g.random_state}
    var policy_rng:Array=[]
    for player in [0,1]:
        if str(policy_names[player])!="greedy":
            policy_rng.append({"player":player,"state":str(rngs[player].state)})
    if not policy_rng.is_empty():key.policy_rng=policy_rng
    return JSON.stringify(key).sha256_text()

static func choose(g,policy:String,rng:RandomNumberGenerator)->Dictionary:
    return g.choose_ai() if policy=="greedy" else Scenarios.choose(g,"positional",rng)

static func one(seed_value:int,left:String,right:String,pair_id:String,limit:int)->Dictionary:
    if not Core.integer(seed_value,1,2147483646) or left not in DECKS or right not in DECKS or pair_id not in POLICY_PAIRS or limit<1 or limit>240:
        return {"ok":false,"error":"invalid_competition_request"}
    var pair:Dictionary=policy_pair(pair_id)
    var policy_names:Array=[str(pair.left),str(pair.right)]
    var decks:Array=[deck(left),deck(right)]
    var g=Core.new()
    if not g.start_with_decks(seed_value,decks).ok:return {"ok":false,"error":"invalid_deck"}
    var initial:String=g.digest()
    var control=Core.new()
    if not control.start_with_decks(seed_value,decks).ok or control.digest()!=initial or g.initial_decks!=decks:
        return {"ok":false,"error":"noncanonical_start"}
    var opening:Array=[]
    for p in g.state.players:opening.append({"hand":p.hand.size(),"deck":p.deck.size(),"coins":p.coins})
    var rngs:Array=[]
    for player in [0,1]:
        var rng:=RandomNumberGenerator.new()
        rng.seed=seed_value*313+player*97+7
        rngs.append(rng)
    var seen:Dictionary={}
    var cycle:Dictionary={}
    var plays:Dictionary={}
    for index in range(limit):
        if int(g.state.winner)!=-1:break
        var key:String=cycle_key(g,policy_names,rngs)
        if seen.has(key) and cycle.is_empty():cycle={"firstCommand":seen[key],"repeatCommand":index,"hash":key}
        seen[key]=index
        var actor:int=int(g.state.active)
        var action:Dictionary=choose(g,str(policy_names[actor]),rngs[actor])
        if action.type=="play":
            var id:String=str(g.state.players[actor].hand[int(action.hand)])
            plays[id]=int(plays.get(id,0))+1
        if not g.apply(actor,action).ok:return {"ok":false,"error":"illegal_command"}
        for p in g.state.players:
            if int(p.coins)<0:return {"ok":false,"error":"negative_coins"}
        if g.state.board.size()!=9 or g.count_cells(0)+g.count_cells(1)>9:return {"ok":false,"error":"invalid_board"}
    var capped:bool=int(g.state.winner)==-1
    if capped:g.end_on_time_limit()
    var replay=Core.new()
    if not replay.start_with_decks(seed_value,decks).ok:return {"ok":false,"error":"replay_start"}
    for entry in g.commands:
        if entry.command.type=="limit":replay.end_on_time_limit()
        elif not replay.apply(int(entry.player),entry.command).ok:return {"ok":false,"error":"replay_command"}
    if replay.digest()!=g.digest():return {"ok":false,"error":"replay_mismatch"}
    return {"ok":true,"seed":seed_value,"left":left,"right":right,"policyPair":pair_id,"leftPolicy":pair.left,"rightPolicy":pair.right,"first":int(g.state.first),"winner":int(g.state.winner),"reason":str(g.state.reason),"turns":int(g.state.turn),"actions":g.commands.size(),"forcedLimit":capped,"cycle":cycle,"opening":opening,"plays":plays,"initialHash":initial,"finalHash":g.digest(),"journalHash":JSON.stringify(g.commands).sha256_text(),"replayVerified":true,"canonicalStart":true}

static func shard(request:Dictionary)->Dictionary:
    if request.get("schemaVersion")!=1 or request.get("plan")!="mixed-competition-v1" or request.get("policyPair") not in POLICY_PAIRS or not request.get("seeds") is Array or request.seeds.size()<1 or request.seeds.size()>2 or not Core.integer(request.get("maxCommands"),240,240):
        return {"ok":false,"error":"invalid_competition_shard"}
    var rows:Array=[]
    for seed_value in request.seeds:
        if not Core.integer(seed_value,1,2147483646):return {"ok":false,"error":"invalid_seed"}
        for left in DECKS:
            for right in DECKS:
                var row:Dictionary=one(int(seed_value),left,right,str(request.policyPair),240)
                if not row.ok:return row
                rows.append(row)
    return {"schemaVersion":1,"ok":true,"plan":"mixed-competition-v1","rules":Core.RULES_ID,"rows":rows,"engine":Engine.get_version_info(),"limitsAreClockMinutes":false,"sourceGameplayChanged":false}
