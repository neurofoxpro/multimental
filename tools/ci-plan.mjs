import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {classify} from '../skills/game-production/scripts/policy.mjs';
const e=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));let paths=[];const base=e.pull_request?.base?.sha||e.before;
if(base&&/^[a-f0-9]{40}$/.test(base)&&!/^0+$/.test(base)){const r=spawnSync('git',['diff','--name-only',base,'HEAD'],{encoding:'utf8',timeout:10000});if(r.status===0)paths=r.stdout.trim().split('\n').filter(Boolean);}
const p=classify(paths);if(e.pull_request?.base?.ref==='main'&&e.pull_request?.head?.ref==='dev'){p.needsApk=false;p.reason='existing_dev_push_pipeline_main_requires_owner_approval';}
console.log(JSON.stringify(p));fs.appendFileSync(process.env.GITHUB_OUTPUT,'apk='+p.needsApk+'\n');
