export function teamSummary({ snapshot, claims, locals, pulls, dispatch, now = Date.now() }) {
  if (
    snapshot?.source !== 'github-issues' ||
    snapshot.missing?.length ||
    !Array.isArray(claims) ||
    !Array.isArray(locals) ||
    !Array.isArray(pulls)
  )
    throw Error('Live complete team inputs required');
  const workers = claims.map((claim) => {
    const task = snapshot.records.find((r) => r.task.id === claim.task);
    if (!task) throw Error('Claim task missing from live memory');
    const matches = locals.filter((l) => l.token === claim.token),
      local = matches.length === 1 ? matches[0] : null;
    const prs = local ? pulls.filter((p) => p.head?.ref === local.branch) : [];
    const open = prs.filter((p) => p.state === 'open');
    return {
      owner: claim.owner,
      task: claim.task,
      issue: task.issue,
      title: task.task.title,
      resources: claim.resources,
      heartbeatExpired: claim.expiresAt < now,
      branch: local?.branch || null,
      head: local?.head || null,
      localState:
        matches.length !== 1
          ? 'unresolved_preserve'
          : local.error
            ? 'unreadable_preserve'
            : local.dirtyPaths.length
              ? 'draft_preserved'
              : 'clean',
      dirtyPaths: local?.dirtyPaths || [],
      pendingOperations: local?.locks || [],
      openPRs: open.map((p) => ({ number: p.number, url: p.html_url, head: p.head.sha })),
      lastMergedPR:
        prs.filter((p) => p.merged_at).sort((a, b) => b.number - a.number)[0]?.number || null,
      automaticTakeover: false,
      nextAction: local?.dirtyPaths.length
        ? 'Continue this exact owner/worktree; do not copy or overwrite the draft'
        : 'Read live task and own checkpoint; do not infer completion from heartbeat'
    };
  });
  const overlaps = [];
  for (let i = 0; i < workers.length; i++)
    for (let j = i + 1; j < workers.length; j++) {
      const paths = workers[i].dirtyPaths.filter((p) => workers[j].dirtyPaths.includes(p));
      if (paths.length)
        overlaps.push({
          owners: [workers[i].owner, workers[j].owner],
          paths,
          action: 'Serialize shared-file integration; preserve both drafts'
        });
    }
  return {
    schemaVersion: 1,
    repository: 'neurofoxpro/multimental',
    observedAt: new Date(now).toISOString(),
    source: 'live_Issues_claims_PRs_and_registered_worktrees',
    chatTranscriptsRead: false,
    workers,
    overlaps,
    ready: dispatch.ready.map((t) => ({
      task: t.id,
      issue: t.issue,
      title: t.title,
      tags: t.tags,
      resources: t.resources
    })),
    waves: dispatch.waves,
    recentMerged: pulls
      .filter((p) => p.merged_at)
      .sort((a, b) => b.number - a.number)
      .slice(0, 8)
      .map((p) => ({
        number: p.number,
        url: p.html_url,
        branch: p.head.ref,
        head: p.head.sha,
        merge: p.merge_commit_sha,
        mergedAt: p.merged_at
      })),
    agentsStarted: 0,
    claimsChanged: false
  };
}
