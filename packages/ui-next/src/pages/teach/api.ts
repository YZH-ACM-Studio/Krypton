import { parseProblemKind, parseTeachType } from '@hydrooj/common';
import type { ProblemKind, TeachType } from '@hydrooj/common';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

const RESPONSE_PARSE_FAILED = '服务器返回了无法解析的响应';
const JSON_ACCEPT = { Accept: 'application/json' };

export interface TeachBankQuery {
  type: TeachType;
  course: string;
  node: string;
  source: 'all' | 'school' | 'mine';
  kind: ProblemKind | 'all';
  difficulty: number | 'all';
  q: string;
  exclude: number[];
  page: number;
}

function invalid(path: string): never {
  throw new TypeError(`teach_payload_invalid:${path}`);
}

async function readResponseJson(response: Response): Promise<unknown> {
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new Error(RESPONSE_PARSE_FAILED);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    throw new Error(RESPONSE_PARSE_FAILED);
  }
}

function asResponseRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('response');
  return value as Record<string, unknown>;
}

async function requestJson(path: string, init: RequestInit, fallback: string): Promise<unknown> {
  const response = await fetchHydroResponse(path, init, fallback);
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  return readResponseJson(response);
}

export function getJson(path: string, fallback: string): Promise<unknown> {
  return requestJson(path, { credentials: 'same-origin', headers: JSON_ACCEPT }, fallback);
}

export async function postForm(path: string, body: URLSearchParams, fallback: string): Promise<Record<string, unknown>> {
  const payload = await requestJson(path, { method: 'POST', credentials: 'same-origin', headers: JSON_ACCEPT, body }, fallback);
  return asResponseRecord(payload);
}

export async function postJson(path: string, body: Record<string, unknown>, fallback: string): Promise<Record<string, unknown>> {
  const payload = await requestJson(
    path,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fallback,
  );
  return asResponseRecord(payload);
}

function readBankString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path);
  return value;
}

function readBankKind(value: unknown): string {
  if (value === 'all') return 'all';
  try {
    return parseProblemKind(value);
  } catch (error) {
    if (error instanceof TypeError) invalid('bank.kind');
    throw error;
  }
}

function readBankDifficulty(value: unknown): string {
  if (value === 'all') return 'all';
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10) return String(value);
  invalid('bank.difficulty');
}

function readBankExclude(value: unknown): string {
  if (!Array.isArray(value)) invalid('bank.exclude');
  const ids = value.map((item, index) => {
    if (typeof item !== 'number' || !Number.isSafeInteger(item)) invalid(`bank.exclude[${index}]`);
    return String(item);
  });
  return ids.join(',');
}

function bankPath(query: TeachBankQuery): string {
  if (typeof query !== 'object' || query === null) invalid('bank');
  const source = query.source;
  if (source !== 'all' && source !== 'school' && source !== 'mine') invalid('bank.source');
  if (typeof query.page !== 'number' || !Number.isSafeInteger(query.page)) invalid('bank.page');
  const params = new URLSearchParams();
  params.set('type', parseTeachType(query.type));
  params.set('course', readBankString(query.course, 'bank.course'));
  params.set('node', readBankString(query.node, 'bank.node'));
  params.set('source', source);
  params.set('kind', readBankKind(query.kind));
  params.set('difficulty', readBankDifficulty(query.difficulty));
  params.set('q', readBankString(query.q, 'bank.q'));
  params.set('exclude', readBankExclude(query.exclude));
  params.set('page', String(query.page));
  return `/teach-api/bank?${params.toString()}`;
}

function teachResourcePath(type: TeachType, id: string, suffix: string): string {
  return `/teach/${parseTeachType(type)}/${encodeURIComponent(id)}/${suffix}`;
}

export const teachApi: {
  list(query: URLSearchParams): string;
  copyable(type: TeachType, id: string): string;
  provenance(type: TeachType, id: string): string;
  share(type: TeachType, id: string): string;
  participants(type: TeachType, id: string): string;
  knowledgeTree(type: TeachType): string;
  bank(query: TeachBankQuery): string;
  bankPreview(type: TeachType, docId: number): string;
  schoolBank: '/problem/school-bank';
} = {
  list(query: URLSearchParams): string {
    return `/teach?${query.toString()}`;
  },
  copyable(type: TeachType, id: string): string {
    return teachResourcePath(type, id, 'copyable');
  },
  provenance(type: TeachType, id: string): string {
    return teachResourcePath(type, id, 'provenance');
  },
  share(type: TeachType, id: string): string {
    return teachResourcePath(type, id, 'share');
  },
  participants(type: TeachType, id: string): string {
    return teachResourcePath(type, id, 'participants');
  },
  knowledgeTree(type: TeachType): string {
    const params = new URLSearchParams();
    params.set('type', parseTeachType(type));
    return `/teach-api/knowledge-tree?${params.toString()}`;
  },
  bank(query: TeachBankQuery): string {
    return bankPath(query);
  },
  bankPreview(type: TeachType, docId: number): string {
    if (!Number.isSafeInteger(docId)) invalid('bankPreview.docId');
    return `/teach-api/bank/${docId}?type=${parseTeachType(type)}`;
  },
  schoolBank: '/problem/school-bank',
};
