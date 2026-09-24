export async function awaitDelivery({expectedCommit,current,attempt,timeoutMs=300000,intervalMs=15000,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!/^[a-f0-9]{40}$/.test(expectedCommit||''))throw Error('Exact expected deployment commit required');
 const started=now();const attempts=[];
 const accepted=r=>r?.sourceCommit===expectedCommit&&r.readyMarker===true&&r.observedVersionMatches===true;
 let actual=await current();if(accepted(actual))return {status:'passed',alreadyInstalled:true,attempts,actual};
 while(now()-started<timeoutMs){const result=await attempt();attempts.push({status:result?.status||'unknown',elapsedMs:Math.round(now()-started)});actual=await current();if(accepted(actual))return {status:'passed',attempts,actual};if(result?.status==='same_version_conflict')throw Error('Deployment conflict');const remaining=timeoutMs-(now()-started);if(remaining<=0)break;await sleep(Math.min(intervalMs,remaining));}
 throw Error('Expected release not installed before bounded deadline; resume delivery, do not repeat development');
}
