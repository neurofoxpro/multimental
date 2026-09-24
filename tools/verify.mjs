import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=process.cwd(),godot=process.env.GODOT_BIN||'godot';
function run(exe,args,markers=[]){const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',shell:false,timeout:120000,maxBuffer:16*1024*1024});const out=(r.stdout||'')+(r.stderr||'');process.stdout.write(out);if(r.error||r.status!==0||/SCRIPT ERROR:|Parse Error:|PRODUCTION_TEST_FAIL/.test(out)||markers.some(m=>!out.includes(m)))throw Error('Verification failed: '+exe+' '+args.join(' '));}
run(process.execPath,['--test','skills/game-production/tests/production.test.mjs']);
console.log('PRODUCTION_TESTS_PASS');
run(godot,['--headless','--editor','--path','game','--quit']);
run(godot,['--headless','--path','game','--script','res://tests/core_test.gd'],['MULTIMENTAL_CORE_PASS']);
// Core must not contain scene-tree/frame/UI dependencies.
const core=fs.readFileSync(path.join(root,'game/src/match_core.gd'),'utf8');
if(/extends\s+(Node|Control)|get_tree\(|Time\.|HTTP|OS\./.test(core))throw Error('Domain dependency violation');
console.log('ARCHITECTURE_PASS');
