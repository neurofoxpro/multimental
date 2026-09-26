import { REPO } from './hub-identity.mjs';
const BRANCH = /^(feature|fix|docs|test)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const allowedBranch = (branch) =>
  typeof branch === 'string' && BRANCH.test(branch) && !branch.includes('..');
export function allowedEndpoint(method, endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/') || /\.\.|[\\\0#]/.test(endpoint))
    return false;
  const p = endpoint.split('?')[0];
  if (method === 'GET' && (p === '/labels' || /^\/issues\/\d+\/dependencies\/blocked_by$/.test(p)))
    return true;
  if (
    method === 'POST' &&
    (p === '/labels' || /^\/issues\/\d+\/(labels|dependencies\/blocked_by)$/.test(p))
  )
    return true;
  if (
    method === 'DELETE' &&
    /^\/issues\/\d+\/labels\/gp%3A(status|priority|area)%3A[a-z0-9-]+$/.test(p)
  )
    return true;
  if (method === 'GET')
    return /^\/(issues(?:\/\d+(?:\/comments)?)?|pulls(?:\/\d+(?:\/files|\/reviews|\/commits)?)?|actions\/runs(?:\/\d+(?:\/jobs|\/artifacts)?)?|git\/ref\/heads\/[A-Za-z0-9._/-]+|commits\/[a-f0-9]{40}(?:\/check-runs)?|releases|collaborators\/[A-Za-z0-9_-]+\/permission)$/.test(
      p
    );
  if (method === 'POST')
    return (
      p === '/issues' ||
      p === '/pulls' ||
      /^\/issues\/\d+\/comments$/.test(p) ||
      /^\/pulls\/\d+\/reviews$/.test(p) ||
      /^\/actions\/workflows\/(build|production-control)\.yml\/dispatches$/.test(p)
    );
  if (method === 'PATCH') return /^\/issues\/(?:\d+|comments\/\d+)$/.test(p);
  return method === 'PUT' && /^\/pulls\/\d+\/merge$/.test(p);
}

export function assertWriter(env) {
  if (
    env.GITHUB_ACTIONS === 'true' &&
    (env.GITHUB_REPOSITORY !== REPO ||
      !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) ||
      !['4erk', 'venelsendrik'].includes(env.GITHUB_ACTOR) ||
      !(allowedBranch(env.GITHUB_REF_NAME) || env.GITHUB_REF_NAME === 'dev'))
  )
    throw Error('HUB_UNTRUSTED_WRITER_CONTEXT');
  return true;
}

export class HubClient {
  constructor(token, { fetcher = fetch, pause = sleep, timeout = 25000 } = {}) {
    this.token = token;
    this.fetcher = fetcher;
    this.pause = pause;
    this.timeout = timeout;
  }
  async api(method, endpoint, body) {
    if (!allowedEndpoint(method, endpoint)) throw Error('HUB_ENDPOINT_DENIED');
    if (method !== 'GET' && !this.token) throw Error('HUB_WRITE_AUTH_REQUIRED');
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.fetcher('https://api.github.com/repos/' + REPO + endpoint, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeout),
          headers: {
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'multimental-production',
            ...(this.token ? { Authorization: 'Bearer ' + this.token } : {})
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch {
        // Never repeat an ambiguous write. Callers must read back by operation identity.
        throw Error(
          method === 'GET' ? 'HUB_READ_UNAVAILABLE' : 'HUB_WRITE_UNKNOWN_READBACK_REQUIRED'
        );
      }
      if (method === 'GET' && [429, 502, 503, 504].includes(response.status) && attempt < 2) {
        await this.pause(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok)
        throw Error('HUB_HTTP_' + response.status + ' ' + method + ' ' + endpoint.split('?')[0]);
      if (response.status === 204) return {};
      return response.json();
    }
  }
  async list(endpoint, key = null) {
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const value = await this.api(
        'GET',
        endpoint + (endpoint.includes('?') ? '&' : '?') + 'per_page=100&page=' + page
      );
      const rows = key ? value[key] : value;
      if (!Array.isArray(rows)) throw Error('HUB_INVALID_PAGE');
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw Error('HUB_PAGINATION_LIMIT');
  }
}
