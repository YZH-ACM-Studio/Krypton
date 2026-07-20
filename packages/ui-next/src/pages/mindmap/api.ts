import type { MindmapSnapshot, PanelProblem, ProblemOption } from './types';

export interface MindmapApiErrorDetails {
  reason?: string;
  problems?: ProblemOption[];
}

export class MindmapApiError extends Error {
  status: number;
  details?: MindmapApiErrorDetails;

  constructor(message: string, status: number, details?: MindmapApiErrorDetails) {
    super(message);
    this.name = 'MindmapApiError';
    this.status = status;
    this.details = details;
  }
}

export function mindmapProblemHref(problem: { domainId?: string; pid: string }): string {
  return problem.domainId && problem.domainId !== 'system'
    ? `/d/${encodeURIComponent(problem.domainId)}/p/${encodeURIComponent(problem.pid)}`
    : `/p/${encodeURIComponent(problem.pid)}`;
}

async function errorFromResponse(response: Response, fallback: string): Promise<MindmapApiError> {
  let message = fallback;
  let details: MindmapApiErrorDetails | undefined;
  try {
    const body = await response.json();
    const params = Array.isArray(body?.error?.params) ? body.error.params : [];
    if (typeof params[0] === 'string' && params[0].trim()) message = params[0];
    else if (typeof body?.error?.message === 'string' && body.error.message.trim() && !body.error.message.includes('{0}')) {
      message = body.error.message;
    } else if (typeof body?.error === 'string' && body.error.trim()) message = body.error;
    if (params[1] && typeof params[1] === 'object') details = params[1] as MindmapApiErrorDetails;
  } catch {
    // The HTTP status remains authoritative when an upstream renderer returns
    // non-JSON. Do not convert it into a successful empty result.
  }
  return new MindmapApiError(message, response.status, details);
}

function assertSnapshot(value: unknown): asserts value is MindmapSnapshot {
  const snapshot = value as Partial<MindmapSnapshot> | null;
  if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.maps)) {
    throw new MindmapApiError('服务器返回的导图快照格式无效', 500);
  }
  if (snapshot.config !== null && (!snapshot.config || typeof snapshot.config !== 'object')) {
    throw new MindmapApiError('服务器返回的当前导图格式无效', 500);
  }
  if (!snapshot.referenceCounts || typeof snapshot.referenceCounts !== 'object') {
    throw new MindmapApiError('服务器未返回节点引用状态', 500);
  }
}

export async function mutateMindmap(operation: 'create' | 'update' | 'move' | 'delete', payload: Record<string, unknown>): Promise<MindmapSnapshot> {
  const form = new URLSearchParams();
  form.set('operation', operation);
  form.set('payload', JSON.stringify(payload));
  const response = await fetch('/admin/mindmap/nodes', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!response.ok) throw await errorFromResponse(response, `导图操作失败（HTTP ${response.status}）`);
  const body = await response.json();
  assertSnapshot(body);
  return body;
}

export async function mutateKnowledgeMap(operation: 'create' | 'update' | 'delete', payload: Record<string, unknown>): Promise<MindmapSnapshot> {
  const form = new URLSearchParams();
  form.set('operation', operation);
  form.set('payload', JSON.stringify(payload));
  const response = await fetch('/admin/mindmap/maps', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!response.ok) throw await errorFromResponse(response, `导图操作失败（HTTP ${response.status}）`);
  const body = await response.json();
  assertSnapshot(body);
  return body;
}

export async function loadNodeProblems(mapId: string, nodeId: string, admin: boolean): Promise<PanelProblem[]> {
  const endpoint = admin ? '/api/mindmap/admin/node-problems' : '/api/mindmap/problems';
  const response = await fetch(`${endpoint}?mapId=${encodeURIComponent(mapId)}&nodeId=${encodeURIComponent(nodeId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await errorFromResponse(response, `关联题目加载失败（HTTP ${response.status}）`);
  const body = await response.json();
  if (!Array.isArray(body?.problems)) throw new MindmapApiError('服务器返回的关联题目格式无效', 500);
  return body.problems as PanelProblem[];
}

export async function searchMindmapProblems(mapId: string, query: string, signal?: AbortSignal): Promise<ProblemOption[]> {
  const response = await fetch(`/api/mindmap/admin/problems?mapId=${encodeURIComponent(mapId)}&q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response, `题目搜索失败（HTTP ${response.status}）`);
  const body = await response.json();
  if (!Array.isArray(body?.problems)) throw new MindmapApiError('服务器返回的题目搜索结果格式无效', 500);
  return body.problems as ProblemOption[];
}
