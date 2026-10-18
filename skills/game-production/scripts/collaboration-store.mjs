import { randomUUID } from 'node:crypto';
import {
  COORD_BRANCH,
  COORD_FILE,
  COORD_REPO,
  emptyCoordination,
  validateCoordination,
  transition
} from './collaboration-policy.mjs';
const READ =
  'query{repository(owner:"neurofoxpro",name:"multimental"){nameWithOwner ref(qualifiedName:"refs/heads/coordination-state"){target{... on Commit{oid}}}}}';
const COMMIT =
  'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}';
export class GitHubCoordination {
  constructor(token, fetcher = fetch) {
    this.token = token;
    this.fetcher = fetcher;
  }
  async call(url, body) {
    if (!this.token) throw Error('Authenticated coordination required');
    const response = await this.fetcher(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
      headers: {
        Authorization: 'Bearer ' + this.token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'multimental-coordination',
        'X-GitHub-Api-Version': '2026-03-10'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw Error('COORD_HTTP_' + response.status);
    const value = await response.json();
    if (value.errors?.length)
      throw Error(
        'COORD_GRAPHQL_REJECTED: ' +
          value.errors
            .map((e) => String(e.message).slice(0, 300))
            .join('; ')
            .slice(0, 900)
      );
    return value;
  }
  async read() {
    const data = (await this.call('https://api.github.com/graphql', { query: READ })).data
      ?.repository;
    if (data?.nameWithOwner !== COORD_REPO) throw Error('Wrong coordination repository');
    if (!data.ref) return null;
    const commit = data.ref.target;
    if (!/^[a-f0-9]{40}$/.test(commit?.oid || '')) throw Error('Invalid coordination ref');
    const response = await this.fetcher(
      'https://api.github.com/repos/' +
        COORD_REPO +
        '/contents/' +
        COORD_FILE +
        '?ref=' +
        commit.oid,
      {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
        headers: {
          Authorization: 'Bearer ' + this.token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'multimental-coordination'
        }
      }
    );
    if (response.status === 404) return { head: commit.oid, state: null };
    if (!response.ok) throw Error('COORD_READ_HTTP_' + response.status);
    const file = await response.json();
    if (
      file.type !== 'file' ||
      file.encoding !== 'base64' ||
      file.path !== COORD_FILE ||
      file.size > 262144
    )
      throw Error('Invalid coordination file response');
    const text = Buffer.from(file.content, 'base64').toString('utf8');
    if (text !== undefined && (typeof text !== 'string' || text.length > 262144))
      throw Error('Oversized/invalid coordination state');
    return {
      head: commit.oid,
      state: text === undefined ? emptyCoordination() : validateCoordination(JSON.parse(text))
    };
  }
  async initialize(base) {
    if (!/^[a-f0-9]{40}$/.test(base)) throw Error('Exact bootstrap source required');
    const current = await this.read();
    if (current?.state) return current;
    if (current) return this.initializeFile(current, base);
    try {
      await this.call('https://api.github.com/repos/' + COORD_REPO + '/git/refs', {
        ref: 'refs/heads/' + COORD_BRANCH,
        sha: base
      });
    } catch (error) {
      const found = await this.read();
      if (!found) throw error;
      return found.state ? found : this.initializeFile(found, base);
    }
    const result = await this.read();
    if (!result) throw Error('Coordination ref not observed');
    return result.state ? result : this.initializeFile(result, base);
  }
  async initializeFile(current, base) {
    if (current.head !== base)
      throw Error('Uninitialized state on unknown history; preserve and inspect');
    let failure = null;
    try {
      await this.compareAndSwap(current.head, emptyCoordination(), randomUUID());
    } catch (error) {
      failure = error;
    }
    const actual = await this.read();
    if (!actual?.state) throw failure || Error('Initialization not observed');
    return actual;
  }
  async compareAndSwap(head, state, id) {
    validateCoordination(state);
    if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9-]{36}$/.test(id))
      throw Error('Invalid expected source');
    const bytes = JSON.stringify(state, null, 2) + '\n';
    if (Buffer.byteLength(bytes) > 262144) throw Error('Coordination capacity reached');
    const input = {
      branch: { repositoryNameWithOwner: COORD_REPO, branchName: COORD_BRANCH },
      expectedHeadOid: head,
      message: { headline: 'coord: ' + id },
      fileChanges: {
        additions: [{ path: COORD_FILE, contents: Buffer.from(bytes).toString('base64') }]
      },
      clientMutationId: id
    };
    const data = await this.call('https://api.github.com/graphql', {
      query: COMMIT,
      variables: { input }
    });
    const oid = data.data?.createCommitOnBranch?.commit?.oid;
    if (!/^[a-f0-9]{40}$/.test(oid || '')) throw Error('Unconfirmed coordination commit');
    return oid;
  }
}
export async function coordinate(
  store,
  request,
  { now = Date.now, pause = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 5 } = {}
) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 8)
    throw Error('Bounded coordination attempts required');
  for (let n = 0; n < attempts; n++) {
    const before = await store.read();
    if (!before?.state) throw Error('Run collab init first');
    const change = transition(before.state, request, now());
    if (!change.changed) return { ...change.result, coordinationHead: before.head, replayed: true };
    let failure = null;
    try {
      await store.compareAndSwap(before.head, change.state, request.id);
    } catch (error) {
      failure = error;
    }
    const after = await store.read();
    if (!after) throw Error('Coordination disappeared; no retry');
    const event = after.state.events.find((e) => e.id === request.id);
    if (event) {
      const confirmed = transition(after.state, request, now());
      return {
        ...confirmed.result,
        coordinationHead: after.head,
        readback: true,
        recoveredReply: !!failure
      };
    }
    if (!failure || after.head === before.head)
      throw failure || Error('Write missing from readback');
    if (n + 1 < attempts) await pause(150 * (n + 1));
  }
  throw Error('COORD_CONTENTION: retry the same operation identity');
}
