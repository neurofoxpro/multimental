import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shipFlow,
  compactPacket,
  releaseEvidence,
  assertPull,
  assertBuild,
  assertProof,
  assertTaskContext,
  REPO
} from '../scripts/short-workflow-core.mjs';
const A = 'a'.repeat(40),
  B = 'b'.repeat(40),
  C = 'c'.repeat(40),
  D = 'd'.repeat(64);
const task = {
  id: 'AUTO-06',
  kind: 'automation',
  title: 'One workflow',
  blockedBy: [],
  readset: [],
  acceptance: ['exact criterion']
};
function fixture() {
  const state = {
    j: null,
    published: false,
    merged: false,
    source: D,
    head: A,
    dirty: true,
    checks: 0,
    publishes: 0,
    settles: 0,
    waits: 0,
    records: 0,
    renews: 0,
    progress: []
  };
  const pr = () => ({
    number: 123,
    state: state.merged ? 'closed' : 'open',
    draft: false,
    head: { sha: B, ref: 'feature/one', repo: { full_name: REPO } },
    base: { ref: 'dev', repo: { full_name: REPO } },
    merged_at: state.merged ? '2026-09-26T08:00:00Z' : null,
    merge_commit_sha: state.merged ? C : null
  });
  const releases = () => [
    {
      id: 9,
      tag_name: 'v0.12.0-alpha.1',
      target_commitish: C,
      draft: false,
      prerelease: true,
      assets: [
        { name: 'build-manifest.json', size: 20, state: 'uploaded', digest: 'sha256:' + D },
        { name: 'multimental-debug.apk', size: 500, state: 'uploaded', digest: 'sha256:' + D }
      ]
    }
  ];
  const a = {
    current: async () => ({
      repository: REPO,
      head: state.head,
      branch: 'feature/one',
      dirty: state.dirty,
      binding: { task: task.id, branch: 'feature/one', owner: 'chat-one', token: 'operation-one' }
    }),
    load: async () => structuredClone(state.j),
    save: async (j) => {
      state.j = structuredClone(j);
    },
    now: () => '2026-09-26T08:00:00Z',
    digest: () => state.source,
    verified: () => true,
    progress: (p) => state.progress.push(p),
    renew: async () => {
      state.renews++;
    },
    check: async () => {
      state.checks++;
    },
    publish: async () => {
      state.publishes++;
      state.published = true;
      state.dirty = false;
      state.head = B;
    },
    findPublished: async () => (state.published && !state.dirty ? pr() : null),
    pull: async () => pr(),
    changedFiles: async () => ['game/src/main.gd'],
    settle: async () => {
      state.settles++;
      state.merged = true;
    },
    waitDev: async (merge) => {
      state.waits++;
      return {
        headSha: merge,
        workflowName: 'Build Android',
        databaseId: 55,
        status: 'completed',
        conclusion: 'success'
      };
    },
    releases: async () => releases(),
    record: async () => {
      state.records++;
    }
  };
  return { a, state, pr, releases };
}
test('one command checks publishes settles waits and records distinct results', async () => {
  const { a, state } = fixture();
  const result = await shipFlow(a, task);
  assert.equal(result.phase, 'complete');
  assert.equal(result.release.status, 'published');
  assert.equal(result.installation, 'separate_device_stage');
  assert.equal(result.humanAcceptance, 'not_inferred');
  assert.equal(result.productionAuthorized, false);
  assert.deepEqual([state.checks, state.publishes, state.settles, state.records], [1, 1, 1, 1]);
  assert.deepEqual(state.progress, ['checking', 'publish_pending', 'ci', 'release', 'record']);
});
test('repeated completed command rechecks remote state without a second write', async () => {
  const { a, state } = fixture();
  await shipFlow(a, task);
  const repeated = await shipFlow(a, task);
  assert.equal(repeated.replayedCompletion, true);
  assert.deepEqual(
    [state.checks, state.publishes, state.settles, state.records, state.waits],
    [1, 1, 1, 1, 2]
  );
});
test('publish lost acknowledgement resolves exact existing PR without republishing', async () => {
  const { a, state } = fixture();
  const publish = a.publish;
  a.publish = async () => {
    await publish();
    throw Error('lost reply');
  };
  await assert.rejects(shipFlow(a, task), /lost reply/);
  assert.equal(state.j.phase, 'publish_pending');
  await shipFlow(a, task);
  assert.equal(state.publishes, 1);
});
test('merge lost acknowledgement resolves live merged PR without another merge', async () => {
  const { a, state } = fixture();
  const settle = a.settle;
  a.settle = async () => {
    await settle();
    throw Error('lost merge reply');
  };
  await assert.rejects(shipFlow(a, task), /lost merge/);
  await shipFlow(a, task);
  assert.equal(state.settles, 1);
  assert.equal(state.j.merge, C);
});
test('failed CI remains blocked and can resume without publish', async () => {
  const { a, state } = fixture();
  const settle = a.settle;
  a.settle = async () => {
    throw Error('CI failed');
  };
  await assert.rejects(shipFlow(a, task), /CI failed/);
  assert.equal(state.records, 0);
  assert.equal(state.j.phase, 'ci');
  a.settle = settle;
  await shipFlow(a, task);
  assert.equal(state.publishes, 1);
});
test('memory failure resumes recording but not publication or integration', async () => {
  const { a, state } = fixture();
  a.record = async () => {
    state.records++;
    if (state.records === 1) throw Error('memory unavailable');
  };
  await assert.rejects(shipFlow(a, task), /memory unavailable/);
  await shipFlow(a, task);
  assert.deepEqual([state.records, state.publishes, state.settles], [2, 1, 1]);
});
for (const [name, mutation] of [
  [
    'source bytes',
    (s) => {
      s.source = 'f'.repeat(64);
    }
  ],
  [
    'new head',
    (s) => {
      s.head = A;
    }
  ],
  [
    'dirty source',
    (s) => {
      s.dirty = true;
    }
  ],
  [
    'other claim',
    (s) => {
      s.j.token = 'foreign';
    }
  ],
  [
    'unknown checkpoint stage',
    (s) => {
      s.j.phase = 'skip-tests';
    }
  ]
])
  test('resumption rejects ' + name, async () => {
    const { a, state } = fixture();
    await shipFlow(a, task);
    mutation(state);
    await assert.rejects(shipFlow(a, task), /SHIP_/);
    assert.equal(state.publishes, 1);
  });
test('a prior passing exit alone cannot replace the verified source gate', async () => {
  const { a, state } = fixture();
  a.verified = () => false;
  await assert.rejects(shipFlow(a, task), /LOCAL_VERIFICATION/);
  assert.equal(state.publishes, 0);
});
for (const kind of ['product', 'subjective', 'release_approval', 'external'])
  test('does not ship human gate ' + kind, async () => {
    const { a, state } = fixture();
    await assert.rejects(shipFlow(a, { ...task, kind }), /SHIP_SCOPE/);
    assert.equal(state.checks, 0);
  });
test('does not ship blocked dependencies', async () => {
  const { a } = fixture();
  await assert.rejects(shipFlow(a, { ...task, blockedBy: ['CORE-09'] }), /DEPENDENCIES/);
});
test('docs-only integration does not require or invent a new APK', async () => {
  const { a } = fixture();
  a.changedFiles = async () => ['docs/production/report.md'];
  a.releases = async () => [];
  const result = await shipFlow(a, task);
  assert.equal(result.release.status, 'not_required_docs_only');
});
test('changed source after check before published readback is rejected', async () => {
  const { a, state } = fixture();
  const publish = a.publish;
  a.publish = async () => {
    await publish();
    state.source = 'e'.repeat(64);
  };
  await assert.rejects(shipFlow(a, task), /PUBLICATION_NOT_PROVEN/);
  assert.equal(state.settles, 0);
});
for (const change of [
  (r) => {
    r[0].target_commitish = A;
  },
  (r) => {
    r[0].assets.pop();
  },
  (r) => {
    r[0].assets[0].digest = '';
  },
  (r) => {
    r[0].draft = true;
  },
  (r) => {
    r.push(structuredClone(r[0]));
  },
  (r) => {
    r[0].assets[0].state = 'new';
  }
])
  test('incomplete release cannot finish the pipeline', async () => {
    const { a, state, releases } = fixture();
    const rows = releases();
    change(rows);
    a.releases = async () => rows;
    await assert.rejects(shipFlow(a, task), /SHIP_RELEASE/);
    assert.equal(state.records, 0);
  });
test('exact dev build source and success are mandatory', () => {
  assert.throws(() => assertBuild({ headSha: A, conclusion: 'success' }, C));
  assert.throws(() =>
    assertBuild(
      {
        headSha: C,
        conclusion: 'failure',
        status: 'completed',
        workflowName: 'Build Android',
        databaseId: 1
      },
      C
    )
  );
});
test('main, foreign repository and source swap cannot be accepted as dev', () => {
  const { pr } = fixture();
  const p = pr();
  p.base.ref = 'main';
  assert.throws(() => assertPull(p, 'feature/one', B));
  p.base.ref = 'dev';
  p.head.repo.full_name = 'elsewhere/repo';
  assert.throws(() => assertPull(p, 'feature/one', B));
  assert.throws(() => assertTaskContext({ repository: REPO, branch: 'dev', head: A }, task));
});
test('compact context is explicit about omissions and only marks changed inputs', () => {
  const comments = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    body: 'x'.repeat(2000),
    user: { login: '4erk' }
  }));
  const files = [
    { path: 'AGENTS.md', sha256: D },
    { path: 'next.md', sha256: D }
  ];
  const result = compactPacket({
    snapshot: { repository: REPO, observedAt: 'now' },
    task,
    comments,
    files,
    previous: { files: [files[0]] },
    source: { head: A }
  });
  assert.equal(result.history.length, 3);
  assert.equal(result.historyOmitted, 7);
  assert.equal(result.history[0].truncated, true);
  assert.deepEqual(result.changedInputs, ['next.md']);
  assert.equal(result.fullCommand, 'npm run game -- task AUTO-06');
  assert.ok(JSON.stringify(result).length < JSON.stringify(comments).length / 2);
});
function proof() {
  return {
    schemaVersion: 1,
    repository: REPO,
    taskId: task.id,
    sourceCommit: C,
    implementation: { pr: 12, head: B },
    verification: {
      status: 'passed',
      exitCode: 0,
      sourceDigest: D,
      sourceDigestAfter: D,
      logHash: D
    },
    observedAt: '2026-09-26T08:00:00Z',
    acceptance: task.acceptance,
    evidence: ['docs/production/proof.md']
  };
}
test('acceptance proof binds exact task criteria and does not accept missing results', () => {
  assert.equal(assertProof(proof(), task), true);
  for (const change of [
    (p) => {
      p.acceptance = ['other'];
    },
    (p) => {
      p.verification.status = 'failed';
    },
    (p) => {
      p.verification.sourceDigestAfter = 'f'.repeat(64);
    },
    (p) => {
      p.evidence = ['../private'];
    },
    (p) => {
      p.implementation.head = '';
    },
    (p) => {
      p.observedAt = 'invalid';
    }
  ]) {
    const value = proof();
    change(value);
    assert.throws(() => assertProof(value, task));
  }
  assert.throws(() => assertProof(proof(), { ...task, kind: 'product' }));
});

test('source changes during the dev wait prevent a completion record', async () => {
  const { a, state } = fixture();
  const wait = a.waitDev;
  a.waitDev = async (head) => {
    const result = await wait(head);
    state.dirty = true;
    return result;
  };
  await assert.rejects(shipFlow(a, task), /SOURCE_MOVED_DURING_STAGE/);
  assert.equal(state.records, 0);
});
test('source changes during recording leave a non-complete checkpoint', async () => {
  const { a, state } = fixture();
  a.record = async () => {
    state.dirty = true;
  };
  await assert.rejects(shipFlow(a, task), /SOURCE_MOVED_DURING_STAGE/);
  assert.equal(state.j.phase, 'record');
});
