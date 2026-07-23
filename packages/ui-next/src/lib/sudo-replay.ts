export interface SudoReplayField {
  name: string;
  value: string;
}

function serializeReplayValue(name: string, value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  throw new TypeError(`身份验证重放字段 ${name} 不是可提交的标量`);
}

function expandReplayValues(name: string, raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [raw];

  const entries = Object.entries(raw);
  if (!entries.length || entries.some(([key]) => !/^(0|[1-9]\d*)$/.test(key))) {
    throw new TypeError(`身份验证重放字段 ${name} 不是可提交的重复字段`);
  }
  entries.sort(([left], [right]) => Number(left) - Number(right));
  if (entries.some(([key], index) => Number(key) !== index)) {
    throw new TypeError(`身份验证重放字段 ${name} 的顺序无效`);
  }
  return entries.map(([, value]) => value);
}

export function buildSudoReplayFields(args: unknown): SudoReplayField[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('身份验证重放参数无效');
  const fields: SudoReplayField[] = [];
  for (const [name, raw] of Object.entries(args)) {
    if (name === '__start' || raw === undefined || raw === null) continue;
    const values = expandReplayValues(name, raw);
    for (const value of values) fields.push({ name, value: serializeReplayValue(name, value) });
  }
  return fields;
}

export function resolveSudoReplayTarget(method: unknown, redirect: unknown): string {
  if (String(method).toLowerCase() !== 'post') throw new TypeError('身份验证仅支持重放 POST 操作');
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) {
    throw new TypeError('身份验证重放地址无效');
  }
  return redirect;
}

/**
 * Hydro represents a redirect from a JSON request as `{ url }` with HTTP 200.
 * Only the canonical same-origin sudo endpoint is valid for permission mutations.
 */
export function resolveSudoChallengeUrl(payload: unknown, currentHref: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof (payload as { url?: unknown }).url !== 'string') {
    return null;
  }
  const current = new URL(currentHref);
  const destination = new URL((payload as { url: string }).url, current);
  if (destination.origin !== current.origin || destination.pathname !== '/user/sudo' || destination.search || destination.hash) {
    throw new TypeError('权限操作返回了无效的身份验证地址');
  }
  return destination.href;
}
