import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { extname } from 'path';
import { nanoid } from 'nanoid';
import type { CourseVideo, TrainingNode, TrainingSection } from '../interface';
export type { CourseVideo };

export const COURSE_VIDEO_MAX_PER_NODE = 8;
export const COURSE_VIDEO_MAX_BYTES = 512 * 1024 * 1024;
export const COURSE_VIDEO_COMPLETE_RATIO = 0.95;
export const COURSE_VIDEO_TAIL_SLACK_SEC = 3;
export const COURSE_VIDEO_MAX_RATE = 1.5;
export const COURSE_VIDEO_RATES = [1, 1.25, 1.5] as const;
export const COURSE_VIDEO_MAX_HEARTBEAT_SPAN_SEC = 20;
export const COURSE_VIDEO_MIN_DURATION_MS = 3_000;
export const COURSE_VIDEO_MAX_DURATION_MS = 4 * 3600 * 1000;
export const COURSE_VIDEO_EXTS = ['mp4', 'webm'] as const;
export const COURSE_VIDEO_ID_PREFIX = 'cv_';

export type CourseVideoExt = (typeof COURSE_VIDEO_EXTS)[number];

export interface CourseVideoLocation {
    video: CourseVideo;
    chapterId: number;
    sectionId: number | null;
}

export type CoverageRange = [number, number];

const VIDEO_KEYS = ['id', 'title', 'filename', 'ext', 'size', 'sha256', 'durationMs', 'confirmed', 'contentRevision'] as const;
const VIDEO_ID_RE = /^cv_[A-Za-z0-9_-]{16,32}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export function isCourseVideoExt(value: string): value is CourseVideoExt {
    return (COURSE_VIDEO_EXTS as readonly string[]).includes(value);
}

export function courseVideoId(): string {
    return `${COURSE_VIDEO_ID_PREFIX}${nanoid(21)}`;
}

export function courseVideoExtOf(filename: string): CourseVideoExt {
    const ext = extname(filename).replace(/^\./, '').toLowerCase();
    if (!isCourseVideoExt(ext)) throw new Error('视频只接受 mp4 或 webm');
    return ext;
}

export function courseVideoStoragePath(domainId: string, courseId: string, videoId: string, contentRevision: number, ext: CourseVideoExt): string {
    if (!domainId || domainId.includes('/') || domainId.includes('..')) throw new Error('invalid domainId');
    if (!courseId || courseId.includes('/') || courseId.includes('..')) throw new Error('invalid courseId');
    if (!VIDEO_ID_RE.test(videoId)) throw new Error('invalid videoId');
    if (!Number.isSafeInteger(contentRevision) || contentRevision < 1) throw new Error('invalid contentRevision');
    return `course/${domainId}/${courseId}/video/${videoId}/r${contentRevision}.${ext}`;
}

export async function hashFileSha256(filepath: string): Promise<string> {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filepath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve());
    });
    return hash.digest('hex');
}

export function parseCourseVideos(ownerLabel: string, raw: unknown): CourseVideo[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new Error(`${ownerLabel} 的视频必须是数组`);
    if (raw.length > COURSE_VIDEO_MAX_PER_NODE) throw new Error(`${ownerLabel} 最多 ${COURSE_VIDEO_MAX_PER_NODE} 个视频`);
    const ids = new Set<string>();
    const videos: CourseVideo[] = [];
    for (const item of raw) {
        const video = parseCourseVideo(ownerLabel, item);
        if (ids.has(video.id)) throw new Error(`${ownerLabel} 的视频 id 必须唯一`);
        ids.add(video.id);
        videos.push(video);
    }
    return videos;
}

export function parseCourseVideo(ownerLabel: string, raw: unknown): CourseVideo {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${ownerLabel} 含无效视频`);
    const node = raw as Record<string, unknown>;
    const extra = Object.keys(node).filter((key) => !(VIDEO_KEYS as readonly string[]).includes(key));
    if (extra.length) throw new Error(`${ownerLabel} 的视频含未知字段 ${extra.join(', ')}`);
    if (typeof node.id !== 'string' || !VIDEO_ID_RE.test(node.id)) throw new Error(`${ownerLabel} 的视频需要合法 id`);
    if (typeof node.title !== 'string' || !node.title.trim()) throw new Error(`${ownerLabel} 的每个视频需要标题`);
    if (typeof node.filename !== 'string' || !node.filename.trim()) throw new Error(`${ownerLabel} 的视频缺少文件名`);
    if (typeof node.ext !== 'string' || !isCourseVideoExt(node.ext)) throw new Error(`${ownerLabel} 的视频扩展名无效`);
    if (typeof node.size !== 'number' || !Number.isSafeInteger(node.size) || node.size <= 0 || node.size > COURSE_VIDEO_MAX_BYTES) {
        throw new Error(`${ownerLabel} 的视频大小无效`);
    }
    if (typeof node.sha256 !== 'string' || !SHA256_RE.test(node.sha256)) throw new Error(`${ownerLabel} 的视频指纹无效`);
    if (typeof node.durationMs !== 'number' || !Number.isSafeInteger(node.durationMs) || node.durationMs < 0) {
        throw new Error(`${ownerLabel} 的视频时长无效`);
    }
    if (typeof node.confirmed !== 'boolean') throw new Error(`${ownerLabel} 的视频确认状态无效`);
    if (typeof node.contentRevision !== 'number' || !Number.isSafeInteger(node.contentRevision) || node.contentRevision < 1) {
        throw new Error(`${ownerLabel} 的视频版本无效`);
    }
    if (node.confirmed) {
        if (node.durationMs < COURSE_VIDEO_MIN_DURATION_MS || node.durationMs > COURSE_VIDEO_MAX_DURATION_MS) {
            throw new Error(`${ownerLabel} 的视频时长超出范围`);
        }
    } else if (node.durationMs !== 0) {
        throw new Error(`${ownerLabel} 未确认视频的时长必须为 0`);
    }
    return {
        id: node.id,
        title: node.title.trim(),
        filename: node.filename.trim(),
        ext: node.ext,
        size: node.size,
        sha256: node.sha256,
        durationMs: node.durationMs,
        confirmed: node.confirmed,
        contentRevision: node.contentRevision,
    };
}

export function studentVisibleVideos(videos: CourseVideo[] | undefined): CourseVideo[] {
    return (videos || []).filter((video) => video.confirmed);
}

export function courseUnitProgress(videoDone: number, videoTotal: number, problemDone: number, problemTotal: number) {
    const totalCount = videoTotal + problemTotal;
    const doneCount = videoDone + problemDone;
    return {
        doneCount,
        totalCount,
        progress: totalCount ? Math.floor((100 * doneCount) / totalCount) : 100,
    };
}

export function listCourseVideos(dag: Pick<TrainingNode, '_id' | 'videos' | 'sections'>[]): CourseVideoLocation[] {
    const listed: CourseVideoLocation[] = [];
    for (const chapter of dag || []) {
        for (const video of chapter.videos || []) listed.push({ video, chapterId: chapter._id, sectionId: null });
        for (const section of chapter.sections || []) {
            for (const video of section.videos || []) listed.push({ video, chapterId: chapter._id, sectionId: section._id });
        }
    }
    return listed;
}

export function findCourseVideo(dag: Pick<TrainingNode, '_id' | 'videos' | 'sections'>[], videoId: string): CourseVideoLocation | null {
    return listCourseVideos(dag).find((item) => item.video.id === videoId) || null;
}

export function mutateCourseVideos(
    dag: TrainingNode[],
    chapterId: number,
    sectionId: number | null,
    mutate: (videos: CourseVideo[]) => CourseVideo[],
): TrainingNode[] {
    let found = false;
    const next = dag.map((chapter) => {
        if (chapter._id !== chapterId) return chapter;
        if (sectionId == null) {
            found = true;
            const videos = mutate([...(chapter.videos || [])]);
            if (videos.length > COURSE_VIDEO_MAX_PER_NODE) throw new Error(`章节 ${chapterId} 最多 ${COURSE_VIDEO_MAX_PER_NODE} 个视频`);
            return { ...chapter, ...(videos.length ? { videos } : { videos: undefined }) };
        }
        return {
            ...chapter,
            sections: (chapter.sections || []).map((section) => {
                if (section._id !== sectionId) return section;
                found = true;
                const videos = mutate([...(section.videos || [])]);
                if (videos.length > COURSE_VIDEO_MAX_PER_NODE) throw new Error(`章节 ${chapterId} 小节 ${sectionId} 最多 ${COURSE_VIDEO_MAX_PER_NODE} 个视频`);
                return { ...section, ...(videos.length ? { videos } : { videos: undefined }) };
            }),
        };
    });
    if (!found) throw new Error(sectionId == null ? `章节 ${chapterId} 不存在` : `章节 ${chapterId} 小节 ${sectionId} 不存在`);
    return next;
}

export function assertCanRemoveChapter(node: Pick<TrainingNode, '_id' | 'videos' | 'sections'>): void {
    if ((node.videos || []).length) throw new Error(`章节 ${node._id} 还有视频，请先删除视频`);
    for (const section of node.sections || []) assertCanRemoveSection(node._id, section);
}

export function assertCanRemoveSection(chapterId: number, section: Pick<TrainingSection, '_id' | 'videos'>): void {
    if ((section.videos || []).length) throw new Error(`章节 ${chapterId} 小节 ${section._id} 还有视频，请先删除视频`);
}

export function mergeCoverageRanges(ranges: CoverageRange[]): CoverageRange[] {
    const normalized = ranges
        .map(([start, end]) => [roundSec(start), roundSec(end)] as CoverageRange)
        .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: CoverageRange[] = [];
    for (const range of normalized) {
        const last = merged[merged.length - 1];
        if (!last || range[0] > last[1] + 0.05) merged.push([range[0], range[1]]);
        else last[1] = Math.max(last[1], range[1]);
    }
    return merged;
}

export function coverageSeconds(ranges: CoverageRange[]): number {
    return mergeCoverageRanges(ranges).reduce((sum, [start, end]) => sum + (end - start), 0);
}

export function isCourseVideoComplete(ranges: CoverageRange[], durationMs: number): boolean {
    if (!Number.isSafeInteger(durationMs) || durationMs < COURSE_VIDEO_MIN_DURATION_MS) return false;
    const durationSec = durationMs / 1000;
    const covered = coverageSeconds(ranges);
    if (covered / durationSec >= COURSE_VIDEO_COMPLETE_RATIO) return true;
    return durationSec - covered <= COURSE_VIDEO_TAIL_SLACK_SEC;
}

export function parseRequireRewatch(raw: unknown): boolean {
    if (raw === undefined || raw === null || raw === '') throw new Error('换片必须明确是否要求重看');
    if (raw === true || raw === 'true' || raw === 'on' || raw === '1') return true;
    if (raw === false || raw === 'false' || raw === 'off' || raw === '0') return false;
    throw new Error('换片必须明确是否要求重看');
}

export function parseHeartbeatCovered(raw: unknown): CoverageRange {
    if (!Array.isArray(raw) || raw.length !== 2) throw new Error('本拍覆盖区间无效');
    const start = Number(raw[0]);
    const end = Number(raw[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('本拍覆盖区间无效');
    if (end - start > COURSE_VIDEO_MAX_HEARTBEAT_SPAN_SEC) throw new Error('本拍覆盖区间过长');
    return [start, end];
}

export interface HeartbeatInput {
    covered: CoverageRange | null;
    position: number;
    playbackRate: number;
    seekForwardAttempts: number;
    visible: boolean;
}

export interface HeartbeatState {
    ranges: CoverageRange[];
    maxRate: number;
    seekForwardAttempts: number;
    lastPosition: number;
    completedAt?: Date;
}

export interface HeartbeatResult extends HeartbeatState {
    coverageSeconds: number;
    complete: boolean;
    rejectedReason: 'hidden' | 'rate' | 'seek' | null;
}

export function applyCourseVideoHeartbeat(state: HeartbeatState, input: HeartbeatInput, durationMs: number): HeartbeatResult {
    const durationSec = durationMs / 1000;
    const seekForwardAttempts = state.seekForwardAttempts + (Number.isSafeInteger(input.seekForwardAttempts) ? Math.max(0, input.seekForwardAttempts) : 0);
    const maxRate = Math.max(state.maxRate, input.playbackRate);
    if (!input.visible) {
        return finishHeartbeat(state, { maxRate, seekForwardAttempts, rejectedReason: 'hidden' }, durationMs);
    }
    if (!(input.playbackRate > 0) || input.playbackRate > COURSE_VIDEO_MAX_RATE + 1e-6) {
        return finishHeartbeat(state, { maxRate, seekForwardAttempts, rejectedReason: 'rate' }, durationMs);
    }
    if (!input.covered) {
        return finishHeartbeat(state, { maxRate, seekForwardAttempts, rejectedReason: extraSeekReason(input.seekForwardAttempts) }, durationMs);
    }
    const [start, end] = input.covered;
    if (start > durationSec + 0.25 || end > durationSec + COURSE_VIDEO_TAIL_SLACK_SEC) {
        return finishHeartbeat(state, { maxRate, seekForwardAttempts, rejectedReason: 'seek' }, durationMs);
    }
    if (start > state.lastPosition + 1.25) {
        return finishHeartbeat(
            state,
            { maxRate, seekForwardAttempts: seekForwardAttempts + 1, rejectedReason: 'seek' },
            durationMs,
        );
    }
    const clipped: CoverageRange = [Math.max(0, start), Math.min(durationSec, end)];
    const ranges = mergeCoverageRanges([...state.ranges, clipped]);
    const lastPosition = Math.min(durationSec, Math.max(state.lastPosition, input.position, clipped[1]));
    const next: HeartbeatState = { ranges, maxRate, seekForwardAttempts, lastPosition, completedAt: state.completedAt };
    return finishHeartbeat(next, { maxRate, seekForwardAttempts, rejectedReason: null }, durationMs);
}

function finishHeartbeat(
    state: HeartbeatState,
    patch: { maxRate: number; seekForwardAttempts: number; rejectedReason: HeartbeatResult['rejectedReason'] },
    durationMs: number,
): HeartbeatResult {
    const complete = isCourseVideoComplete(state.ranges, durationMs);
    return {
        ranges: state.ranges,
        maxRate: patch.maxRate,
        seekForwardAttempts: patch.seekForwardAttempts,
        lastPosition: state.lastPosition,
        completedAt: state.completedAt || (complete ? new Date() : undefined),
        coverageSeconds: coverageSeconds(state.ranges),
        complete: complete || Boolean(state.completedAt),
        rejectedReason: patch.rejectedReason,
    };
}

export function reconcileCourseVideos(incoming: CourseVideo[] | undefined, persisted: CourseVideo[] | undefined, label: string): CourseVideo[] | undefined {
    const next = incoming || [];
    const prev = persisted || [];
    if (!next.length) return prev.length ? prev : undefined;
    if (!prev.length) throw new Error(`${label} 不能通过保存章节新增视频`);
    const prevById = new Map(prev.map((video) => [video.id, video]));
    if (next.length !== prev.length || next.some((video) => !prevById.has(video.id))) {
        throw new Error(`${label} 不能通过保存章节增删视频`);
    }
    return next.map((video) => {
        const current = prevById.get(video.id);
        if (!current) throw new Error(`${label} 不能通过保存章节增删视频`);
        return { ...current, title: video.title };
    });
}

export function reconcileCourseDagVideos(parsed: TrainingNode[], previous: TrainingNode[]): TrainingNode[] {
    const prevChapters = new Map(previous.map((node) => [node._id, node]));
    for (const [chapterId, node] of prevChapters) {
        if (!parsed.some((item) => item._id === chapterId)) assertCanRemoveChapter(node);
        else {
            const next = parsed.find((item) => item._id === chapterId);
            const nextSectionIds = new Set((next?.sections || []).map((section) => section._id));
            for (const section of node.sections || []) {
                if (!nextSectionIds.has(section._id)) assertCanRemoveSection(chapterId, section);
            }
        }
    }
    return parsed.map((chapter) => {
        const prev = prevChapters.get(chapter._id);
        const prevSections = new Map((prev?.sections || []).map((section) => [section._id, section]));
        const sections = (chapter.sections || []).map((section) => {
            const videos = reconcileCourseVideos(section.videos, prevSections.get(section._id)?.videos, `章节 ${chapter._id} 小节 ${section._id}`);
            return videos?.length ? { ...section, videos } : { ...section, videos: undefined };
        });
        const videos = reconcileCourseVideos(chapter.videos, prev?.videos, `章节 ${chapter._id}`);
        return {
            ...chapter,
            ...(sections.length ? { sections: sections.map((section) => (section.videos ? section : { ...section, videos: undefined })) } : {}),
            ...(videos?.length ? { videos } : { videos: undefined }),
        };
    });
}

export function rewriteCourseVideosForCopy(
    dag: TrainingNode[],
    allocateId: () => string = courseVideoId,
): { dag: TrainingNode[]; copies: Array<{ from: CourseVideo; to: CourseVideo }> } {
    const copies: Array<{ from: CourseVideo; to: CourseVideo }> = [];
    const nextDag = dag.map((chapter) => ({
        ...chapter,
        videos: rewriteList(chapter.videos, copies, allocateId),
        sections: (chapter.sections || []).map((section) => ({
            ...section,
            videos: rewriteList(section.videos, copies, allocateId),
        })),
    }));
    return { dag: nextDag, copies };
}

function rewriteList(
    videos: CourseVideo[] | undefined,
    copies: Array<{ from: CourseVideo; to: CourseVideo }>,
    allocateId: () => string,
): CourseVideo[] | undefined {
    if (!videos?.length) return videos;
    return videos.map((video) => {
        const to: CourseVideo = { ...video, id: allocateId(), contentRevision: 1 };
        copies.push({ from: video, to });
        return to;
    });
}

function extraSeekReason(attempts: number): HeartbeatResult['rejectedReason'] {
    return attempts > 0 ? 'seek' : null;
}

function roundSec(value: number): number {
    return Math.round(value * 100) / 100;
}
