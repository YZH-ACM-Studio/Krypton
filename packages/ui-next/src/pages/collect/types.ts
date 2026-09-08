/**
 * Student file-collection page payloads.
 *
 * `KryptonPage.data` is `unknown`. These interfaces are the minimum shapes
 * the list/detail pages consume after structural narrowing.
 */

import { parseFileNameTemplate, type CollectPackLayout } from './name-format';

export const COLLECT_MAX_FILE_BYTES = 32 * 1024 * 1024;

export type CollectRequestStatus = 'draft' | 'published' | 'closed' | 'archived';

export interface CollectListItem {
  _id: string;
  title: string;
  dueAt: string;
  status: CollectRequestStatus;
  submitted: boolean;
  filled: boolean;
}

export interface CollectListPayload {
  requests: CollectListItem[];
}

export interface CollectSlotView {
  id: string;
  title: string;
  required: boolean;
  allowedExt: string[];
  maxFiles: number;
}

export interface CollectCurrentFileView {
  slotId: string;
  fileId: string;
  originalName: string;
  size: number;
  sha256?: string;
  ext?: string;
  url?: string;
  assignedName?: string;
}

export interface CollectStudentIdentity {
  studentId: string;
  realName: string;
  uid?: number;
}

export interface CollectHistoryFileView {
  slotId: string;
  fileId: string;
  originalName: string;
  size: number;
  version: number;
  current: boolean;
  createdAt: string;
  ext?: string;
  url?: string;
}

export interface CollectDetailPayload {
  _id: string;
  title: string;
  description: string;
  dueAt: string;
  status: CollectRequestStatus;
  member: boolean;
  submitted: boolean;
  filled: boolean;
  slots: CollectSlotView[];
  currentFiles: CollectCurrentFileView[];
  history?: CollectHistoryFileView[];
  fileNameTemplate: string;
  packLayout: CollectPackLayout;
  identity: CollectStudentIdentity;
}

export type CollectParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRequestStatus(value: unknown): CollectRequestStatus | null {
  if (value === 'draft' || value === 'published' || value === 'closed' || value === 'archived') return value;
  return null;
}

function parseId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isRecord(value) && typeof value.$oid === 'string' && value.$oid.trim()) return value.$oid.trim();
  return null;
}

function parseDueAt(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  if (isRecord(value) && value.$date !== undefined) return parseDueAt(value.$date);
  return null;
}

function parseExt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ext = value.trim().toLowerCase();
  if (!ext || !/^[a-z0-9]+$/.test(ext)) return null;
  return ext === 'jpeg' ? 'jpg' : ext;
}

function parseDownloadUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const url = value.trim();
  if (!url.startsWith('/') && !url.startsWith('https://') && !url.startsWith('http://')) return undefined;
  return url;
}

function parseListItem(value: unknown, index: number): CollectParseResult<CollectListItem> {
  if (!isRecord(value)) return { ok: false, error: `requests[${index}] 不是对象` };
  const _id = parseId(value._id);
  if (!_id) return { ok: false, error: `requests[${index}] 缺少有效 _id` };
  if (typeof value.title !== 'string' || !value.title.trim()) {
    return { ok: false, error: `requests[${index}] 缺少 title` };
  }
  const dueAt = parseDueAt(value.dueAt);
  if (!dueAt) return { ok: false, error: `requests[${index}] 缺少有效 dueAt` };
  const status = parseRequestStatus(value.status);
  if (!status) return { ok: false, error: `requests[${index}] 的 status 无效` };
  if (typeof value.submitted !== 'boolean') return { ok: false, error: `requests[${index}] 缺少 submitted` };
  if (typeof value.filled !== 'boolean') return { ok: false, error: `requests[${index}] 缺少 filled` };
  return {
    ok: true,
    value: {
      _id,
      title: value.title.trim(),
      dueAt,
      status,
      submitted: value.submitted,
      filled: value.filled,
    },
  };
}

export function parseCollectListPayload(data: unknown): CollectParseResult<CollectListPayload> {
  if (!isRecord(data)) return { ok: false, error: '页面数据不是对象' };
  if (!Array.isArray(data.requests)) return { ok: false, error: '缺少 requests 数组' };
  const requests: CollectListItem[] = [];
  for (let i = 0; i < data.requests.length; i += 1) {
    const item = parseListItem(data.requests[i], i);
    if (!item.ok) return item;
    requests.push(item.value);
  }
  return { ok: true, value: { requests } };
}

function parseSlot(value: unknown, index: number): CollectParseResult<CollectSlotView> {
  if (!isRecord(value)) return { ok: false, error: `slots[${index}] 不是对象` };
  if (typeof value.id !== 'string' || !value.id.trim()) return { ok: false, error: `slots[${index}] 缺少 id` };
  if (typeof value.title !== 'string' || !value.title.trim()) return { ok: false, error: `slots[${index}] 缺少 title` };
  if (typeof value.required !== 'boolean') return { ok: false, error: `slots[${index}] 缺少 required` };
  if (!Array.isArray(value.allowedExt) || value.allowedExt.length === 0) {
    return { ok: false, error: `slots[${index}] 缺少 allowedExt` };
  }
  const allowedExt: string[] = [];
  for (let i = 0; i < value.allowedExt.length; i += 1) {
    const ext = parseExt(value.allowedExt[i]);
    if (!ext) return { ok: false, error: `slots[${index}].allowedExt[${i}] 无效` };
    if (!allowedExt.includes(ext)) allowedExt.push(ext);
  }
  if (typeof value.maxFiles !== 'number' || !Number.isSafeInteger(value.maxFiles) || value.maxFiles < 1) {
    return { ok: false, error: `slots[${index}] 的 maxFiles 无效` };
  }
  return {
    ok: true,
    value: {
      id: value.id.trim(),
      title: value.title.trim(),
      required: value.required,
      allowedExt,
      maxFiles: value.maxFiles,
    },
  };
}

function parseCurrentFile(value: unknown, index: number, label: string): CollectParseResult<CollectCurrentFileView> {
  if (!isRecord(value)) return { ok: false, error: `${label}[${index}] 不是对象` };
  if (typeof value.slotId !== 'string' || !value.slotId.trim()) {
    return { ok: false, error: `${label}[${index}] 缺少 slotId` };
  }
  if (typeof value.fileId !== 'string' || !value.fileId.trim()) {
    return { ok: false, error: `${label}[${index}] 缺少 fileId` };
  }
  if (typeof value.originalName !== 'string' || !value.originalName.trim()) {
    return { ok: false, error: `${label}[${index}] 缺少 originalName` };
  }
  if (typeof value.size !== 'number' || !Number.isFinite(value.size) || value.size < 0) {
    return { ok: false, error: `${label}[${index}] 的 size 无效` };
  }
  const file: CollectCurrentFileView = {
    slotId: value.slotId.trim(),
    fileId: value.fileId.trim(),
    originalName: value.originalName.trim(),
    size: value.size,
  };
  if (value.sha256 !== undefined) {
    if (typeof value.sha256 !== 'string' || !value.sha256.trim()) {
      return { ok: false, error: `${label}[${index}] 的 sha256 无效` };
    }
    file.sha256 = value.sha256.trim();
  }
  if (value.ext !== undefined) {
    const ext = parseExt(value.ext);
    if (!ext) return { ok: false, error: `${label}[${index}] 的 ext 无效` };
    file.ext = ext;
  }
  const url = parseDownloadUrl(value.url);
  if (value.url !== undefined && !url) return { ok: false, error: `${label}[${index}] 的 url 无效` };
  if (url) file.url = url;
  if (value.assignedName !== undefined) {
    if (typeof value.assignedName !== 'string' || !value.assignedName.trim()) {
      return { ok: false, error: `${label}[${index}] 的 assignedName 无效` };
    }
    file.assignedName = value.assignedName.trim();
  }
  return { ok: true, value: file };
}

function parseHistoryFile(value: unknown, index: number): CollectParseResult<CollectHistoryFileView> {
  const current = parseCurrentFile(value, index, 'history');
  if (!current.ok) return { ok: false, error: current.error };
  if (!isRecord(value)) return { ok: false, error: `history[${index}] 不是对象` };
  if (typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1) {
    return { ok: false, error: `history[${index}] 的 version 无效` };
  }
  if (typeof value.current !== 'boolean') return { ok: false, error: `history[${index}] 缺少 current` };
  const createdAt = parseDueAt(value.createdAt);
  if (!createdAt) return { ok: false, error: `history[${index}] 缺少有效 createdAt` };
  return {
    ok: true,
    value: {
      ...current.value,
      version: value.version,
      current: value.current,
      createdAt,
    },
  };
}

function requiredSlotsFilled(slots: CollectSlotView[], currentFiles: CollectCurrentFileView[]): boolean {
  return slots.filter((slot) => slot.required).every((slot) => currentFiles.some((file) => file.slotId === slot.id));
}

function unwrapDetailSource(data: unknown): unknown {
  if (!isRecord(data) || !isRecord(data.request)) return data;
  const request = data.request;
  const submission = isRecord(data.submission) ? data.submission : null;
  const submittedFromSubmission = submission ? submission.status === 'submitted' : false;
  return {
    _id: request._id,
    title: request.title,
    description: request.description,
    dueAt: request.dueAt,
    status: request.status,
    slots: request.slots,
    member: data.member,
    submitted: typeof data.submitted === 'boolean' ? data.submitted : submittedFromSubmission,
    filled: data.filled,
    currentFiles: data.currentFiles !== undefined ? data.currentFiles : submission?.currentFiles,
    history: data.history,
    fileNameTemplate: data.fileNameTemplate !== undefined ? data.fileNameTemplate : request.fileNameTemplate,
    packLayout: data.packLayout !== undefined ? data.packLayout : request.packLayout,
    identity: data.identity !== undefined ? data.identity : request.identity,
  };
}

function parseStudentIdentity(value: unknown): CollectParseResult<CollectStudentIdentity> {
  if (!isRecord(value)) return { ok: false, error: '缺少 identity' };
  if (typeof value.studentId !== 'string') return { ok: false, error: 'identity.studentId 无效' };
  if (typeof value.realName !== 'string') return { ok: false, error: 'identity.realName 无效' };
  const identity: CollectStudentIdentity = {
    studentId: value.studentId,
    realName: value.realName,
  };
  if (value.uid !== undefined) {
    if (typeof value.uid !== 'number' || !Number.isSafeInteger(value.uid)) {
      return { ok: false, error: 'identity.uid 无效' };
    }
    identity.uid = value.uid;
  }
  return { ok: true, value: identity };
}

function parseDetailFileNameTemplate(value: unknown): CollectParseResult<string> {
  if (typeof value !== 'string') return { ok: false, error: '缺少 fileNameTemplate' };
  try {
    return { ok: true, value: parseFileNameTemplate(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '文件名格式不合法' };
  }
}

function parseDetailPackLayout(value: unknown): CollectParseResult<CollectPackLayout> {
  if (value === 'nested' || value === 'flat') return { ok: true, value };
  return { ok: false, error: 'packLayout 无效' };
}

export function parseCollectDetailPayload(data: unknown): CollectParseResult<CollectDetailPayload> {
  const source = unwrapDetailSource(data);
  if (!isRecord(source)) return { ok: false, error: '页面数据不是对象' };
  const _id = parseId(source._id);
  if (!_id) return { ok: false, error: '缺少有效 _id' };
  if (typeof source.title !== 'string' || !source.title.trim()) return { ok: false, error: '缺少 title' };
  if (typeof source.description !== 'string') return { ok: false, error: '缺少 description' };
  const dueAt = parseDueAt(source.dueAt);
  if (!dueAt) return { ok: false, error: '缺少有效 dueAt' };
  const status = parseRequestStatus(source.status);
  if (!status) return { ok: false, error: 'status 无效' };
  if (typeof source.submitted !== 'boolean') return { ok: false, error: '缺少 submitted' };
  if (typeof source.member !== 'boolean') return { ok: false, error: '缺少 member' };
  if (!Array.isArray(source.slots) || source.slots.length === 0) return { ok: false, error: '缺少 slots 数组' };
  const slots: CollectSlotView[] = [];
  const slotIds = new Set<string>();
  for (let i = 0; i < source.slots.length; i += 1) {
    const slot = parseSlot(source.slots[i], i);
    if (!slot.ok) return slot;
    if (slotIds.has(slot.value.id)) return { ok: false, error: `slots[${i}] 的 id 重复` };
    slotIds.add(slot.value.id);
    slots.push(slot.value);
  }
  const currentFiles: CollectCurrentFileView[] = [];
  if (source.currentFiles !== undefined) {
    if (!Array.isArray(source.currentFiles)) return { ok: false, error: 'currentFiles 不是数组' };
    for (let i = 0; i < source.currentFiles.length; i += 1) {
      const file = parseCurrentFile(source.currentFiles[i], i, 'currentFiles');
      if (!file.ok) return file;
      currentFiles.push(file.value);
    }
  }
  let filled: boolean;
  if (source.filled === undefined) {
    filled = requiredSlotsFilled(slots, currentFiles);
  } else if (typeof source.filled === 'boolean') {
    filled = source.filled;
  } else {
    return { ok: false, error: 'filled 无效' };
  }
  const fileNameTemplate = parseDetailFileNameTemplate(source.fileNameTemplate);
  if (!fileNameTemplate.ok) return fileNameTemplate;
  const packLayout = parseDetailPackLayout(source.packLayout);
  if (!packLayout.ok) return packLayout;
  const identity = parseStudentIdentity(source.identity);
  if (!identity.ok) return identity;
  const payload: CollectDetailPayload = {
    _id,
    title: source.title.trim(),
    description: source.description,
    dueAt,
    status,
    member: source.member,
    submitted: source.submitted,
    filled,
    slots,
    currentFiles,
    fileNameTemplate: fileNameTemplate.value,
    packLayout: packLayout.value,
    identity: identity.value,
  };
  if (source.history !== undefined) {
    if (!Array.isArray(source.history)) return { ok: false, error: 'history 不是数组' };
    const history: CollectHistoryFileView[] = [];
    for (let i = 0; i < source.history.length; i += 1) {
      const file = parseHistoryFile(source.history[i], i);
      if (!file.ok) return file;
      history.push(file.value);
    }
    payload.history = history;
  }
  return { ok: true, value: payload };
}

export function collectDueMs(dueAt: string): number | null {
  const t = new Date(dueAt).getTime();
  return Number.isNaN(t) ? null : t;
}

export function isCollectWindowClosed(status: CollectRequestStatus, dueAtMs: number, now: number): boolean {
  if (status === 'closed' || status === 'archived' || status === 'draft') return true;
  return now >= dueAtMs;
}

export function acceptFromSlot(slot: CollectSlotView): string[] {
  const accept: string[] = [];
  for (const ext of slot.allowedExt) {
    const dotted = `.${ext}`;
    if (!accept.includes(dotted)) accept.push(dotted);
    if (ext === 'jpg' && !accept.includes('.jpeg')) accept.push('.jpeg');
  }
  return accept;
}

export function collectFileHref(requestId: string, file: { fileId: string; url?: string }): string {
  if (file.url) return file.url;
  return `/collect/${encodeURIComponent(requestId)}/file/${encodeURIComponent(file.fileId)}`;
}
