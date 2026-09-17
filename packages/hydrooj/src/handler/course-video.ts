import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import {
    FileLimitExceededError,
    FileUploadError,
    NotFoundError,
    PermissionError,
    TrainingNotFoundError,
    ValidationError,
    localizedErrorText,
} from '../error';
import type { CourseVideo, TrainingDoc } from '../interface';
import { PERM, PRIV } from '../model/builtin';
import { canManageCourse, courseAccessibleTo, courseUserGroupIds, isCourseHidden } from '../lib/course-access';
import { csvTable } from '../lib/course-video-csv';
import {
    COURSE_VIDEO_MAX_BYTES,
    COURSE_VIDEO_MAX_DURATION_MS,
    COURSE_VIDEO_MIN_DURATION_MS,
    courseVideoExtOf,
    courseVideoId,
    courseVideoStoragePath,
    findCourseVideo,
    hashFileSha256,
    listCourseVideos,
    mutateCourseVideos,
    parseHeartbeatCovered,
    parseRequireRewatch,
} from '../lib/course-video';
import * as oplog from '../model/oplog';
import {
    applyProgressHeartbeat,
    coverageRatio,
    loadCourseProgress,
    type CourseVideoProgressDoc,
} from '../model/course-video-progress';
import problem from '../model/problem';
import storage from '../model/storage';
import * as training from '../model/training';
import user from '../model/user';
import { Handler, param, Types } from '../service/server';
import { studentDirectory } from '../service/student-directory';
import { isCourseKind } from '../lib/training-kind';

const logger = new Logger('course-video');

async function loadCourse(domainId: string, tid: ObjectId): Promise<TrainingDoc> {
    const tdoc = await training.get(domainId, tid);
    if (!isCourseKind(tdoc.kind)) throw new NotFoundError(localizedErrorText`course`);
    return tdoc;
}

async function assertCanView(handler: Handler, domainId: string, tdoc: TrainingDoc) {
    const canManage = canManageCourse(handler.user, tdoc, PERM.PERM_EDIT_COURSE);
    if (canManage) return { canManage, myGroups: new Set<string>() };
    if (isCourseHidden(tdoc)) throw new ValidationError('tid', null, localizedErrorText`该课程已隐藏`);
    if ((tdoc.courseGroupIds || []).length) {
        const myGroups = await courseUserGroupIds(domainId, handler.user._id);
        if (!(await courseAccessibleTo(domainId, handler.user._id, tdoc, myGroups, false))) {
            throw new TrainingNotFoundError(domainId, tdoc.docId);
        }
        return { canManage, myGroups };
    }
    return { canManage, myGroups: new Set<string>() };
}

async function assertCanManage(handler: Handler, domainId: string, tdoc: TrainingDoc) {
    if (canManageCourse(handler.user, tdoc, PERM.PERM_EDIT_COURSE)) return;
    const myGroups = await courseUserGroupIds(domainId, handler.user._id);
    if (!(await courseAccessibleTo(domainId, handler.user._id, tdoc, myGroups, false))) {
        throw new TrainingNotFoundError(domainId, tdoc.docId);
    }
    throw new PermissionError(PERM.PERM_EDIT_COURSE);
}

function parseSectionId(raw: number): number | null {
    if (!raw) return null;
    if (!Number.isSafeInteger(raw) || raw < 1) throw new ValidationError('sectionId', null, localizedErrorText`小节 id 无效`);
    return raw;
}

function videoPublicView(video: CourseVideo) {
    return {
        id: video.id,
        title: video.title,
        filename: video.filename,
        ext: video.ext,
        size: video.size,
        durationMs: video.durationMs,
        confirmed: video.confirmed,
        contentRevision: video.contentRevision,
    };
}

class CourseVideoWriteHandler extends Handler {
    tdoc: TrainingDoc;
    domainId: string;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        this.domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, this.domainId);
        this.tdoc = await loadCourse(this.domainId, tid);
        await assertCanManage(this, this.domainId, this.tdoc);
    }

    @param('tid', Types.ObjectId)
    @param('chapterId', Types.PositiveInt)
    @param('sectionId', Types.Int, true)
    @param('title', Types.String, true)
    async postUpload(_domainId: string, tid: ObjectId, chapterId: number, sectionIdRaw = 0, title = '') {
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        if (file.size > COURSE_VIDEO_MAX_BYTES) throw new FileLimitExceededError('size');
        const original = file.originalFilename || 'video.mp4';
        const ext = courseVideoExtOf(String(original));
        const sha256 = await hashFileSha256(file.filepath);
        const id = courseVideoId();
        const contentRevision = 1;
        const fromFile = String(original).replace(/\.[^.]+$/, '').trim();
        const video: CourseVideo = {
            id,
            title: title.trim() || fromFile || '视频',
            filename: String(original),
            ext,
            size: file.size,
            sha256,
            durationMs: 0,
            confirmed: false,
            contentRevision,
        };
        const sectionId = parseSectionId(sectionIdRaw);
        const dag = mutateCourseVideos(this.tdoc.dag || [], chapterId, sectionId, (videos) => [...videos, video]);
        const target = courseVideoStoragePath(this.domainId, String(tid), id, contentRevision, ext);
        try {
            await storage.put(target, file.filepath, this.user._id);
            const meta = await storage.getMeta(target);
            if (!meta) throw new FileUploadError();
            await training.edit(this.domainId, tid, { dag });
        } catch (error) {
            logger.error('Course video upload failed domain=%s tid=%s video=%s error=%o', this.domainId, tid, id, error);
            await storage.del([target], this.user._id).catch((cleanupError) => {
                logger.error('Course video upload cleanup failed domain=%s path=%s error=%o', this.domainId, target, cleanupError);
            });
            throw error;
        }
        await oplog.log(this, 'course.video.upload', { tid, videoId: id, chapterId, sectionId, size: file.size });
        logger.info('Course video uploaded domain=%s tid=%s video=%s size=%d stage=upload result=success', this.domainId, tid, id, file.size);
        this.response.body = { video: videoPublicView(video), chapterId, sectionId };
    }

    @param('tid', Types.ObjectId)
    @param('videoId', Types.String)
    @param('durationMs', Types.PositiveInt)
    async postConfirm(_domainId: string, tid: ObjectId, videoId: string, durationMs: number) {
        if (durationMs < COURSE_VIDEO_MIN_DURATION_MS || durationMs > COURSE_VIDEO_MAX_DURATION_MS) {
            throw new ValidationError('durationMs', null, localizedErrorText`视频时长超出范围`);
        }
        const located = findCourseVideo(this.tdoc.dag || [], videoId);
        if (!located) throw new NotFoundError(localizedErrorText`video`);
        const dag = mutateCourseVideos(this.tdoc.dag || [], located.chapterId, located.sectionId, (videos) =>
            videos.map((item) => (item.id === videoId ? { ...item, durationMs, confirmed: true } : item)),
        );
        await training.edit(this.domainId, tid, { dag });
        await oplog.log(this, 'course.video.confirm', { tid, videoId, durationMs });
        this.response.body = { video: videoPublicView({ ...located.video, durationMs, confirmed: true }) };
    }

    @param('tid', Types.ObjectId)
    @param('videoId', Types.String)
    @param('title', Types.Title, true)
    async postReplace(_domainId: string, tid: ObjectId, videoId: string, title = '') {
        const requireRewatch = parseRequireRewatch(this.request.body?.requireRewatch);
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        if (file.size > COURSE_VIDEO_MAX_BYTES) throw new FileLimitExceededError('size');
        const located = findCourseVideo(this.tdoc.dag || [], videoId);
        if (!located) throw new NotFoundError(localizedErrorText`video`);
        const original = file.originalFilename || located.video.filename;
        const ext = courseVideoExtOf(String(original));
        const sha256 = await hashFileSha256(file.filepath);
        const contentRevision = requireRewatch ? located.video.contentRevision + 1 : located.video.contentRevision;
        const next: CourseVideo = {
            ...located.video,
            title: title.trim() || located.video.title,
            filename: String(original),
            ext,
            size: file.size,
            sha256,
            durationMs: 0,
            confirmed: false,
            contentRevision,
        };
        const target = courseVideoStoragePath(this.domainId, String(tid), videoId, contentRevision, ext);
        const previousPath = courseVideoStoragePath(
            this.domainId,
            String(tid),
            videoId,
            located.video.contentRevision,
            located.video.ext,
        );
        try {
            await storage.put(target, file.filepath, this.user._id);
            const meta = await storage.getMeta(target);
            if (!meta) throw new FileUploadError();
            const dag = mutateCourseVideos(this.tdoc.dag || [], located.chapterId, located.sectionId, (videos) =>
                videos.map((item) => (item.id === videoId ? next : item)),
            );
            await training.edit(this.domainId, tid, { dag });
            if (requireRewatch && previousPath !== target) {
                await storage.del([previousPath], this.user._id).catch((error) => {
                    logger.error('Course video replace leftover domain=%s path=%s error=%o', this.domainId, previousPath, error);
                });
            }
        } catch (error) {
            logger.error('Course video replace failed domain=%s tid=%s video=%s error=%o', this.domainId, tid, videoId, error);
            throw error;
        }
        await oplog.log(this, 'course.video.replace', { tid, videoId, requireRewatch, contentRevision, size: file.size });
        this.response.body = { video: videoPublicView(next), requireRewatch };
    }

    @param('tid', Types.ObjectId)
    @param('videoId', Types.String)
    async postDelete(_domainId: string, tid: ObjectId, videoId: string) {
        const located = findCourseVideo(this.tdoc.dag || [], videoId);
        if (!located) throw new NotFoundError(localizedErrorText`video`);
        const dag = mutateCourseVideos(this.tdoc.dag || [], located.chapterId, located.sectionId, (videos) =>
            videos.filter((item) => item.id !== videoId),
        );
        const path = courseVideoStoragePath(this.domainId, String(tid), videoId, located.video.contentRevision, located.video.ext);
        await training.edit(this.domainId, tid, { dag });
        await storage.del([path], this.user._id);
        await oplog.log(this, 'course.video.delete', { tid, videoId });
        this.response.body = { deleted: videoId };
    }

    @param('tid', Types.ObjectId)
    @param('chapterId', Types.PositiveInt)
    @param('sectionId', Types.Int, true)
    @param('videoIds', Types.CommaSeperatedArray)
    async postReorder(_domainId: string, tid: ObjectId, chapterId: number, sectionIdRaw = 0, videoIds: string[]) {
        const sectionId = parseSectionId(sectionIdRaw);
        const dag = mutateCourseVideos(this.tdoc.dag || [], chapterId, sectionId, (videos) => {
            if (videoIds.length !== videos.length || new Set(videoIds).size !== videos.length) {
                throw new ValidationError('videoIds', null, localizedErrorText`视频顺序必须包含全部现有视频`);
            }
            const byId = new Map(videos.map((item) => [item.id, item]));
            return videoIds.map((id) => {
                const item = byId.get(id);
                if (!item) throw new ValidationError('videoIds', null, localizedErrorText`视频顺序包含未知视频`);
                return item;
            });
        });
        await training.edit(this.domainId, tid, { dag });
        this.response.body = { ok: true };
    }
}

class CourseVideoPlayHandler extends Handler {
    noCheckPermView = true;
    notUsage = true;

    @param('tid', Types.ObjectId)
    @param('videoId', Types.String)
    async get(_domainId: string, tid: ObjectId, videoId: string) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, domainId);
        const tdoc = await loadCourse(domainId, tid);
        const { canManage } = await assertCanView(this, domainId, tdoc);
        const located = findCourseVideo(tdoc.dag || [], videoId);
        if (!located) throw new NotFoundError(localizedErrorText`video`);
        if (!located.video.confirmed && !canManage) throw new NotFoundError(localizedErrorText`video`);
        const target = courseVideoStoragePath(domainId, String(tid), videoId, located.video.contentRevision, located.video.ext);
        const meta = await storage.getMeta(target);
        if (!meta) throw new NotFoundError(localizedErrorText`video`);
        const size = Number(meta.size || located.video.size);
        if (!Number.isSafeInteger(size) || size <= 0) throw new NotFoundError(localizedErrorText`video`);
        let start = 0;
        let end = size - 1;
        const range = String(this.request.headers.range || '');
        if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match) {
                this.response.status = 416;
                this.response.addHeader('Content-Range', `bytes */${size}`);
                return;
            }
            start = match[1] ? Number(match[1]) : size - Number(match[2]);
            end = match[2] ? Number(match[2]) : size - 1;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end >= size || start > end) {
                this.response.status = 416;
                this.response.addHeader('Content-Range', `bytes */${size}`);
                return;
            }
            this.response.status = 206;
        }
        this.response.type = located.video.ext === 'webm' ? 'video/webm' : 'video/mp4';
        this.response.addHeader('Accept-Ranges', 'bytes');
        this.response.addHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        this.response.addHeader('Content-Length', String(end - start + 1));
        this.response.addHeader('Content-Disposition', 'inline');
        this.response.addHeader('X-Content-Type-Options', 'nosniff');
        this.response.addHeader('Cache-Control', 'private, no-store');
        try {
            this.response.body = await storage.getRange(target, start, end);
        } catch (error) {
            logger.error('Course video blob missing domain=%s tid=%s videoId=%s error=%o', domainId, tid, videoId, error);
            throw new NotFoundError(localizedErrorText`video`);
        }
    }
}

class CourseVideoProgressHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('videoId', Types.String)
    @param('contentRevision', Types.PositiveInt)
    @param('position', Types.Float)
    @param('playbackRate', Types.Float)
    @param('visible', Types.Boolean)
    @param('seekForwardAttempts', Types.UnsignedInt, true)
    async post(
        _domainId: string,
        tid: ObjectId,
        videoId: string,
        contentRevision: number,
        position: number,
        playbackRate: number,
        visible: boolean,
        seekForwardAttempts = 0,
    ) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, domainId);
        await this.limitRate('course_video_progress', 60, 30, '{{user}}');
        const tdoc = await loadCourse(domainId, tid);
        await assertCanView(this, domainId, tdoc);
        const located = findCourseVideo(tdoc.dag || [], videoId);
        if (!located || !located.video.confirmed) throw new NotFoundError(localizedErrorText`video`);
        if (located.video.contentRevision !== contentRevision) {
            throw new ValidationError('contentRevision', null, localizedErrorText`视频已更新，请刷新后重看`);
        }
        const student = await studentDirectory().findStudentByUserId(domainId, this.user._id);
        if (!student || !Number.isSafeInteger(student.boundUserId) || student.boundUserId < 2) {
            logger.warn('Course video progress rejected domain=%s tid=%s uid=%d video=%s reason=unbound', domainId, tid, this.user._id, videoId);
            throw new ValidationError('uid', null, localizedErrorText`未绑定学号，不能记录观看`);
        }
        let coveredRaw: unknown = this.request.body?.covered;
        if (coveredRaw === undefined || coveredRaw === null || coveredRaw === '') coveredRaw = null;
        else if (typeof coveredRaw === 'string') {
            try {
                coveredRaw = JSON.parse(coveredRaw);
            } catch {
                throw new ValidationError('covered', null, localizedErrorText`本拍覆盖区间无效`);
            }
        }
        const covered = coveredRaw == null ? null : parseHeartbeatCovered(coveredRaw);
        const doc = await applyProgressHeartbeat({
            domainId,
            courseId: tid,
            videoId,
            contentRevision,
            uid: this.user._id,
            durationMs: located.video.durationMs,
            heartbeat: {
                covered,
                position,
                playbackRate,
                seekForwardAttempts,
                visible,
            },
        });
        this.response.body = {
            coverageRatio: coverageRatio(doc.coverageMs, located.video.durationMs),
            completed: Boolean(doc.completedAt),
            lastPosition: doc.lastPosition,
            seekForwardAttempts: doc.seekForwardAttempts,
            maxRate: doc.maxRate,
        };
    }
}

function overdueLabel(completedAt: Date | undefined, dueAt: Date | undefined): string {
    if (!dueAt) return '';
    if (!completedAt) return Date.now() >= dueAt.getTime() ? '逾期未看完' : '';
    return completedAt.getTime() > dueAt.getTime() ? '逾期后看完' : '';
}

function videoStatus(doc: CourseVideoProgressDoc | undefined, dueAt?: Date) {
    if (!doc) return { status: '未看', coverageRatio: 0, maxRate: 1, seekForwardAttempts: 0, lastWatchedAt: '', completedAt: '', overdue: overdueLabel(undefined, dueAt) };
    const completed = Boolean(doc.completedAt);
    return {
        status: completed ? '已看完' : '进行中',
        coverageRatio: 0,
        maxRate: doc.maxRate,
        seekForwardAttempts: doc.seekForwardAttempts,
        lastWatchedAt: doc.lastWatchedAt.toISOString(),
        completedAt: doc.completedAt ? doc.completedAt.toISOString() : '',
        overdue: overdueLabel(doc.completedAt, dueAt),
        coverageMs: doc.coverageMs,
        lastPosition: doc.lastPosition,
    };
}

interface CourseVideoRoster {
    tdoc: { docId: ObjectId; title: string; courseVideoDueAt: Date | null };
    videos: Array<{ id: string; title: string; chapterId: number; sectionId: number | null; durationMs: number }>;
    rosterUnavailable?: 'no_groups';
    members: Array<{
        uid: number;
        studentId: string;
        realName: string;
        uname: string;
        done: number;
        total: number;
        videos: Array<{
            videoId: string;
            title: string;
            chapterId: number;
            sectionId: number | null;
            status: string;
            coverageRatio: number;
            maxRate: number;
            seekForwardAttempts: number;
            lastWatchedAt: string;
            completedAt: string;
            overdue: string;
        }>;
    }>;
}

async function buildCourseVideoRoster(handler: Handler, domainId: string, tid: ObjectId): Promise<CourseVideoRoster> {
    const tdoc = await loadCourse(domainId, tid);
    await assertCanManage(handler, domainId, tdoc);
    const groups = tdoc.courseGroupIds || [];
    if (!groups.length) {
        return {
            tdoc: { docId: tdoc.docId, title: tdoc.title, courseVideoDueAt: tdoc.courseVideoDueAt || null },
            videos: [],
            members: [],
            rosterUnavailable: 'no_groups',
        };
    }
    const bound = await studentDirectory().findBoundStudentsByGroupIds(
        domainId,
        groups.map((id) => (id instanceof ObjectId ? id : new ObjectId(String(id)))),
    );
    const seen = new Set<number>();
    const membersSource: Array<{ uid: number; studentId: string; realName: string }> = [];
    for (const row of bound as Array<{ boundUserId?: number; studentId?: string; realName?: string }>) {
        const uid = Number(row.boundUserId);
        if (!Number.isSafeInteger(uid) || uid < 2 || seen.has(uid)) continue;
        seen.add(uid);
        membersSource.push({ uid, studentId: row.studentId || '', realName: row.realName || '' });
    }
    const confirmed = listCourseVideos(tdoc.dag || []).filter((item) => item.video.confirmed);
    const progress = await loadCourseProgress(domainId, tid, membersSource.map((row) => row.uid));
    const progressMap = new Map(progress.map((doc) => [`${doc.uid}:${doc.videoId}:${doc.contentRevision}`, doc]));
    const udict = await user.getListForRender(domainId, membersSource.map((row) => row.uid), false);
    const dueAt = tdoc.courseVideoDueAt;
    return {
        tdoc: { docId: tdoc.docId, title: tdoc.title, courseVideoDueAt: dueAt || null },
        videos: confirmed.map((item) => ({
            id: item.video.id,
            title: item.video.title,
            chapterId: item.chapterId,
            sectionId: item.sectionId,
            durationMs: item.video.durationMs,
        })),
        members: membersSource.map((row) => {
            const videos = confirmed.map((item) => {
                const doc = progressMap.get(`${row.uid}:${item.video.id}:${item.video.contentRevision}`);
                const status = videoStatus(doc, dueAt);
                return {
                    videoId: item.video.id,
                    title: item.video.title,
                    chapterId: item.chapterId,
                    sectionId: item.sectionId,
                    ...status,
                    coverageRatio: item.video.durationMs ? coverageRatio(doc?.coverageMs || 0, item.video.durationMs) : 0,
                };
            });
            return {
                uid: row.uid,
                studentId: row.studentId,
                realName: row.realName,
                uname: udict[row.uid]?.uname || `UID ${row.uid}`,
                done: videos.filter((item) => item.status === '已看完').length,
                total: videos.length,
                videos,
            };
        }),
    };
}

class CourseVideoStatsHandler extends Handler {
    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, domainId);
        this.response.template = 'course_videos.html';
        this.response.body = await buildCourseVideoRoster(this, domainId, tid);
    }
}

class CourseVideoCsvHandler extends Handler {
    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, domainId);
        const body = await buildCourseVideoRoster(this, domainId, tid);
        if (body.rosterUnavailable === 'no_groups') {
            throw new ValidationError('courseGroupIds', null, localizedErrorText`未指定班级，无法出观看名单`);
        }
        const headers = ['学号', '姓名'];
        for (const video of body.videos) {
            headers.push(
                `${video.title}-状态`,
                `${video.title}-覆盖`,
                `${video.title}-最高倍速`,
                `${video.title}-向前拖`,
                `${video.title}-最后观看`,
                `${video.title}-逾期`,
            );
        }
        const rows = body.members.map((member) => {
            const cells: Array<string | number> = [member.studentId, member.realName];
            for (const video of member.videos) {
                cells.push(
                    video.status,
                    Math.round(video.coverageRatio * 1000) / 10,
                    video.maxRate,
                    video.seekForwardAttempts,
                    video.lastWatchedAt,
                    video.overdue,
                );
            }
            return cells;
        });
        this.response.type = 'text/csv';
        this.response.disposition = `attachment; filename="course-videos-${tid}.csv"`;
        this.response.body = csvTable(headers, rows);
    }
}

export async function apply(ctx) {
    ctx.Route('course_video_upload', '/course/:tid/video', CourseVideoWriteHandler);
    ctx.Route('course_video_play', '/course/:tid/video/:videoId/play', CourseVideoPlayHandler);
    ctx.Route('course_video_progress', '/course/:tid/video/:videoId/progress', CourseVideoProgressHandler);
    ctx.Route('course_videos', '/course/:tid/videos', CourseVideoStatsHandler);
    ctx.Route('course_videos_csv', '/course/:tid/videos.csv', CourseVideoCsvHandler);
}
