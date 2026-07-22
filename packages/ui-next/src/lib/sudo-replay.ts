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

export function buildSudoReplayFields(args: unknown): SudoReplayField[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('身份验证重放参数无效');
  const fields: SudoReplayField[] = [];
  for (const [name, raw] of Object.entries(args)) {
    if (name === '__start' || raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
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
