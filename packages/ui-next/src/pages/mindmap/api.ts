import { fetchHydroResponse, presentHydroResponseError } from '@/lib/error-presenter';
import { readMindmapSnapshot, type MindmapSnapshot, type PanelProblem, type ProblemOption } from './types';

export interface MindmapApiErrorDetails {
  reason?: string;
  problems?: ProblemOption[];
}

export interface CourseNodeSettingsInput {
  nodeId: string;
  expectedUpdatedAt: string;
  visibility: 'public' | 'hidden';
  ownerUids: number[];
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
  const presented = await presentHydroResponseError(response, fallback);
  const rawDetails = presented.payload?.params[1];
  const details = rawDetails && typeof rawDetails === 'object' ? (rawDetails as MindmapApiErrorDetails) : undefined;
  return new MindmapApiError(presented.message, response.status, details);
}

function readSnapshot(value: unknown): MindmapSnapshot {
  try {
    return readMindmapSnapshot(value);
  } catch (error) {
    if (error instanceof MindmapApiError) throw error;
    const message = error instanceof Error && error.message ? error.message : '服务器返回的导图快照格式无效';
    throw new MindmapApiError(message, 500);
  }
}

export async function mutateMindmap(operation: 'create' | 'update' | 'move' | 'delete', payload: Record<string, unknown>): Promise<MindmapSnapshot> {
  const form = new URLSearchParams();
  form.set('operation', operation);
  form.set('payload', JSON.stringify(payload));
  const response = await fetchHydroResponse('/admin/mindmap/nodes', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!response.ok) throw await errorFromResponse(response, `导图操作失败（HTTP ${response.status}）`);
  return readSnapshot(await response.json());
}

export async function mutateKnowledgeMap(operation: 'update', payload: Record<string, unknown>): Promise<MindmapSnapshot> {
  const form = new URLSearchParams();
  form.set('operation', operation);
  form.set('payload', JSON.stringify(payload));
  const response = await fetchHydroResponse('/admin/mindmap/maps', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!response.ok) throw await errorFromResponse(response, `导图操作失败（HTTP ${response.status}）`);
  return readSnapshot(await response.json());
}

export async function saveCourseNodeSettings(input: CourseNodeSettingsInput): Promise<MindmapSnapshot> {
  if (!Array.isArray(input.ownerUids) || input.ownerUids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
    throw new MindmapApiError('负责教师必须是正整数', 400);
  }
  const form = new URLSearchParams();
  form.set('operation', 'settings');
  form.set('payload', JSON.stringify({
    nodeId: input.nodeId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    visibility: input.visibility,
    ownerUids: input.ownerUids,
  }));
  const response = await fetchHydroResponse('/admin/mindmap/course-nodes', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!response.ok) throw await errorFromResponse(response, `课程节点设置保存失败（HTTP ${response.status}）`);
  return readSnapshot(await response.json());
}

export async function loadNodeProblems(mapId: string, nodeId: string, admin: boolean): Promise<PanelProblem[]> {
  const endpoint = admin ? '/api/mindmap/admin/node-problems' : '/api/mindmap/problems';
  const response = await fetchHydroResponse(`${endpoint}?mapId=${encodeURIComponent(mapId)}&nodeId=${encodeURIComponent(nodeId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await errorFromResponse(response, `关联题目加载失败（HTTP ${response.status}）`);
  const body = await response.json();
  if (!Array.isArray(body?.problems)) throw new MindmapApiError('服务器返回的关联题目格式无效', 500);
  return body.problems as PanelProblem[];
}

export async function searchMindmapProblems(mapId: string, query: string, signal?: AbortSignal): Promise<ProblemOption[]> {
  const response = await fetchHydroResponse(`/api/mindmap/admin/problems?mapId=${encodeURIComponent(mapId)}&q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response, `题目搜索失败（HTTP ${response.status}）`);
  const body = await response.json();
  if (!Array.isArray(body?.problems)) throw new MindmapApiError('服务器返回的题目搜索结果格式无效', 500);
  return body.problems as ProblemOption[];
}
