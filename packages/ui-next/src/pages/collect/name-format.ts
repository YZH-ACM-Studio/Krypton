/**
 * Request-level file-name template and pack layout.
 * Assigned names are derived; they are never persisted and never change blob paths.
 * UI copy of packages/krypton-collect/src/name-format.ts (pure functions only).
 */

export const COLLECT_NAME_TOKENS = [
  'studentId',
  'realName',
  'slotTitle',
  'index',
  'ext',
  'originalStem',
  'originalName',
] as const;

export type CollectNameToken = (typeof COLLECT_NAME_TOKENS)[number];

export const COLLECT_PACK_LAYOUTS = ['nested', 'flat'] as const;
export type CollectPackLayout = (typeof COLLECT_PACK_LAYOUTS)[number];

export const COLLECT_DEFAULT_FILE_NAME_TEMPLATE = '{originalName}';
export const COLLECT_DEFAULT_PACK_LAYOUT: CollectPackLayout = 'nested';
export const COLLECT_MISSING_STEM = '未交';

const TEMPLATE_MAX = 200;
const TOKEN_RE = /\{([A-Za-z]+)\}/g;
const ALLOWED_TOKENS = new Set<string>(COLLECT_NAME_TOKENS);
// eslint-disable-next-line no-control-regex
const INVALID_ZIP_PART_CHARS = /[\\/:*?"<>|\x00-\x1F]/g;

export interface CollectNameContext {
  /** Required by the plugin; optional here so a missing uid does not render unbound-UIDundefined. */
  uid?: number;
  studentId?: string;
  realName?: string;
  slotTitle: string;
  index: number;
  ext: string;
  originalName: string;
}

function reject(message: string): never {
  throw new Error(message);
}

export function sanitizeZipPart(value: string): string {
  const sanitized = value.replace(INVALID_ZIP_PART_CHARS, '_').replace(/\s+/g, ' ').trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') return '_';
  return sanitized;
}

export function originalStem(originalName: string): string {
  const base = originalName.trim();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base || COLLECT_MISSING_STEM;
  return base.slice(0, dot) || COLLECT_MISSING_STEM;
}

export function parsePackLayout(raw: unknown): CollectPackLayout {
  if (raw == null || raw === '') return COLLECT_DEFAULT_PACK_LAYOUT;
  if (raw === 'nested' || raw === 'flat') return raw;
  reject('打包目录格式不合法');
}

export function parseFileNameTemplate(raw: unknown): string {
  if (raw == null || raw === '') return COLLECT_DEFAULT_FILE_NAME_TEMPLATE;
  if (typeof raw !== 'string') reject('文件名格式不合法');
  const template = raw.trim();
  if (!template) reject('文件名格式不能为空');
  if (template.length > TEMPLATE_MAX) reject('文件名格式过长');
  TOKEN_RE.lastIndex = 0;
  let cursor = 0;
  const re = new RegExp(TOKEN_RE.source, 'g');
  let match = re.exec(template);
  while (match) {
    const literal = template.slice(cursor, match.index);
    if (INVALID_ZIP_PART_CHARS.test(literal)) reject('文件名格式含有非法字符');
    INVALID_ZIP_PART_CHARS.lastIndex = 0;
    if (literal.includes('{')) reject('文件名格式不合法');
    if (!ALLOWED_TOKENS.has(match[1])) reject(`未知文件名变量 {${match[1]}}`);
    cursor = match.index + match[0].length;
    match = re.exec(template);
  }
  const tail = template.slice(cursor);
  if (INVALID_ZIP_PART_CHARS.test(tail)) reject('文件名格式含有非法字符');
  INVALID_ZIP_PART_CHARS.lastIndex = 0;
  if (tail.includes('{')) reject('文件名格式不合法');
  return template;
}

export function requestFileNameTemplate(value: string | undefined | null): string {
  return value && value.trim() ? value : COLLECT_DEFAULT_FILE_NAME_TEMPLATE;
}

export function requestPackLayout(value: CollectPackLayout | undefined | null): CollectPackLayout {
  return value === 'flat' || value === 'nested' ? value : COLLECT_DEFAULT_PACK_LAYOUT;
}

function isNameToken(token: string): token is CollectNameToken {
  return ALLOWED_TOKENS.has(token);
}

function tokenValue(token: CollectNameToken, ctx: CollectNameContext): string {
  const trimmedId = ctx.studentId?.trim() || '';
  const studentId = trimmedId
    || (typeof ctx.uid === 'number' && Number.isFinite(ctx.uid) ? `unbound-UID${ctx.uid}` : trimmedId);
  const realName = ctx.realName?.trim() || '';
  const originalName = ctx.originalName.trim() || `${COLLECT_MISSING_STEM}.${ctx.ext}`;
  switch (token) {
    case 'studentId':
      return studentId;
    case 'realName':
      return realName || '_';
    case 'slotTitle':
      return ctx.slotTitle;
    case 'index':
      return String(Math.max(1, Math.floor(ctx.index) || 1));
    case 'ext':
      return ctx.ext;
    case 'originalStem':
      return originalStem(originalName);
    case 'originalName':
      return originalName;
    default:
      return '';
  }
}

export function applyRealExt(name: string, ext: string): string {
  const suffix = `.${ext}`;
  const lower = name.toLowerCase();
  if (lower.endsWith(suffix)) return `${name.slice(0, name.length - suffix.length)}${suffix}`;
  if (ext === 'jpg' && lower.endsWith('.jpeg')) return `${name.slice(0, name.length - 5)}${suffix}`;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem || '_'}${suffix}`;
}

export function renderAssignedFileName(template: string, ctx: CollectNameContext): string {
  const resolved = requestFileNameTemplate(template);
  const replaced = resolved.replace(new RegExp(TOKEN_RE.source, 'g'), (_all, token: string) => (
    isNameToken(token) ? tokenValue(token, ctx) : ''
  ));
  return applyRealExt(sanitizeZipPart(replaced), ctx.ext);
}

export function renderPackEntryName(
  layout: CollectPackLayout,
  folder: string,
  slotTitle: string,
  assignedFileName: string,
): string {
  if (layout === 'flat') return assignedFileName;
  return `${sanitizeZipPart(folder)}/${sanitizeZipPart(slotTitle)}/${assignedFileName}`;
}

export function dedupePackNames<T extends { name: string; fileId: string }>(entries: T[]): T[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const key = entry.name.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count === 1) return entry;
    return { ...entry, name: applyRealExt(`${originalStem(entry.name)}-${entry.fileId}`, extensionOf(entry.name)) };
  });
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'bin';
  const ext = name.slice(dot + 1).toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

export function slotPreviewExt(slot: { allowedExt: readonly string[] }): string {
  return slot.allowedExt[0] || 'pdf';
}

export function missingOriginalName(ext: string): string {
  return `${COLLECT_MISSING_STEM}.${ext}`;
}
