import { lookup } from 'mime-types';
import { ObjectId } from 'mongodb';
import { sortFiles } from '@hydrooj/utils/lib/utils';
import {
    FileUploadError,
    localizedErrorText,
    NotFoundError,
    PermissionError,
    ValidationError,
} from '../error';
import { PERM, PRIV } from '../model/builtin';
import * as oplog from '../model/oplog';
import storage, { encodeRFC5987ValueChars } from '../model/storage';
import system from '../model/system';
import * as training from '../model/training';
import { Handler, param, post, Types } from '../service/server';
import { assertCourseAccessible, canManageCourse, isCourseHidden } from '../lib/course-access';
import {
    assertCourseFileRoom,
    chapterFileStoragePath,
    isPptxFilename,
} from '../lib/course-chapter-file';
import { isCourseKind } from '../lib/training-kind';
import type { FileInfo } from '@hydrooj/common/types';
import type { TrainingDoc, TrainingNode } from '../interface';

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function courseFileLimits() {
    return {
        count: system.get('limit.contest_files'),
        size: system.get('limit.contest_files_size'),
    };
}

function chapterNode(tdoc: TrainingDoc, chapterId: number): TrainingNode {
    const node = (tdoc.dag || []).find((item) => item._id === chapterId);
    if (!node) throw new ValidationError('chapter', null, localizedErrorText`章节不存在`);
    return node;
}

function replaceChapterFiles(dag: TrainingNode[] | undefined, chapterId: number, files: FileInfo[]): TrainingNode[] {
    return (dag || []).map((node) => {
        if (node._id !== chapterId) return node;
        if (!files.length) {
            const next = { ...node };
            delete next.files;
            return next;
        }
        return { ...node, files: sortFiles(files) };
    });
}

async function assertCanReadCourseFile(handler: Handler, domainId: string, tdoc: TrainingDoc) {
    handler.checkPriv(PRIV.PRIV_USER_PROFILE);
    if (!canManageCourse(handler.user, tdoc, PERM.PERM_EDIT_COURSE)) {
        if (isCourseHidden(tdoc)) throw new ValidationError('tid', null, localizedErrorText`该课程已隐藏`);
        await assertCourseAccessible(domainId, handler.user._id, tdoc);
    }
}

class CourseChapterFilesHandler extends Handler {
    tdoc: TrainingDoc;
    domainId: string;

    @param('tid', Types.ObjectId)
    @param('chapterId', Types.PositiveInt)
    async prepare(_domainId: string, tid: ObjectId, _chapterId: number) {
        this.domainId = String(this.domain?._id);
        this.tdoc = await training.get(this.domainId, tid);
        if (!isCourseKind(this.tdoc.kind)) throw new NotFoundError(localizedErrorText`course`);
        if (!canManageCourse(this.user, this.tdoc, PERM.PERM_EDIT_COURSE)) {
            await assertCourseAccessible(this.domainId, this.user._id, this.tdoc);
            throw new PermissionError(PERM.PERM_EDIT_COURSE);
        }
    }

    @param('chapterId', Types.PositiveInt)
    async get(_domainId: string, _tid: ObjectId, chapterId: number) {
        const node = chapterNode(this.tdoc, chapterId);
        this.response.body = { files: sortFiles(node.files || []) };
    }

    @param('tid', Types.ObjectId)
    @param('chapterId', Types.PositiveInt)
    @post('filename', Types.Filename)
    async postUploadFile(_domainId: string, tid: ObjectId, chapterId: number, filename: string) {
        const node = chapterNode(this.tdoc, chapterId);
        const current = node.files || [];
        const previous = current.find((item) => item.name === filename);
        const upload = this.request.files?.file;
        if (!upload) throw new ValidationError('file');
        assertCourseFileRoom(this.tdoc.files, this.tdoc.dag, {
            size: upload.size,
            replacing: Boolean(previous),
            replacedSize: previous?.size || 0,
        }, courseFileLimits());
        const target = chapterFileStoragePath(this.domainId, String(tid), chapterId, filename);
        await storage.put(target, upload.filepath, this.user._id);
        const meta = await storage.getMeta(target);
        if (!meta) throw new FileUploadError();
        const payload: FileInfo = {
            _id: filename,
            name: filename,
            ...pickFileMeta(meta),
        };
        const files = current.filter((item) => item.name !== filename).concat(payload);
        const dag = replaceChapterFiles(this.tdoc.dag, chapterId, files);
        await training.edit(this.domainId, tid, { dag });
        await oplog.log(this, 'course.chapter.file.upload', { tid, chapterId, filename, size: payload.size });
        this.response.body = { file: payload };
    }

    @param('tid', Types.ObjectId)
    @param('chapterId', Types.PositiveInt)
    @post('files', Types.ArrayOf(Types.Filename))
    async postDeleteFiles(_domainId: string, tid: ObjectId, chapterId: number, files: string[]) {
        const node = chapterNode(this.tdoc, chapterId);
        const current = node.files || [];
        for (const filename of files) {
            if (!current.some((item) => item.name === filename)) throw new NotFoundError(localizedErrorText`file`);
        }
        await storage.del(
            files.map((filename) => chapterFileStoragePath(this.domainId, String(tid), chapterId, filename)),
            this.user._id,
        );
        const dag = replaceChapterFiles(
            this.tdoc.dag,
            chapterId,
            current.filter((item) => !files.includes(item.name)),
        );
        await training.edit(this.domainId, tid, { dag });
        await oplog.log(this, 'course.chapter.file.delete', { tid, chapterId, files });
        this.response.body = { deleted: files };
    }
}

class CourseChapterFileDownloadHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('chapterId', Types.PositiveInt)
    @param('filename', Types.Filename)
    @param('preview', Types.Boolean, true)
    async get(_domainId: string, tid: ObjectId, chapterId: number, filename: string, preview = false) {
        const domainId = String(this.domain?._id);
        const tdoc = await training.get(domainId, tid);
        if (!isCourseKind(tdoc.kind)) throw new NotFoundError(localizedErrorText`course`);
        await assertCanReadCourseFile(this, domainId, tdoc);
        const node = chapterNode(tdoc, chapterId);
        const file = (node.files || []).find((item) => item.name === filename);
        if (!file) throw new NotFoundError(localizedErrorText`file`);
        const target = chapterFileStoragePath(domainId, String(tid), chapterId, filename);
        await oplog.log(this, preview ? 'course.chapter.file.preview' : 'course.chapter.file.download', {
            tid, chapterId, filename, size: file.size || 0,
        });
        if (preview) {
            if (!isPptxFilename(filename)) {
                throw new ValidationError('filename', null, localizedErrorText`这种文件只能下载。`);
            }
            await sendInlineFile(this, target, filename);
            return;
        }
        this.response.addHeader('Cache-Control', 'private');
        this.response.redirect = await storage.signDownloadLink(target, filename, false, 'user');
    }
}

function pickFileMeta(meta: { size?: number; lastModified?: Date; etag?: string }): Pick<FileInfo, 'size' | 'lastModified' | 'etag'> {
    return {
        size: meta.size || 0,
        lastModified: meta.lastModified instanceof Date ? meta.lastModified : new Date(),
        etag: typeof meta.etag === 'string' ? meta.etag : '',
    };
}

async function sendInlineFile(handler: Handler, target: string, filename: string) {
    let body: unknown;
    try {
        body = await storage.get(target);
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('Invalid path') || message.startsWith('File not found:')) {
            throw new NotFoundError(localizedErrorText`file`);
        }
        throw error;
    }
    const lookedUp = lookup(filename);
    handler.response.body = body;
    handler.response.type = typeof lookedUp === 'string' ? lookedUp : PPTX_TYPE;
    handler.response.disposition = `inline; filename="${encodeRFC5987ValueChars(filename)}"`;
    handler.response.addHeader('X-Content-Type-Options', 'nosniff');
    handler.response.addHeader('Cache-Control', 'private');
}

export function registerCourseChapterFileRoutes(ctx: { Route: (name: string, path: string, handler: unknown) => void }) {
    ctx.Route('course_chapter_files', '/course/:tid/chapter/:chapterId/file', CourseChapterFilesHandler);
    ctx.Route('course_chapter_file_download', '/course/:tid/chapter/:chapterId/file/:filename', CourseChapterFileDownloadHandler);
}

export { sendInlineFile, PPTX_TYPE };
