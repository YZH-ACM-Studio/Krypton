/**
 * /admin/collect — teacher file-collection workspace.
 *
 * Templates → exports:
 *   - admin_collect.html       → AdminCollectListPage
 *   - admin_collect_edit.html  → AdminCollectEditPage  (create + edit)
 *   - admin_collect_stats.html → AdminCollectStatsPage
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, Bell, FileDown, FolderUp, Plus, Save, Trash2 } from 'lucide-react';
import { DomainUserSearchOption, domainUserSearchLabel, loadDomainUsers, type DomainUserOption } from '@/components/domain-user-search';
import { ModuleWorkspace, type ModuleWorkspaceNavItem } from '@/components/management/module-workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTime } from '@/components/ui/datetime';
import { FormField, FormRow, FormSection } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { downloadZip, type ZipDownloadTarget } from '@/lib/download-zip';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import {
  COLLECT_DEFAULT_FILE_NAME_TEMPLATE,
  COLLECT_DEFAULT_PACK_LAYOUT,
  COLLECT_NAME_TOKENS,
  renderAssignedFileName,
  renderPackEntryName,
  type CollectNameToken,
  type CollectPackLayout,
} from '@/pages/collect/name-format';

const COLLECT_WORKSPACE_NAV = [
  {
    key: 'list',
    label: '列表',
    href: '/admin/collect',
    templateNames: ['admin_collect.html', 'admin_collect_edit.html', 'admin_collect_stats.html'],
  },
] satisfies readonly ModuleWorkspaceNavItem[];

const COLLECT_WORKSPACE_PROPS = {
  moduleTitle: '文件收集',
  navItems: COLLECT_WORKSPACE_NAV,
  bypassPrivGate: true,
} as const;

const ALLOWED_EXTS = ['pdf', 'docx', 'zip', 'png', 'jpg'] as const;
type AllowedExt = (typeof ALLOWED_EXTS)[number];

const HARD_MAX_FILE_BYTES = 32 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const HARD_MAX_FILES = 5;
const MIB = 1024 * 1024;

type CollectRequestStatus = 'draft' | 'published' | 'closed' | 'archived';
type ProgressRowStatus = 'submitted' | 'missing';

interface SchoolRef {
  _id: string;
  name: string;
}

interface GroupRef {
  _id: string;
  schoolId: string;
  name: string;
  archivedAt?: string;
}

interface CourseChapterRef {
  _id: string;
  title: string;
}

interface CourseRef {
  _id: string;
  title: string;
  chapters: CourseChapterRef[];
}

interface SlotDraft {
  id: string;
  title: string;
  required: boolean;
  allowedExt: AllowedExt[];
  maxFiles: number;
}

interface CollectRequestView {
  _id: string;
  title: string;
  description: string;
  schoolId: string;
  groupIds: string[];
  dueAt: string;
  status: CollectRequestStatus;
  revision: number;
  slots: SlotDraft[];
  collaboratorUids: number[];
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  fileNameTemplate: string;
  packLayout: CollectPackLayout;
  courseRef: { courseId: string; chapterId: string } | null;
  ownerUid: number;
  canEdit: boolean;
}

interface CollectListItem {
  _id: string;
  title: string;
  schoolId: string;
  schoolName: string;
  dueAt: string;
  status: CollectRequestStatus;
  submitted: number;
  total: number;
  hasSubmissions: boolean;
  hasFiles: boolean;
  canEdit: boolean;
}

interface CollectListPageData {
  requests: CollectListItem[];
  schools: SchoolRef[];
  canCreate: boolean;
}

interface CollectEditPageData {
  request: CollectRequestView | null;
  hasSubmissions: boolean;
  canEdit: boolean;
  schools: SchoolRef[];
  groups: GroupRef[];
  courses: CourseRef[];
  collaborators: DomainUserOption[];
  fromCourse: string;
  chapter: string;
  prefillGroupIds: string[];
  prefillSchoolId: string;
}

interface ProgressFile {
  slotId: string;
  slotTitle: string;
  fileId: string;
  originalName: string;
  assignedName?: string;
  duplicateCount?: number;
  duplicateStudentIds?: string[];
  size: number;
  url: string;
}

interface ProgressHistoryFile extends ProgressFile {
  version: number;
}

interface ProgressRow {
  uid: number;
  studentId: string;
  realName: string;
  status: ProgressRowStatus;
  leftGroup: boolean;
  submittedAt: string | null;
  files: ProgressFile[];
  history: ProgressHistoryFile[];
}

interface CollectStatsRequest {
  _id: string;
  title: string;
  status: CollectRequestStatus;
  dueAt: string;
  slots: SlotDraft[];
  canEdit: boolean;
}

interface CollectStatsPageData {
  request: CollectStatsRequest;
  dueCount: number;
  submittedCount: number;
  missingCount: number;
  rows: ProgressRow[];
  canNudge: boolean;
  canPack: boolean;
}

interface PackPayload {
  entries: ZipDownloadTarget[];
  csv: string;
  submittedCsv: string;
  manifest: string;
  filename: string;
}

const FILE_NAME_PREVIEW_CTX = {
  uid: 1,
  studentId: '24000001',
  realName: '张三',
  slotTitle: '实验报告',
  index: 1,
  ext: 'pdf',
  originalName: 'lab.pdf',
} as const;

const FILE_NAME_PREVIEW_FOLDER = '24000001-张三';
const PACK_LAYOUT_OPTIONS = [
  { value: 'nested', label: '学号-姓名 / 槽位 / 文件' },
  { value: 'flat', label: '全部文件放在压缩包根目录' },
] as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`);
  return value;
}

function asOptionalString(value: unknown, label: string): string {
  if (value === undefined || value === null) return '';
  return asString(value, label);
}

function asId(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (typeof rec.$oid === 'string' && rec.$oid.trim()) return rec.$oid.trim();
  }
  throw new Error(`${label}格式不正确`);
}

function asUid(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error(`${label}格式不正确`);
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`${label}格式不正确`);
}

function optionalBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  return asBoolean(value, label);
}

function asNonNegativeInt(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error(`${label}格式不正确`);
}

function asBoundedInt(value: unknown, min: number, max: number, label: string): number {
  const parsed = asNonNegativeInt(value, label);
  if (parsed < min || parsed > max) throw new Error(`${label}格式不正确`);
  return parsed;
}

function clampInt(raw: string, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function asIso(value: unknown, label: string): string {
  if (typeof value === 'string' && value && !Number.isNaN(Date.parse(value))) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (rec.$date !== undefined) return asIso(rec.$date, label);
  }
  throw new Error(`${label}格式不正确`);
}

function asOptionalIso(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asIso(value, label);
}

function parseStatus(value: unknown): CollectRequestStatus {
  if (value === 'draft' || value === 'published' || value === 'closed' || value === 'archived') return value;
  throw new Error('收集状态格式不正确');
}

function parseAllowedExts(value: unknown): AllowedExt[] {
  if (!Array.isArray(value)) throw new Error('允许的扩展名格式不正确');
  const out: AllowedExt[] = [];
  for (const item of value) {
    const ext = item === 'jpeg' ? 'jpg' : item;
    if (ext !== 'pdf' && ext !== 'docx' && ext !== 'zip' && ext !== 'png' && ext !== 'jpg') {
      throw new Error('允许的扩展名格式不正确');
    }
    if (!out.includes(ext)) out.push(ext);
  }
  return ALLOWED_EXTS.filter((ext) => out.includes(ext));
}

function parseIdList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value.map((item) => asId(item, label));
}

function parseUidList(value: unknown, label: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value.map((item) => asUid(item, label));
}

function parseSchoolRef(value: unknown): SchoolRef {
  const rec = asRecord(value, '学校');
  return { _id: asId(rec._id, '学校'), name: asString(rec.name, '学校名称') };
}

function parseSchoolRefs(value: unknown): SchoolRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('学校列表格式不正确');
  return value.map(parseSchoolRef);
}

function parseGroupRef(value: unknown): GroupRef {
  const rec = asRecord(value, '用户组');
  return {
    _id: asId(rec._id, '用户组'),
    schoolId: asId(rec.schoolId, '用户组学校'),
    name: asString(rec.name, '用户组名称'),
    ...(typeof rec.archivedAt === 'string' && rec.archivedAt ? { archivedAt: rec.archivedAt } : {}),
  };
}

function parseGroupRefs(value: unknown): GroupRef[] {
  if (!Array.isArray(value)) throw new Error('用户组列表格式不正确');
  return value.map(parseGroupRef);
}

function parseCourseRefOption(value: unknown): CourseRef {
  const rec = asRecord(value, '课程');
  if (!Array.isArray(rec.chapters)) throw new Error('课程章节格式不正确');
  return {
    _id: asId(rec._id, '课程'),
    title: asString(rec.title, '课程名称'),
    chapters: rec.chapters.map((item) => {
      const chapter = asRecord(item, '章节');
      return { _id: asId(chapter._id, '章节'), title: asString(chapter.title, '章节名称') };
    }),
  };
}

function parseCourses(value: unknown): CourseRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('课程列表格式不正确');
  return value.map(parseCourseRefOption);
}

function parseSlot(value: unknown): SlotDraft {
  const rec = asRecord(value, '槽位');
  return {
    id: asId(rec.id, '槽位'),
    title: asString(rec.title, '槽位名称'),
    required: asBoolean(rec.required, '槽位必填'),
    allowedExt: parseAllowedExts(rec.allowedExt),
    maxFiles: asBoundedInt(rec.maxFiles, 1, HARD_MAX_FILES, '槽位文件数'),
  };
}

function parseCourseRef(value: unknown): CollectRequestView['courseRef'] {
  if (value === undefined || value === null) return null;
  const rec = asRecord(value, '课程引用');
  return { courseId: asId(rec.courseId, '课程'), chapterId: asId(rec.chapterId, '章节') };
}

function parseFileNameTemplate(value: unknown): string {
  if (value === undefined || value === null) return COLLECT_DEFAULT_FILE_NAME_TEMPLATE;
  const template = asString(value, '文件名格式');
  return template.trim() ? template : COLLECT_DEFAULT_FILE_NAME_TEMPLATE;
}

function parsePackLayout(value: unknown): CollectPackLayout {
  if (value === undefined || value === null || value === '') return COLLECT_DEFAULT_PACK_LAYOUT;
  if (value === 'nested' || value === 'flat') return value;
  throw new Error('打包目录格式不正确');
}

function parseOptionalStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value.map((item) => asString(item, label));
}

function parseCollaborator(value: unknown): DomainUserOption {
  const rec = asRecord(value, '协作者');
  const user: DomainUserOption = { _id: asUid(rec._id, '协作者') };
  if (typeof rec.uname === 'string' && rec.uname) user.uname = rec.uname;
  if (typeof rec.displayName === 'string' && rec.displayName) user.displayName = rec.displayName;
  if (typeof rec.mail === 'string' && rec.mail) user.mail = rec.mail;
  if (typeof rec.avatarUrl === 'string' && rec.avatarUrl) user.avatarUrl = rec.avatarUrl;
  if (typeof rec.studentId === 'string' && rec.studentId) user.studentId = rec.studentId;
  if (typeof rec.realName === 'string' && rec.realName) user.realName = rec.realName;
  return user;
}

function parseCollaborators(value: unknown, uids: number[]): DomainUserOption[] {
  if (Array.isArray(value)) return value.map(parseCollaborator);
  return uids.map((uid) => ({ _id: uid }));
}

function lookupSchoolName(schools: SchoolRef[], schoolId: string, explicit?: string): string {
  if (explicit) return explicit;
  return schools.find((school) => school._id === schoolId)?.name || schoolId;
}

function parseListItem(value: unknown, schools: SchoolRef[], currentUid: number): CollectListItem {
  const rec = asRecord(value, '文件收集');
  const schoolId = asId(rec.schoolId, '学校');
  const submitted = asNonNegativeInt(rec.submitted ?? rec.submittedCount, '已交人数');
  const total = asNonNegativeInt(rec.total ?? rec.totalCount, '应交人数');
  const ownerUid = typeof rec.ownerUid === 'number' || typeof rec.ownerUid === 'string' ? asUid(rec.ownerUid, '创建者') : null;
  const explicitSchoolName = typeof rec.schoolName === 'string' ? rec.schoolName : typeof rec.school === 'string' ? rec.school : '';
  return {
    _id: asId(rec._id, '文件收集'),
    title: asString(rec.title, '标题'),
    schoolId,
    schoolName: lookupSchoolName(schools, schoolId, explicitSchoolName),
    dueAt: asIso(rec.dueAt, '截止时间'),
    status: parseStatus(rec.status),
    submitted,
    total,
    hasSubmissions: optionalBoolean(rec.hasSubmissions, submitted > 0, '是否已有提交'),
    hasFiles: optionalBoolean(rec.hasFiles, rec.hasSubmissions === true || submitted > 0, '是否已有文件'),
    canEdit: optionalBoolean(rec.canEdit, ownerUid === null ? true : ownerUid === currentUid, '编辑权限'),
  };
}

function parseListPageData(value: unknown, currentUid: number): CollectListPageData {
  const rec = asRecord(value, '文件收集列表');
  const schools = parseSchoolRefs(rec.schools);
  if (!Array.isArray(rec.requests)) throw new Error('文件收集列表格式不正确');
  return {
    requests: rec.requests.map((item) => parseListItem(item, schools, currentUid)),
    schools,
    canCreate: optionalBoolean(rec.canCreate, true, '创建权限'),
  };
}

function parseRequestView(value: unknown, currentUid: number): CollectRequestView {
  const rec = asRecord(value, '文件收集');
  const ownerUid = asUid(rec.ownerUid, '创建者');
  if (!Array.isArray(rec.slots)) throw new Error('槽位格式不正确');
  return {
    _id: asId(rec._id, '文件收集'),
    title: asString(rec.title, '标题'),
    description: asOptionalString(rec.description, '说明'),
    schoolId: asId(rec.schoolId, '学校'),
    groupIds: parseIdList(rec.groupIds, '用户组'),
    dueAt: asIso(rec.dueAt, '截止时间'),
    status: parseStatus(rec.status),
    revision: asNonNegativeInt(rec.revision, '版本'),
    slots: rec.slots.map(parseSlot),
    collaboratorUids: parseUidList(rec.collaboratorUids, '协作者'),
    maxFileBytes: asBoundedInt(rec.maxFileBytes, 1, HARD_MAX_FILE_BYTES, '单文件上限'),
    maxTotalBytes: asBoundedInt(rec.maxTotalBytes, 1, HARD_MAX_TOTAL_BYTES, '合计上限'),
    maxFiles: asBoundedInt(rec.maxFiles, 1, HARD_MAX_FILES, '文件个数上限'),
    fileNameTemplate: parseFileNameTemplate(rec.fileNameTemplate),
    packLayout: parsePackLayout(rec.packLayout),
    courseRef: parseCourseRef(rec.courseRef),
    ownerUid,
    canEdit: optionalBoolean(rec.canEdit, ownerUid === currentUid, '编辑权限'),
  };
}

function parseEditPageData(value: unknown, currentUid: number): CollectEditPageData {
  const rec = asRecord(value, '文件收集编辑页');
  const request = rec.request == null ? null : parseRequestView(rec.request, currentUid);
  const collaboratorUids = request?.collaboratorUids || parseUidList(rec.collaboratorUids, '协作者');
  return {
    request,
    hasSubmissions: optionalBoolean(rec.hasSubmissions, false, '是否已有提交'),
    canEdit: optionalBoolean(rec.canEdit, request ? request.canEdit : true, '编辑权限'),
    schools: parseSchoolRefs(rec.schools),
    groups: parseGroupRefs(rec.groups),
    courses: parseCourses(rec.courses),
    collaborators: parseCollaborators(rec.collaborators, collaboratorUids),
    fromCourse: asOptionalString(rec.fromCourse, '来源课程'),
    chapter: rec.chapter === undefined || rec.chapter === null ? '' : asId(rec.chapter, '来源章节'),
    prefillGroupIds: parseIdList(rec.prefillGroupIds, '预填用户组'),
    prefillSchoolId: rec.prefillSchoolId ? asId(rec.prefillSchoolId, '预填学校') : '',
  };
}

function parseProgressFile(value: unknown, slots: SlotDraft[], requestId: string): ProgressFile {
  const rec = asRecord(value, '已交文件');
  const slotId = asId(rec.slotId, '槽位');
  const fileId = asId(rec.fileId, '文件');
  const slotTitle =
    typeof rec.slotTitle === 'string' && rec.slotTitle ? rec.slotTitle : slots.find((slot) => slot.id === slotId)?.title || slotId;
  const url =
    typeof rec.url === 'string' && rec.url.trim()
      ? rec.url.trim()
      : `/admin/collect/${encodeURIComponent(requestId)}/file/${encodeURIComponent(fileId)}`;
  const file: ProgressFile = {
    slotId,
    slotTitle,
    fileId,
    originalName: asString(rec.originalName, '文件名'),
    size: asNonNegativeInt(rec.size, '文件大小'),
    url,
  };
  if (rec.assignedName !== undefined && rec.assignedName !== null && rec.assignedName !== '') {
    file.assignedName = asString(rec.assignedName, '指定文件名');
  }
  if (rec.duplicateCount !== undefined) {
    file.duplicateCount = asNonNegativeInt(rec.duplicateCount, '重复人数');
  }
  const duplicateStudentIds = parseOptionalStringList(rec.duplicateStudentIds, '重复学号');
  if (duplicateStudentIds) file.duplicateStudentIds = duplicateStudentIds;
  return file;
}

function parseProgressStatus(rec: Record<string, unknown>): ProgressRowStatus {
  if (rec.status === 'submitted') return 'submitted';
  if (rec.status === 'missing' || rec.status === 'draft') return 'missing';
  if (rec.submitted === true) return 'submitted';
  if (rec.submitted === false) return 'missing';
  throw new Error('提交状态格式不正确');
}

function parseProgressHistoryFile(value: unknown, slots: SlotDraft[], requestId: string): ProgressHistoryFile {
  const file = parseProgressFile(value, slots, requestId);
  const rec = asRecord(value, '历史文件');
  return { ...file, version: asNonNegativeInt(rec.version, '历史版本') };
}

function parseProgressRow(value: unknown, slots: SlotDraft[], requestId: string): ProgressRow {
  const rec = asRecord(value, '进度行');
  const filesRaw = rec.files ?? rec.currentFiles;
  if (!Array.isArray(filesRaw)) throw new Error('进度文件列表格式不正确');
  const historyRaw = rec.history;
  if (historyRaw !== undefined && !Array.isArray(historyRaw)) throw new Error('历史文件列表格式不正确');
  return {
    uid: asUid(rec.uid, '用户'),
    studentId: asOptionalString(rec.studentId, '学号'),
    realName: asOptionalString(rec.realName, '姓名'),
    status: parseProgressStatus(rec),
    leftGroup: optionalBoolean(rec.leftGroup, false, '已退组'),
    submittedAt: asOptionalIso(rec.submittedAt, '提交时间'),
    files: filesRaw.map((item) => parseProgressFile(item, slots, requestId)),
    history: Array.isArray(historyRaw) ? historyRaw.map((item) => parseProgressHistoryFile(item, slots, requestId)) : [],
  };
}

function parseStatsRequest(value: unknown, currentUid: number): CollectStatsRequest {
  const rec = asRecord(value, '文件收集');
  const ownerUid = rec.ownerUid === undefined ? null : asUid(rec.ownerUid, '创建者');
  const slots = rec.slots === undefined ? [] : Array.isArray(rec.slots) ? rec.slots.map(parseSlot) : null;
  if (!slots) throw new Error('槽位格式不正确');
  return {
    _id: asId(rec._id, '文件收集'),
    title: asString(rec.title, '标题'),
    status: parseStatus(rec.status),
    dueAt: asIso(rec.dueAt, '截止时间'),
    slots,
    canEdit: optionalBoolean(rec.canEdit, ownerUid === null ? true : ownerUid === currentUid, '编辑权限'),
  };
}

function parseStatsPageData(value: unknown, currentUid: number): CollectStatsPageData {
  const rec = asRecord(value, '文件收集进度页');
  const request = parseStatsRequest(rec.request, currentUid);
  const rawRows = rec.rows ?? rec.progress;
  if (!Array.isArray(rawRows)) throw new Error('进度列表格式不正确');
  const rows = rawRows.map((item) => parseProgressRow(item, request.slots, request._id));
  const current = rows.filter((row) => !row.leftGroup);
  const derivedSubmitted = current.filter((row) => row.status === 'submitted').length;
  return {
    request: {
      ...request,
      canEdit: optionalBoolean(rec.canEdit, request.canEdit, '编辑权限'),
    },
    dueCount: rec.dueCount === undefined ? current.length : asNonNegativeInt(rec.dueCount, '应交人数'),
    submittedCount: rec.submittedCount === undefined ? derivedSubmitted : asNonNegativeInt(rec.submittedCount, '已交人数'),
    missingCount:
      rec.missingCount === undefined ? current.length - derivedSubmitted : asNonNegativeInt(rec.missingCount, '未交人数'),
    rows,
    canNudge: optionalBoolean(rec.canNudge, true, '催交权限'),
    canPack: optionalBoolean(rec.canPack, true, '打包权限'),
  };
}

function parsePackPayload(value: unknown, title: string): PackPayload {
  const rec = asRecord(value, '打包结果');
  if (!Array.isArray(rec.entries)) throw new Error('打包条目格式不正确');
  const entries: ZipDownloadTarget[] = rec.entries.map((item) => {
    const entry = asRecord(item, '打包条目');
    const name = asString(entry.name, '打包条目名').trim();
    const url = asString(entry.url, '打包下载地址').trim();
    if (!name || !url) throw new Error('打包条目格式不正确');
    return { name, url };
  });
  const csv = asString(rec.csv, '未交 CSV');
  if (typeof rec.submittedCsv !== 'string') throw new Error('打包结果格式不正确');
  const submittedCsv = rec.submittedCsv;
  const manifest = asString(rec.manifest, 'MANIFEST');
  const filename = typeof rec.filename === 'string' && rec.filename.trim() ? rec.filename.trim() : `${safeZipStem(title)}.zip`;
  return { entries, csv, submittedCsv, manifest, filename };
}

function safeZipStem(title: string): string {
  const stem = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return stem || '文件收集';
}

function toCstDateTimeLocal(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const cst = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${cst.getUTCFullYear()}-${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())}T${pad(cst.getUTCHours())}:${pad(cst.getUTCMinutes())}`;
}

function bytesToMib(bytes: number): number {
  return Math.max(1, Math.round(bytes / MIB));
}

function mibToBytes(mib: number, cap: number): number {
  return Math.min(cap, Math.max(MIB, Math.round(mib) * MIB));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MIB).toFixed(2)} MB`;
}

function defaultSlot(id: string): SlotDraft {
  return {
    id,
    title: '文件',
    required: true,
    allowedExt: [...ALLOWED_EXTS],
    maxFiles: HARD_MAX_FILES,
  };
}

function serializeSlots(slots: SlotDraft[]) {
  return slots.map((slot) => {
    const body = {
      title: slot.title.trim(),
      required: slot.required,
      allowedExt: slot.allowedExt,
      maxFiles: slot.maxFiles,
    };
    if (slot.id.startsWith('new-')) return body;
    return { id: slot.id, ...body };
  });
}

function readCreateQuery(): { courseId: string; chapterId: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    courseId: params.get('fromCourse') || '',
    chapterId: params.get('chapter') || '',
  };
}

/**
 * 用户组下拉选项：常规选择器过滤已归档组；
 * 当前已选中的历史值保留并标注「已归档」，保证旧收集的引用仍可解析。
 */
function groupSelectOptions(userGroups: GroupRef[], schools: SchoolRef[], selected?: string) {
  return userGroups
    .filter((g) => !g.archivedAt || g._id === selected)
    .map((g) => {
      const s = schools.find((s2) => s2._id === g.schoolId);
      const base = `${s ? `${s.name} / ` : ''}${g.name}`;
      return { value: g._id, label: g.archivedAt ? `${base}（已归档）` : base };
    });
}

function groupLabel(group: GroupRef, schools: SchoolRef[]): string {
  return groupSelectOptions([group], schools, group._id)[0]?.label || group.name;
}

function statusLabel(status: CollectRequestStatus): string {
  if (status === 'draft') return '草稿';
  if (status === 'published') return '已发布';
  if (status === 'closed') return '已关闭';
  return '已归档';
}

function StatusBadge({ status }: { status: CollectRequestStatus }) {
  if (status === 'published') return <Badge className="bg-emerald-500 text-white hover:bg-emerald-500/90">已发布</Badge>;
  if (status === 'draft') return <Badge variant="outline">草稿</Badge>;
  if (status === 'closed') return <Badge variant="secondary">已关闭</Badge>;
  return <Badge variant="outline">已归档</Badge>;
}

function CollaboratorSelect({
  domainId,
  value,
  onChange,
  disabled,
}: {
  domainId: string;
  value: DomainUserOption[];
  onChange: (users: DomainUserOption[]) => void;
  disabled?: boolean;
}) {
  return (
    <MultiSelect<DomainUserOption>
      value={value}
      onChange={onChange}
      loadOptions={(query) => loadDomainUsers(domainId, query)}
      getKey={(item) => String(item._id)}
      getLabel={domainUserSearchLabel}
      renderChip={(item) => <span>{item.displayName || item.uname || `UID ${item._id}`}</span>}
      renderOption={(item) => <DomainUserSearchOption user={item} />}
      name="collaboratorUids"
      valueFormat="repeated"
      disabled={disabled}
      placeholder="搜索 UID / OJ 用户 / 学号 / 姓名"
      emptyText="没有匹配的用户"
    />
  );
}

export function AdminCollectListPage() {
  const bs = useBootstrap();
  const data = parseListPageData(bs.page.data, bs.user.id);

  return (
    <ModuleWorkspace
      {...COLLECT_WORKSPACE_PROPS}
      title="文件收集"
      description="圈班级、设槽位和截止时间；学生按槽交文件。不打分、不退回。"
      actions={
        data.canCreate ? (
          <Button asChild className="min-h-10">
            <a href="/admin/collect/create">
              <Plus className="mr-1 size-4" />
              新建
            </a>
          </Button>
        ) : null
      }
    >
      <Card>
        <CardContent className="p-0">
          <Table className="min-w-[56rem]">
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>学校</TableHead>
                <TableHead>截止</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>已交 / 应交</TableHead>
                <TableHead className="w-80">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                    还没有文件收集，点击右上角「新建」开始创建
                  </TableCell>
                </TableRow>
              ) : (
                data.requests.map((item) => (
                  <TableRow key={item._id}>
                    <TableCell>
                      <a href={`/admin/collect/${item._id}/edit`} className="font-medium hover:underline">
                        {item.title}
                      </a>
                    </TableCell>
                    <TableCell className="text-sm">{item.schoolName}</TableCell>
                    <TableCell className="text-xs">
                      <DateTime value={item.dueAt} mode="datetime" />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.submitted}/{item.total}
                    </TableCell>
                    <TableCell>
                      <TableActions>
                        <TableAction href={`/admin/collect/${item._id}/edit`}>编辑</TableAction>
                        <TableAction href={`/admin/collect/${item._id}`}>进度</TableAction>
                        {item.canEdit && item.status === 'draft' ? (
                          <TableAction formAction="/admin/collect" hidden={{ operation: 'publish', id: item._id }}>
                            发布
                          </TableAction>
                        ) : null}
                        {item.canEdit && item.status === 'published' ? (
                          <TableAction
                            formAction="/admin/collect"
                            hidden={{ operation: 'close', id: item._id }}
                            confirm="关闭后学生不能再交文件。"
                          >
                            关闭
                          </TableAction>
                        ) : null}
                        {item.canEdit && item.status === 'closed' && Date.parse(item.dueAt) > Date.now() ? (
                          <TableAction formAction="/admin/collect" hidden={{ operation: 'reopen', id: item._id }}>
                            重新开放
                          </TableAction>
                        ) : null}
                        {item.canEdit && !item.hasFiles && item.status !== 'archived' ? (
                          <TableAction
                            formAction="/admin/collect"
                            hidden={{ operation: 'delete', id: item._id }}
                            icon={Trash2}
                            variant="destructive"
                            hint="删除"
                            confirm={`确定删除文件收集「${item.title}」？`}
                          />
                        ) : null}
                        {item.canEdit && item.hasFiles && item.status !== 'archived' ? (
                          <TableAction
                            formAction="/admin/collect"
                            hidden={{ operation: 'archive', id: item._id }}
                            icon={Archive}
                            hint="归档"
                            confirm={`归档「${item.title}」后不能再收文件，已交文件保留。`}
                          />
                        ) : null}
                      </TableActions>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ModuleWorkspace>
  );
}

export function AdminCollectEditPage() {
  const bs = useBootstrap();
  const data = parseEditPageData(bs.page.data, bs.user.id);
  const initial = data.request;
  const isEdit = initial !== null;
  const query = isEdit ? { courseId: '', chapterId: '' } : readCreateQuery();
  const canEdit = data.canEdit;
  const slotsLocked = data.hasSubmissions;

  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [schoolId, setSchoolId] = useState(() => {
    if (initial?.schoolId) return initial.schoolId;
    if (data.prefillSchoolId) return data.prefillSchoolId;
    const prefillGroups = data.groups.filter((group) => data.prefillGroupIds.includes(group._id));
    if (prefillGroups[0]) return prefillGroups[0].schoolId;
    return data.schools.length === 1 ? data.schools[0]._id : '';
  });
  const [groupIds, setGroupIds] = useState<string[]>(() => initial?.groupIds || data.prefillGroupIds);
  const [dueAt, setDueAt] = useState(toCstDateTimeLocal(initial?.dueAt));
  const [slotNonce, setSlotNonce] = useState(1);
  const [slots, setSlots] = useState<SlotDraft[]>(() => (initial?.slots.length ? initial.slots : [defaultSlot('new-0')]));
  const [collaborators, setCollaborators] = useState<DomainUserOption[]>(data.collaborators);
  const [courseId, setCourseId] = useState(initial?.courseRef?.courseId || data.fromCourse || query.courseId);
  const [chapterId, setChapterId] = useState(initial?.courseRef?.chapterId || data.chapter || query.chapterId);
  const [maxFileMib, setMaxFileMib] = useState(bytesToMib(initial?.maxFileBytes || HARD_MAX_FILE_BYTES));
  const [maxTotalMib, setMaxTotalMib] = useState(bytesToMib(initial?.maxTotalBytes || HARD_MAX_TOTAL_BYTES));
  const [maxFiles, setMaxFiles] = useState(initial?.maxFiles || HARD_MAX_FILES);
  const [fileNameTemplate, setFileNameTemplate] = useState(initial?.fileNameTemplate || COLLECT_DEFAULT_FILE_NAME_TEMPLATE);
  const [packLayout, setPackLayout] = useState<CollectPackLayout>(initial?.packLayout || COLLECT_DEFAULT_PACK_LAYOUT);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const namesLocked = slotsLocked || !canEdit;
  const namePreview = useMemo(() => {
    const assigned = renderAssignedFileName(fileNameTemplate, FILE_NAME_PREVIEW_CTX);
    return {
      assigned,
      pack: renderPackEntryName(packLayout, FILE_NAME_PREVIEW_FOLDER, FILE_NAME_PREVIEW_CTX.slotTitle, assigned),
    };
  }, [fileNameTemplate, packLayout]);

  function insertNameToken(token: CollectNameToken) {
    if (namesLocked) return;
    const wrapped = `{${token}}`;
    const input = templateInputRef.current;
    const start = input?.selectionStart ?? fileNameTemplate.length;
    const end = input?.selectionEnd ?? fileNameTemplate.length;
    const next = `${fileNameTemplate.slice(0, start)}${wrapped}${fileNameTemplate.slice(end)}`;
    setFileNameTemplate(next);
    const cursor = start + wrapped.length;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
  }

  const collaboratorUidsKey = data.collaborators.map((user) => user._id).join(',');
  useEffect(() => {
    const uids = collaboratorUidsKey
      .split(',')
      .map((item) => Number(item))
      .filter((uid) => Number.isSafeInteger(uid) && uid > 0);
    if (!uids.length) return undefined;
    let cancelled = false;
    void Promise.all(
      uids.map(async (uid) => {
        try {
          const users = await loadDomainUsers(bs.domain.id, String(uid));
          return users.find((item) => item._id === uid) || { _id: uid };
        } catch {
          return { _id: uid };
        }
      }),
    ).then((hydrated) => {
      if (cancelled) return;
      setCollaborators((prev) =>
        prev.map((user) => {
          const next = hydrated.find((item) => item._id === user._id);
          return next && (next.uname || next.displayName) ? next : user;
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [bs.domain.id, collaboratorUidsKey]);

  const schoolGroups = useMemo(
    () => data.groups.filter((group) => group.schoolId === schoolId && (!group.archivedAt || groupIds.includes(group._id))),
    [data.groups, schoolId, groupIds],
  );
  const selectedCourse = data.courses.find((course) => course._id === courseId) || null;
  const formAction = isEdit ? `/admin/collect/${initial._id}/edit` : '/admin/collect/create';
  const status = initial?.status || 'draft';

  function updateSlot(slotId: string, patch: Partial<SlotDraft>) {
    if (slotsLocked || !canEdit) return;
    setSlots((current) => current.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)));
  }

  function toggleExt(slotId: string, ext: AllowedExt, checked: boolean) {
    if (slotsLocked || !canEdit) return;
    setSlots((current) =>
      current.map((slot) => {
        if (slot.id !== slotId) return slot;
        const next = checked ? [...slot.allowedExt, ext] : slot.allowedExt.filter((item) => item !== ext);
        return { ...slot, allowedExt: ALLOWED_EXTS.filter((item) => next.includes(item)) };
      }),
    );
  }

  function addSlot() {
    if (slotsLocked || !canEdit) return;
    const id = `new-${slotNonce}`;
    setSlotNonce((n) => n + 1);
    setSlots((current) => [...current, { ...defaultSlot(id), title: '' }]);
  }

  function removeSlot(slotId: string) {
    if (slotsLocked || !canEdit || slots.length <= 1) return;
    setSlots((current) => current.filter((slot) => slot.id !== slotId));
  }

  return (
    <ModuleWorkspace
      {...COLLECT_WORKSPACE_PROPS}
      title={isEdit ? '编辑文件收集' : '新建文件收集'}
      description={isEdit ? '修改说明和截止时间；已有人提交后不能改槽位或上限。' : '先保存草稿，圈好同校班级后再发布。'}
      actions={
        <Button asChild variant="outline" className="min-h-10">
          <a href="/admin/collect">
            <ArrowLeft className="mr-1 size-4" />
            返回列表
          </a>
        </Button>
      }
    >
      <form method="post" action={formAction} className="space-y-4">
        {isEdit ? <input type="hidden" name="id" value={initial._id} /> : null}
        {isEdit ? <input type="hidden" name="revision" value={String(initial.revision)} /> : null}
        <input type="hidden" name="slots" value={JSON.stringify(serializeSlots(slots))} />
        <input type="hidden" name="maxFileBytes" value={String(mibToBytes(maxFileMib, HARD_MAX_FILE_BYTES))} />
        <input type="hidden" name="maxTotalBytes" value={String(mibToBytes(maxTotalMib, HARD_MAX_TOTAL_BYTES))} />
        <input type="hidden" name="maxFiles" value={String(maxFiles)} />
        <input type="hidden" name="fileNameTemplate" value={fileNameTemplate} />
        <input type="hidden" name="packLayout" value={packLayout} />
        <input type="hidden" name="groupIds" value={groupIds.join(',')} />
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="chapterId" value={chapterId} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <FormSection>
              <FormField label="标题" required htmlFor="collect-title">
                <Input
                  id="collect-title"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  disabled={!canEdit}
                  placeholder="例如：第 3 周实验报告"
                  className="min-h-10"
                />
              </FormField>
              <FormField label="说明" hint="Markdown">
                <Textarea
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canEdit}
                  placeholder="交什么、命名要求、注意事项"
                  className="min-h-[8rem]"
                />
              </FormField>
              <FormField label="截止时间" required htmlFor="collect-due">
                <Input
                  id="collect-due"
                  name="dueAt"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  required
                  disabled={!canEdit}
                  className="min-h-10"
                />
              </FormField>
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">受众</CardTitle>
          </CardHeader>
          <CardContent>
            <FormSection>
              <FormRow columns={2}>
                <FormField label="学校" required htmlFor="collect-school">
                  <SimpleSelect
                    id="collect-school"
                    name="schoolId"
                    value={schoolId}
                    onValueChange={(next) => {
                      setSchoolId(next);
                      setGroupIds((ids) => ids.filter((id) => data.groups.some((group) => group._id === id && group.schoolId === next)));
                    }}
                    disabled={!canEdit}
                    className="min-h-10"
                    options={[
                      { value: '', label: '— 选择学校 —' },
                      ...data.schools.map((school) => ({ value: school._id, label: school.name })),
                    ]}
                  />
                </FormField>
                <FormField label="用户组" required hint="只显示所选学校的班级 / 队伍">
                  {schoolId ? (
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-3">
                      {schoolGroups.length === 0 ? (
                        <p className="text-sm text-muted-foreground">这所学校还没有可用用户组</p>
                      ) : (
                        schoolGroups.map((group) => {
                          const checked = groupIds.includes(group._id);
                          const label = groupLabel(group, data.schools);
                          return (
                            <label key={group._id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                              <Checkbox
                                checked={checked}
                                disabled={!canEdit}
                                onCheckedChange={(next) => {
                                  setGroupIds((ids) => (next ? [...ids, group._id] : ids.filter((id) => id !== group._id)));
                                }}
                              />
                              {label}
                            </label>
                          );
                        })
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">请先选择学校</p>
                  )}
                </FormField>
              </FormRow>
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">槽位</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {slotsLocked ? (
              <p role="note" className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                已有人提交，不能改槽位
              </p>
            ) : null}
            {slots.map((slot, index) => (
              <div key={slot.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">槽位 {index + 1}</p>
                  {canEdit && !slotsLocked && slots.length > 1 ? (
                    <Button type="button" variant="ghost" size="sm" className="min-h-10 text-destructive" onClick={() => removeSlot(slot.id)}>
                      <Trash2 className="mr-1 size-3.5" />
                      删除
                    </Button>
                  ) : null}
                </div>
                <FormRow columns={2}>
                  <FormField label="名称" required>
                    <Input
                      value={slot.title}
                      onChange={(e) => updateSlot(slot.id, { title: e.target.value })}
                      disabled={!canEdit || slotsLocked}
                      placeholder="例如：实验报告"
                      className="min-h-10"
                    />
                  </FormField>
                  <FormField label="每槽最多文件数">
                    <Input
                      type="number"
                      min={1}
                      max={HARD_MAX_FILES}
                      value={slot.maxFiles}
                      disabled={!canEdit || slotsLocked}
                      onChange={(e) => updateSlot(slot.id, { maxFiles: clampInt(e.target.value, 1, HARD_MAX_FILES) })}
                      className="min-h-10"
                    />
                  </FormField>
                </FormRow>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={slot.required}
                    disabled={!canEdit || slotsLocked}
                    onCheckedChange={(checked) => updateSlot(slot.id, { required: checked })}
                  />
                  必填
                </label>
                <div className="flex flex-wrap gap-3">
                  {ALLOWED_EXTS.map((ext) => (
                    <label key={ext} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={slot.allowedExt.includes(ext)}
                        disabled={!canEdit || slotsLocked}
                        onCheckedChange={(checked) => toggleExt(slot.id, ext, checked)}
                      />
                      {ext}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {canEdit && !slotsLocked ? (
              <Button type="button" variant="outline" className="min-h-10" onClick={addSlot}>
                <Plus className="mr-1 size-4" />
                添加槽位
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">上限</CardTitle>
          </CardHeader>
          <CardContent>
            <FormSection>
              {slotsLocked ? (
                <p role="note" className="text-sm text-muted-foreground">
                  已有人提交，不能改槽位或类型上限。
                </p>
              ) : null}
              <FormRow columns={3}>
                <FormField label="单文件上限 (MiB)" hint={`最高 ${HARD_MAX_FILE_BYTES / MIB}`}>
                  <Input
                    type="number"
                    min={1}
                    max={HARD_MAX_FILE_BYTES / MIB}
                    value={maxFileMib}
                    disabled={!canEdit || slotsLocked}
                    onChange={(e) => setMaxFileMib(clampInt(e.target.value, 1, HARD_MAX_FILE_BYTES / MIB))}
                    className="min-h-10"
                  />
                </FormField>
                <FormField label="每人合计 (MiB)" hint={`最高 ${HARD_MAX_TOTAL_BYTES / MIB}`}>
                  <Input
                    type="number"
                    min={1}
                    max={HARD_MAX_TOTAL_BYTES / MIB}
                    value={maxTotalMib}
                    disabled={!canEdit || slotsLocked}
                    onChange={(e) => setMaxTotalMib(clampInt(e.target.value, 1, HARD_MAX_TOTAL_BYTES / MIB))}
                    className="min-h-10"
                  />
                </FormField>
                <FormField label="每人最多文件数" hint={`最高 ${HARD_MAX_FILES}`}>
                  <Input
                    type="number"
                    min={1}
                    max={HARD_MAX_FILES}
                    value={maxFiles}
                    disabled={!canEdit || slotsLocked}
                    onChange={(e) => setMaxFiles(clampInt(e.target.value, 1, HARD_MAX_FILES))}
                    className="min-h-10"
                  />
                </FormField>
              </FormRow>
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">文件名</CardTitle>
          </CardHeader>
          <CardContent>
            <FormSection>
              {slotsLocked ? (
                <p role="note" className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  已有人提交，不能改文件名格式或打包目录
                </p>
              ) : null}
              <FormField label="打包目录" htmlFor="collect-pack-layout">
                <SimpleSelect
                  id="collect-pack-layout"
                  value={packLayout}
                  onValueChange={(next) => {
                    if (namesLocked) return;
                    if (next === 'nested' || next === 'flat') setPackLayout(next);
                  }}
                  disabled={namesLocked}
                  className="min-h-10"
                  options={[...PACK_LAYOUT_OPTIONS]}
                />
              </FormField>
              <FormField label="文件名格式" htmlFor="collect-file-name-template" hint="扩展名始终使用实际上传类型；不改学生文件本身">
                <Input
                  id="collect-file-name-template"
                  ref={templateInputRef}
                  value={fileNameTemplate}
                  onChange={(e) => setFileNameTemplate(e.target.value)}
                  disabled={namesLocked}
                  placeholder="{originalName}"
                  className="min-h-10 font-mono"
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                {COLLECT_NAME_TOKENS.map((token) => (
                  <Button
                    key={token}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-10 font-mono"
                    disabled={namesLocked}
                    onClick={() => insertNameToken(token)}
                  >
                    {`{${token}}`}
                  </Button>
                ))}
              </div>
              <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs leading-6">
                <span className="text-muted-foreground">预览文件名 </span>
                {namePreview.assigned}
                <br />
                <span className="text-muted-foreground">预览打包 </span>
                {namePreview.pack}
                <br />
                <span className="text-muted-foreground">
                  示例 24000001 / 张三 / 实验报告 / 1 / pdf / lab.pdf
                </span>
              </p>
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">协作者</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField label="可看进度、催未交和打包的教师" hint="不能把学生加进去；服务端会再查创建权限">
              <CollaboratorSelect domainId={bs.domain.id} value={collaborators} onChange={setCollaborators} disabled={!canEdit} />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">课程引用</CardTitle>
          </CardHeader>
          <CardContent>
            <FormSection>
              <FormRow columns={2}>
                <FormField label="课程" hint="可选，不改课程章节结构">
                  <SimpleSelect
                    value={courseId}
                    onValueChange={(next) => {
                      setCourseId(next);
                      const course = data.courses.find((item) => item._id === next);
                      if (!course || !course.chapters.some((chapter) => chapter._id === chapterId)) setChapterId('');
                    }}
                    disabled={!canEdit}
                    className="min-h-10"
                    options={[
                      { value: '', label: '不关联课程' },
                      ...data.courses.map((course) => ({ value: course._id, label: course.title })),
                    ]}
                  />
                </FormField>
                <FormField label="章节">
                  <SimpleSelect
                    value={chapterId}
                    onValueChange={setChapterId}
                    disabled={!canEdit || !courseId}
                    className="min-h-10"
                    options={[
                      { value: '', label: '选择章节' },
                      ...(selectedCourse?.chapters || []).map((chapter) => ({ value: chapter._id, label: chapter.title })),
                    ]}
                  />
                </FormField>
              </FormRow>
            </FormSection>
          </CardContent>
        </Card>

        {canEdit ? (
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" asChild className="min-h-10">
              <a href="/admin/collect">取消</a>
            </Button>
            {isEdit && status === 'published' ? (
              <Button type="submit" name="operation" value="close" variant="outline" className="min-h-10">
                关闭
              </Button>
            ) : null}
            {isEdit && status === 'closed' ? (
              <Button type="submit" name="operation" value="reopen" variant="outline" className="min-h-10">
                重新开放
              </Button>
            ) : null}
            <Button type="submit" name="operation" value={isEdit ? 'update' : 'create'} className="min-h-10">
              <Save className="mr-1 size-3.5" />
              保存
            </Button>
            {!isEdit || status === 'draft' ? (
              <Button type="submit" name="operation" value="publish" className="min-h-10">
                <FolderUp className="mr-1 size-3.5" />
                发布
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
    </ModuleWorkspace>
  );
}

export function AdminCollectStatsPage() {
  const bs = useBootstrap();
  const data = parseStatsPageData(bs.page.data, bs.user.id);
  const [packing, setPacking] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const currentRows = data.rows.filter((row) => !row.leftGroup);
  const leftGroupRows = data.rows.filter((row) => row.leftGroup);

  async function packDownload() {
    if (packing) return;
    setPacking(true);
    setPackError(null);
    try {
      const response = await fetchHydroResponse(
        `/admin/collect/${encodeURIComponent(data.request._id)}/pack`,
        {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        },
        '打包失败',
      );
      if (!response.ok) throw new Error(await readHydroResponseError(response, '打包失败'));
      const pack = parsePackPayload(await response.json(), data.request.title);
      await downloadZip(pack.filename, [
        ...pack.entries,
        { name: '已交.csv', content: pack.submittedCsv },
        { name: '未交.csv', content: pack.csv },
        { name: 'MANIFEST', content: pack.manifest },
      ]);
    } catch (cause) {
      setPackError(cause instanceof Error ? cause.message : '打包失败');
    } finally {
      setPacking(false);
    }
  }

  return (
    <ModuleWorkspace
      {...COLLECT_WORKSPACE_PROPS}
      title={`进度 — ${data.request.title}`}
      description={
        <span>
          {statusLabel(data.request.status)}，截止 <DateTime value={data.request.dueAt} mode="datetime" />
        </span>
      }
      actions={
        <div className="flex max-w-full flex-wrap gap-2">
          {data.canNudge ? (
            <form method="post" action={`/admin/collect/${data.request._id}`}>
              <input type="hidden" name="operation" value="nudge" />
              <Button type="submit" variant="outline" className="min-h-10" disabled={data.missingCount === 0}>
                <Bell className="mr-1 size-4" />
                催未交
              </Button>
            </form>
          ) : null}
          {data.canPack ? (
            <Button type="button" variant="outline" className="min-h-10" disabled={packing} onClick={() => void packDownload()}>
              <FileDown className="mr-1 size-4" />
              {packing ? '打包中…' : '打包下载'}
            </Button>
          ) : null}
          {data.request.canEdit ? (
            <Button asChild variant="outline" className="min-h-10">
              <a href={`/admin/collect/${data.request._id}/edit`}>编辑</a>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="min-h-10">
            <a href="/admin/collect">
              <ArrowLeft className="mr-1 size-4" />
              返回列表
            </a>
          </Button>
        </div>
      }
    >
      {packError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {packError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">应交</p>
            <p className="mt-1 text-2xl font-semibold">{data.dueCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">已交</p>
            <p className="mt-1 text-2xl font-semibold">{data.submittedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">未交</p>
            <p className="mt-1 text-2xl font-semibold">{data.missingCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table className="min-w-[56rem]">
            <TableHeader>
              <TableRow>
                <TableHead>学号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>文件</TableHead>
                <TableHead>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentRows.length === 0 && leftGroupRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                    还没有进度
                  </TableCell>
                </TableRow>
              ) : null}
              {currentRows.map((row) => (
                <ProgressTableRow key={row.uid} row={row} />
              ))}
              {leftGroupRows.length > 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="bg-muted/40 text-xs font-medium text-muted-foreground">
                    已退组（已交）
                  </TableCell>
                </TableRow>
              ) : null}
              {leftGroupRows.map((row) => (
                <ProgressTableRow key={`left-${row.uid}`} row={row} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ModuleWorkspace>
  );
}

function duplicateOtherCount(file: ProgressFile): number | null {
  if (file.duplicateCount === undefined || file.duplicateCount <= 1) return null;
  if (file.duplicateStudentIds && file.duplicateStudentIds.length > 0) return file.duplicateStudentIds.length;
  return file.duplicateCount - 1;
}

function ProgressFileLink({
  file,
  prefix,
  showDuplicates,
  muted,
}: {
  file: ProgressFile;
  prefix?: string;
  showDuplicates: boolean;
  muted?: boolean;
}) {
  const primary = file.assignedName || file.originalName;
  const showOriginal = Boolean(file.assignedName && file.assignedName !== file.originalName);
  const others = showDuplicates ? duplicateOtherCount(file) : null;
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <a
          href={file.url}
          className={muted ? 'text-xs text-muted-foreground hover:underline' : 'text-xs text-primary hover:underline'}
          rel="noopener"
        >
          {prefix}
          {file.slotTitle} / {primary}
          <span className={muted ? 'ml-1' : 'ml-1 text-muted-foreground'}>({formatSize(file.size)})</span>
        </a>
        {others !== null && others > 0 ? (
          <Badge variant="outline" title={file.duplicateStudentIds?.join('、') || undefined}>
            与 {others} 人相同
          </Badge>
        ) : null}
      </div>
      {showOriginal ? <p className="text-[11px] text-muted-foreground">原名 {file.originalName}</p> : null}
    </div>
  );
}

function ProgressTableRow({ row }: { row: ProgressRow }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-sm">{row.studentId || `UID ${row.uid}`}</TableCell>
      <TableCell className="text-sm">{row.realName || '—'}</TableCell>
      <TableCell>
        {row.status === 'submitted' ? (
          <Badge className="bg-emerald-500 text-white hover:bg-emerald-500/90">已交文件</Badge>
        ) : (
          <Badge variant="outline">未交文件</Badge>
        )}
      </TableCell>
      <TableCell>
        {row.files.length === 0 && row.history.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="space-y-1">
            {row.files.map((file) => (
              <ProgressFileLink key={file.fileId} file={file} showDuplicates />
            ))}
            {row.history.map((file) => (
              <ProgressFileLink
                key={`history-${file.fileId}`}
                file={file}
                prefix={`历史 v${file.version} / `}
                showDuplicates={false}
                muted
              />
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs">{row.submittedAt ? <DateTime value={row.submittedAt} mode="datetime" /> : '—'}</TableCell>
    </TableRow>
  );
}
