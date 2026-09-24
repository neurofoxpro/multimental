export function assertQualification(report,{head,apkHash,toolDigest,physical=false}){
 if(report.status!=='passed'||report.candidateHead!==head||report.apk?.sha256!==apkHash||report.toolDigest!==toolDigest)throw Error('Stale, absent or failed device qualification');
 const names=['emulator-A-install','emulator-A-ui','emulator-A-reinstall','emulator-B-install','emulator-B-ui','emulator-B-reinstall','emulator-pair'];
 if(physical)names.push('phone-install','phone-ui','phone-tcp-usb','phone-tcp-lan','phone-bluetooth','phone-reinstall');
 if(!Array.isArray(report.results)||report.results.some(r=>r.status!=='passed'))throw Error('Device checks failed');
 for(const name of names)if(!report.results.some(r=>r.name===name&&r.status==='passed'))throw Error('Required device check missing: '+name);
 return true;
}
export function updateDisposition({currentCode,candidateCode,currentHash,candidateHash}){
 if(!Number.isSafeInteger(candidateCode)||candidateCode<=0)throw Error('Invalid candidate versionCode');
 if(currentCode>candidateCode)return 'newer_candidate_installed';
 if(currentCode===candidateCode&&currentHash===candidateHash)return 'already_current';
 if(currentCode===candidateCode&&currentHash&&currentHash!==candidateHash)return 'same_version_conflict';
 return 'install';
}
