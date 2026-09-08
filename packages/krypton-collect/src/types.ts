import type { ObjectId } from 'mongodb';

export const COLLECT_ALLOWED_EXTS = ['pdf', 'docx', 'zip', 'png', 'jpg'] as const;
export type CollectAllowedExt = (typeof COLLECT_ALLOWED_EXTS)[number];

export const COLLECT_REJECTED_EXTS = [
    'exe', 'dll', 'bat', 'cmd', 'ps1', 'sh', 'msi', 'apk', 'app',
    'html', 'htm', 'js', 'svg', 'docm', 'xlsm', 'pptm',
] as const;

export const COLLECT_HARD_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const COLLECT_HARD_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const COLLECT_HARD_MAX_FILES = 5;
export const COLLECT_NUDGE_COOLDOWN_MS = 10 * 60 * 1000;

export type CollectRequestStatus = 'draft' | 'published' | 'closed' | 'archived';
export type CollectSubmissionStatus = 'draft' | 'submitted';

export interface CollectSlot {
    id: string;
    title: string;
    required: boolean;
    allowedExt: CollectAllowedExt[];
    maxFiles: number;
}

export interface CollectCourseRef {
    courseId: ObjectId;
    chapterId: number;
}

export interface CollectRequestDoc {
    _id: ObjectId;
    domainId: string;
    ownerUid: number;
    collaboratorUids: number[];
    schoolId: ObjectId;
    groupIds: ObjectId[];
    title: string;
    description: string;
    slots: CollectSlot[];
    dueAt: Date;
    status: CollectRequestStatus;
    revision: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxFiles: number;
    courseRef: CollectCourseRef | null;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
    closedAt: Date | null;
    archivedAt: Date | null;
    lastNudgeAt: Date | null;
    lastNudgeBy: number;
}

export interface CollectCurrentFileRef {
    slotId: string;
    fileId: string;
    originalName: string;
    size: number;
    sha256: string;
    ext: CollectAllowedExt;
}

export interface CollectSubmissionDoc {
    _id: ObjectId;
    domainId: string;
    requestId: ObjectId;
    uid: number;
    status: CollectSubmissionStatus;
    submittedAt: Date | null;
    currentFiles: CollectCurrentFileRef[];
    createdAt: Date;
    updatedAt: Date;
}

export interface CollectFileDoc {
    _id: ObjectId;
    domainId: string;
    requestId: ObjectId;
    submissionId: ObjectId;
    uid: number;
    slotId: string;
    fileId: string;
    storagePath: string;
    originalName: string;
    size: number;
    sha256: string;
    ext: CollectAllowedExt;
    version: number;
    current: boolean;
    createdAt: Date;
}

export function normalizeExt(filename: string): string {
    const base = filename.trim().toLowerCase();
    const dot = base.lastIndexOf('.');
    if (dot < 0 || dot === base.length - 1) return '';
    const ext = base.slice(dot + 1);
    return ext === 'jpeg' ? 'jpg' : ext;
}

export function isAllowedExt(ext: string, slot: Pick<CollectSlot, 'allowedExt'>): ext is CollectAllowedExt {
    return (COLLECT_ALLOWED_EXTS as readonly string[]).includes(ext) && slot.allowedExt.includes(ext as CollectAllowedExt);
}

export function requiredSlotsFilled(slots: CollectSlot[], currentFiles: CollectCurrentFileRef[]): boolean {
    return slots.filter((slot) => slot.required).every((slot) => currentFiles.some((file) => file.slotId === slot.id));
}

export function storagePath(domainId: string, requestId: ObjectId | string, uid: number, fileId: string): string {
    return `collect/${domainId}/${String(requestId)}/${uid}/${fileId}`;
}
