import type { ProblemKind } from '@hydrooj/common';

type JsonRecord = Record<string, unknown>;

function substituteHydroErrorParams(template: string, params: unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (token, rawIndex) => {
    const value = params[Number(rawIndex)];
    return value === undefined || value === null ? token : String(value);
  });
}

/** Read Hydro's JSON error envelope without leaking untranslated `{0}` placeholders. */
export async function readHydroResponseError(response: Response, fallback: string): Promise<string> {
  let raw = '';
  try {
    raw = await response.text();
  } catch (error) {
    console.error('Failed to read Hydro error response', error);
    return `${fallback}：HTTP ${response.status}`;
  }
  if (raw) {
    try {
      const body = JSON.parse(raw);
      const error = body?.error;
      const message = error?.message || body?.message || error;
      const params = Array.isArray(error?.params) ? error.params : [];
      if (typeof message === 'string' && message.trim()) return substituteHydroErrorParams(message.trim(), params);
    } catch {
      const plain = raw.trim();
      if (plain && !/^<!doctype\s+html/i.test(plain) && !/^<html/i.test(plain)) return plain.slice(0, 180);
    }
  }
  return `${fallback}：HTTP ${response.status}`;
}

async function readExplicitJsonSuccess(response: Response): Promise<JsonRecord> {
  if (response.redirected) throw new Error('保存请求发生了非预期重定向，服务器未确认保存成功');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('保存响应不是 JSON，服务器未确认保存成功');
  const body = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.ok !== true) {
    throw new Error('保存响应缺少明确的成功标记');
  }
  return body as JsonRecord;
}

/** Validate the server-side problem-save contract before any dirty state is cleared. */
export async function readProblemSaveSuccess(response: Response, expectedKind: ProblemKind): Promise<{ pid: string; destination: string }> {
  const body = await readExplicitJsonSuccess(response);
  const pid = body.pid === undefined || body.pid === null ? '' : String(body.pid);
  if (!pid) throw new Error('保存响应缺少真实题号');
  if (body.problemKind !== expectedKind) throw new Error('保存响应题型与当前编辑器不一致');
  if (typeof body.url !== 'string' || !body.url) throw new Error('保存响应缺少后续页面地址');

  const destination = new URL(body.url, window.location.href);
  if (destination.origin !== window.location.origin) throw new Error('保存响应跳转到了非本站地址');
  const segments = destination.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  const problemSegment = segments.lastIndexOf('p');
  const suffix = problemSegment >= 0 ? segments.slice(problemSegment + 2) : [];
  if (
    problemSegment < 0 ||
    segments[problemSegment + 1] !== pid ||
    suffix.length > 1 ||
    (suffix.length === 1 && suffix[0] !== 'edit' && suffix[0] !== 'files')
  ) {
    throw new Error('保存响应地址与已保存题目不一致');
  }
  return { pid, destination: destination.href };
}

/** Validate config.yaml upload instead of treating an arbitrary same-origin 2xx as success. */
export async function readProblemConfigUploadSuccess(response: Response): Promise<void> {
  const body = await readExplicitJsonSuccess(response);
  if (body.operation !== 'upload_file' || body.type !== 'testdata' || body.filename !== 'config.yaml') {
    throw new Error('评测配置保存响应与请求不一致');
  }
}
