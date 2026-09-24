import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {readJSON,writeJSON,inside,context,findRoot,gate} from './lib.mjs';
import {featureBranch,readyTasks} from './policy.mjs';
import {applyBundle} from './apply.mjs';
const root=findRoot(),p=readJSON(inside(root,'.gameprod/project.json')),workspace=path.dirname(root);
// Private portable tools only; no global PATH/credential modifications.
if(process.platform==='win32'){
 const gitdir=path.join(workspace,'tools/mingit/cmd');
 if(fs.existsSync(path.join(gitdir,'git.exe')))process.env.PATH=gitdir+path.delimiter+process.env.PATH;
 if(!process.env.GODOT_BIN){const d=path.join(workspace,'tools/godot');if(fs.existsSync(d)){const n=fs.readdirSync(d).find(n=>/console.exe$/i.test(n));if(n)process.env.GODOT_BIN=path.join(d,n);}}
}
context(root,p);process.env.GIT_TERMINAL_PROMPT='0';process.env.GH_PROMPT_DISABLED='1';
const dir=inside(root,'.gameprod/evidence');fs.mkdirSync(dir,{recursive:true});
function run(exe,args,{optional=false,timeout=120000,quiet=false}={}){
 const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',shell:false,timeout,maxBuffer:24*1024*1024,env:process.env});
 const out=(r.stdout||'')+(r.stderr||'');
 if(r.status!==0||r.error){if(optional)return null;fs.writeFileSync(path.join(dir,'last-command-failed.log'),out);throw Error(path.basename(exe)+' '+args[0]+' failed: '+out.slice(-2400));}
 if(!quiet)process.stdout.write(out);return (r.stdout||'').trim();
}
const git=(...a)=>run('git',a,{quiet:true}),gh=(...a)=>run('gh',a,{quiet:true}),json=(...a)=>JSON.parse(gh(...a));
function clean(){if(git('status','--porcelain'))throw Error('Working tree not clean; preserve/review changes');}
function ownBranch(){const b=git('branch','--show-current');if(!featureBranch(b))throw Error('Feature/fix/docs/test branch required');return b;}
function account(){const login=gh('api','user','--jq','.login');if(p.githubLogin&&login!==p.githubLogin)throw Error('Wrong active gh account');return login;}
function invoke(a){return run(process.execPath,a,{quiet:true,timeout:600000});}
function verify(){invoke(['skills/game-production/scripts/gameprod.mjs','run','verify']);if(!gate(root,p,'verified').ok)throw Error('Verification receipt invalid');console.log('VERIFY_PASS '+git('rev-parse','--short','HEAD'));}
function resume(){
 const r={observedAt:new Date().toISOString(),repository:p.repository,host:os.hostname(),account:account(),branch:git('branch','--show-current'),head:git('rev-parse','HEAD'),dirty:!!git('status','--porcelain'),access:json('repo','view',p.repository,'--json','viewerPermission').viewerPermission,prs:json('pr','list','--repo',p.repository,'--state','open','--json','number,title,headRefName,baseRefName'),releases:json('api','repos/'+p.repository+'/releases?per_page=2').map(x=>({tag:x.tag_name,id:x.id})),next:readyTasks(readJSON(inside(root,'.gameprod/backlog.json'))).map(x=>({id:x.id,action:x.action})),verified:gate(root,p,'verified')};
 writeJSON(path.join(dir,'resume.json'),r);console.log(JSON.stringify(r,null,2));
}
function publish(message,title){
 ownBranch();account();if(!message||!title)throw Error('publish MESSAGE TITLE required');
 if(!gate(root,p,'verified').ok)throw Error('Run ops verify first');invoke(['tools/security-lint.mjs']);
 if(git('status','--porcelain')){git('add','--all','--','.');git('diff','--cached','--check');git('commit','-m',message);}
 const head=git('rev-parse','HEAD'),branch=ownBranch();git('push','--set-upstream','origin',branch);
 let pr=run('gh',['pr','view',branch,'--repo',p.repository,'--json','number,url,headRefOid,state'],{quiet:true,optional:true});
 if(pr&&JSON.parse(pr).state!=='OPEN')throw Error('Branch already has a closed PR; create next feature branch');
 if(!pr){
  const body=path.join(dir,'pr-body.md');fs.writeFileSync(body,'Source: '+head+'\n\nChanges: '+message+'\n\nLocal source-bound verification passed. Scope: '+p.repository+' / '+p.authorizedHosts.join(', ')+'. No main/stable integration. Hosted CI is required before dev integration.\n');
  gh('pr','create','--repo',p.repository,'--base','dev','--head',branch,'--title',title,'--body-file',body);
  pr=gh('pr','view',branch,'--repo',p.repository,'--json','number,url,headRefOid,state');
 }
 writeJSON(path.join(dir,'publication.json'),JSON.parse(pr));console.log(pr);return JSON.parse(pr);
}
async function checks(number,head,seconds=360){
 const end=Date.now()+seconds*1000;
 while(Date.now()<end){
  const pr=json('pr','view',String(number),'--repo',p.repository,'--json','headRefOid,headRefName,baseRefName,state,isDraft,statusCheckRollup');
  if(pr.headRefOid!==head||pr.baseRefName!=='dev'||!featureBranch(pr.headRefName))throw Error('PR scope/head changed');
  const latest=new Map();for(const x of pr.statusCheckRollup.filter(x=>x.__typename==='CheckRun')){const old=latest.get(x.name);if(!old||Date.parse(x.startedAt)>Date.parse(old.startedAt))latest.set(x.name,x);}
  const all=[...latest.values()],required=all.find(x=>x.name==='Production checks')||all.find(x=>x.name==='Verify and export APK');
  if(all.some(x=>['FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED'].includes(x.conclusion)))throw Error('CI failed: use ops logs RUN_ID');
  if(required?.status==='COMPLETED'&&required.conclusion==='SUCCESS'&&all.every(x=>x.status==='COMPLETED'&&['SUCCESS','SKIPPED','NEUTRAL'].includes(x.conclusion))){writeJSON(path.join(dir,'ci-pr.json'),{number,head,status:'passed',checks:all,observedAt:new Date().toISOString()});return pr;}
  await new Promise(r=>setTimeout(r,5000));
 }
 throw Error('CI wait timeout; resume with wait '+number);
}
async function integrate(number){
 clean();ownBranch();account();const head=git('rev-parse','HEAD'),pr=await checks(number,head);
 if(pr.state!=='OPEN'||pr.isDraft)throw Error('Only open non-draft dev PRs may merge');
 gh('pr','merge',String(number),'--repo',p.repository,'--merge','--match-head-commit',head);
 const done=json('pr','view',String(number),'--repo',p.repository,'--json','state,mergeCommit,url');
 if(done.state!=='MERGED')throw Error('Merge not confirmed');writeJSON(path.join(dir,'integration.json'),done);console.log(JSON.stringify(done));return done.mergeCommit.oid;
}
async function waitDev(commit){
 const end=Date.now()+360000;
 while(Date.now()<end){const runs=json('run','list','--repo',p.repository,'--branch','dev','--event','push','--limit','10','--json','databaseId,headSha,status,conclusion,workflowName,url').filter(r=>r.headSha===commit&&r.workflowName==='Build Android');
  if(runs[0]?.status==='completed'){if(runs[0].conclusion!=='success')throw Error('Dev CI failed '+runs[0].url);writeJSON(path.join(dir,'ci-dev.json'),runs[0]);console.log(JSON.stringify(runs[0]));return runs[0];}
  await new Promise(r=>setTimeout(r,5000));
 }throw Error('Dev wait timeout; no release claimed');
}
const [cmd='resume',...args]=process.argv.slice(2);
try{switch(cmd){
 case 'resume':resume();break;
 case 'begin':clean();if(!featureBranch(args[0]))throw Error('Unsafe branch');git('fetch','origin','dev');git('switch','-c',args[0],'origin/dev');console.log('BRANCH_READY '+args[0]);break;
 case 'apply':applyBundle(root,readJSON(args[0]));break;
 case 'verify':verify();break;
 case 'publish':publish(args[0],args[1]);break;
 case 'wait':await checks(Number(args[0]),git('rev-parse','HEAD'));console.log('CI_PASS');break;
 case 'integrate':await integrate(Number(args[0]));break;
 case 'wait-dev':await waitDev(args[0]);break;
 case 'cycle':{verify();const pr=publish(args[0],args[1]),commit=await integrate(pr.number);await waitDev(commit);break;}
 case 'logs':{const r=run('gh',['run','view',args[0],'--repo',p.repository,'--log-failed'],{quiet:true,optional:true});fs.writeFileSync(path.join(dir,'ci-failure.log'),r||'Logs unavailable');console.log((r||'Logs unavailable').slice(-5000));break;}
 case 'device-status':run(process.execPath,['scripts/device-status.mjs','--config',path.join(workspace,'station.local.json')]);break;
 case 'network':run(process.execPath,['scripts/network-check.mjs','--config',path.join(workspace,'station.local.json')]);break;
 case 'device-suite':run(process.execPath,['scripts/device-suite.mjs','--config',path.join(workspace,'station.local.json'),...args],{timeout:600000});break;
 case 'device-test':run(process.execPath,['scripts/device-test.mjs','--config',path.join(workspace,'station.local.json'),...args],{timeout:240000});break;
 case 'delivery':run(process.execPath,['scripts/update-device.mjs','--config',path.join(workspace,'station.local.json')],{timeout:300000});break;
 case 'emulator':run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/emulator.ps1',...args],{timeout:600000});break;
 case 'candidate':{const head=git('rev-parse','HEAD');const pr=JSON.parse(gh('pr','view',ownBranch(),'--repo',p.repository,'--json','number'));await checks(pr.number,head);const runs=json('run','list','--repo',p.repository,'--branch',ownBranch(),'--event','pull_request','--limit','10','--json','databaseId,headSha,status,conclusion').filter(x=>x.headSha===head&&x.status==='completed'&&x.conclusion==='success');if(!runs.length)throw Error('No verified PR run');const id=runs[0].databaseId,target=path.join(dir,'candidate',String(id));if(!fs.existsSync(target)){fs.mkdirSync(target,{recursive:true});run('gh',['run','download',String(id),'--repo',p.repository,'--name','multimental-android','--dir',target],{timeout:120000,quiet:true});}const manifest=readJSON(path.join(target,'build-manifest.json'));if(manifest.repository!==p.repository||String(manifest.workflowRun)!==String(id))throw Error('Candidate provenance mismatch');writeJSON(path.join(dir,'candidate.json'),{head,pr:pr.number,run:id,directory:target,manifest});console.log(JSON.stringify({directory:target,version:manifest.version,run:id}));break;}
 case 'deploy-agent':run(process.execPath,['scripts/deploy-agent.mjs'],{timeout:120000});break;
 case 'roadmap':console.log(fs.readFileSync(inside(root,'docs/ROADMAP.ru.md'),'utf8'));break;
 default:throw Error('Unknown ops command');
}}catch(e){console.error('OPS_BLOCKED: '+e.message);process.exitCode=1;}
