import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {verificationRuntime} from './godot-runtime.mjs';
const root=process.cwd();function run(exe,args,markers=[]){const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',shell:false,timeout:180000,maxBuffer:24*1024*1024});const out=(r.stdout||'')+(r.stderr||'');process.stdout.write(out);if(r.error||r.status!==0||/SCRIPT ERROR:|Parse Error:|PRODUCTION_TEST_FAIL/.test(out)||markers.some(m=>!out.includes(m)))throw Error('Verification failed: '+exe+' '+args.join(' '));}
for(const dir of ['scripts','tools','skills/game-production/scripts'])for(const f of fs.readdirSync(dir))if(f.endsWith('.mjs'))run(process.execPath,['--check',path.join(dir,f)]);
run(process.execPath,['tools/security-lint.mjs']);
const tests=fs.readdirSync('skills/game-production/tests').filter(x=>x.endsWith('.test.mjs')).map(x=>'skills/game-production/tests/'+x);run(process.execPath,['--test',...tests]);console.log('PRODUCTION_TESTS_PASS');
const godot=verificationRuntime(root,process.env.GODOT_BIN||'godot');run(godot,['--headless','--editor','--path','game','--quit']);
for(const [file,marker]of [['core_test.gd','MULTIMENTAL_CORE_PASS'],['ui_test.gd','MULTIMENTAL_UI_PASS'],['protocol_test.gd','MULTIMENTAL_PROTOCOL_PASS']])run(godot,['--headless','--path','game','--script','res://tests/'+file],[marker]);
const core=fs.readFileSync('game/src/match_core.gd','utf8');if(/extends\s+(Node|Control)|get_tree\(|Time\.|HTTP|OS\./.test(core))throw Error('Domain dependency violation');console.log('ARCHITECTURE_PASS');
