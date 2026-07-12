import yaml from 'js-yaml';
import { escapeRegExp, pick } from 'lodash';
import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { sortFiles, Time } from '@hydrooj/utils/lib/utils';
import {
    ContestNotFoundError,
    FileLimitExceededError,
    FileUploadError,
    HomeworkNotLiveError,
    NotAssignedError,
    PermissionError,
    ValidationError,
} from '../error';
import { PenaltyRules, Tdoc, TrainingDoc, TrainingNode } from '../interface';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import * as discussion from '../model/discussion';
import {
    assertHomeworkAccess,
    buildHomeworkListAccessFilter,
    canBypassHomeworkAccess,
    getHomeworkUserGroupIds,
    participantGroupObjectIds,
} from '../model/homework-access';
import problem from '../model/problem';
import { assertProblemBankSelection } from '../model/problem-access';
import record from '../model/record';
import storage from '../model/storage';
import system from '../model/system';
import * as training from '../model/training';
import user from '../model/user';
import { Handler, param, post, Types } from '../service/server';
import { ContestCodeHandler, ContestFileDownloadHandler, ContestScoreboardHandler } from './contest';

const logger = new Logger('homework');

async function listHomeworkScopeGroups(domainId: string, required: boolean): Promise<any[]> {
    const userbind = (global as any).Hydro?.model?.userbind;
    if (typeof userbind?.listUserGroups !== 'function') {
        if (required) throw new TypeError('userbind.listUserGroups is unavailable');
        return [];
    }
    try {
        return await userbind.listUserGroups(domainId);
    } catch (error) {
        logger.error('Homework group catalog lookup failed domain=%s error=%o', domainId, error);
        throw error;
    }
}

function normalizeParticipantGroups(
    mode: 'none' | 'groups',
    rawGroupIds: string[],
): { participantScopeMode: 'none' | 'groups'; participantGroupIds: ObjectId[] } {
    if (mode === 'none') return { participantScopeMode: 'none', participantGroupIds: [] };
    if (!rawGroupIds.length) throw new ValidationError('participantGroupIds');
    try {
        return {
            participantScopeMode: 'groups',
            participantGroupIds: Array.from(new Set(rawGroupIds.map((groupId) => groupId.trim()))).map((groupId) => new ObjectId(groupId)),
        };
    } catch {
        throw new ValidationError('participantGroupIds');
    }
}

async function loadCourseQuizContext(
    domainId: string,
    courseId: ObjectId,
    chapterId: number,
    handlerUser: any,
): Promise<{ course: TrainingDoc; chapter: TrainingNode }> {
    const course = await training.get(domainId, courseId);
    if (course.kind !== 'course') throw new ValidationError('fromCourse');
    if (!handlerUser.own(course) && !handlerUser.hasPerm(PERM.PERM_EDIT_COURSE) && !handlerUser.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
        throw new PermissionError(PERM.PERM_EDIT_COURSE);
    }
    const chapter = course.dag.find((node) => node._id === chapterId);
    if (!chapter) throw new ValidationError('chapter');
    return { course, chapter };
}

function parseProblemDocIds(input: string) {
    const tokens = input
        .replace(/，/g, ',')
        .split(',')
        .map((i) => i.trim())
        .filter(Boolean);
    const pids = tokens.map((i) => Number(i));
    if (!pids.every((i) => Number.isSafeInteger(i) && i > 0)) throw new ValidationError('pids');
    return pids;
}

const validatePenaltyRules = (input: string) => {
    try {
        const res = yaml.load(input);
        return typeof res === 'object' && res !== null && Object.keys(res).every((key) => typeof res[key] === 'number');
    } catch (e) {
        return false;
    }
};
const convertPenaltyRules = (input: string) => yaml.load(input);

class HomeworkMainHandler extends Handler {
    @param('group', Types.Name, true)
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(_domainId: string, group = '', page = 1, q = '') {
        const authoritativeDomainId = String(this.domain?._id);
        const canBypass = canBypassHomeworkAccess(this.user);
        const groups = (await user.listGroup(authoritativeDomainId, canBypass ? undefined : this.user._id)).map((i) => i.name);
        if (group && !groups.includes(group)) throw new NotAssignedError(group);
        const participantGroups = canBypass ? [] : participantGroupObjectIds(await getHomeworkUserGroupIds(authoritativeDomainId, this.user._id));
        const escaped = escapeRegExp(q.toLowerCase());
        const cursor = contest
            .getMulti(authoritativeDomainId, {
                rule: 'homework',
                ...(canBypass ? {} : buildHomeworkListAccessFilter(this.user._id, groups, participantGroups)),
                ...(group ? { assign: { $in: [group] } } : {}),
                ...(q ? { title: { $regex: new RegExp(q.length >= 2 ? escaped : `^${escaped}`, 'i') } } : {}),
            })
            .sort({
                penaltySince: -1,
                endAt: -1,
                beginAt: -1,
                _id: -1,
            });
        const [tdocs, tpcount] = await this.paginate(cursor, page, 'contest');
        const calendar = [];
        for (const tdoc of tdocs) {
            const cal = { ...tdoc, url: this.url('homework_detail', { tid: tdoc.docId }) };
            if (contest.isExtended(tdoc) || contest.isDone(tdoc)) {
                cal.endAt = tdoc.endAt;
                cal.penaltySince = tdoc.penaltySince;
            } else cal.endAt = tdoc.penaltySince;
            calendar.push(cal);
        }
        let qs = group ? `group=${group}` : '';
        if (q) qs += `${qs ? '&' : ''}q=${encodeURIComponent(q)}`;
        const groupsFilter = groups.filter((i) => !Number.isSafeInteger(+i));
        this.response.body = {
            tdocs,
            calendar,
            tpcount,
            page,
            qs,
            groups: groupsFilter,
            group,
            q,
        };
        this.response.template = 'homework_main.html';
    }
}

class HomeworkDetailHandler extends Handler {
    tdoc: Tdoc;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        if (this.tdoc.rule !== 'homework') throw new ContestNotFoundError(authoritativeDomainId, tid);
        await assertHomeworkAccess(authoritativeDomainId, this.tdoc, this.user);
    }

    @param('tid', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, tid: ObjectId, page = 1) {
        const authoritativeDomainId = String(this.domain?._id);
        const tsdoc = await contest.getStatus(authoritativeDomainId, tid, this.user._id);
        if (this.tdoc.rule !== 'homework') throw new ContestNotFoundError(authoritativeDomainId, tid);
        // discussion
        const [ddocs, dpcount, dcount] = await this.paginate(
            discussion.getMulti(authoritativeDomainId, { parentType: this.tdoc.docType, parentId: this.tdoc.docId }),
            page,
            'discussion',
        );
        const uids = ddocs.map((ddoc) => ddoc.owner);
        uids.push(this.tdoc.owner);
        const udict = await user.getList(authoritativeDomainId, uids);
        this.response.template = 'homework_detail.html';
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc,
            udict,
            ddocs,
            page,
            dpcount,
            dcount,
            canGradeSubjective: this.tdoc.owner === this.user._id || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
        };
        this.response.body.tdoc.content = this.response.body.tdoc.content
            .replace(/\(file:\/\//g, `(./${this.tdoc.docId}/file/public/`)
            .replace(/="file:\/\//g, `="./${this.tdoc.docId}/file/public/`);
        if (
            (contest.isNotStarted(this.tdoc) || (!tsdoc?.attend && !contest.isDone(this.tdoc))) &&
            !this.user.own(this.tdoc) &&
            !this.user.hasPerm(PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD)
        ) {
            return;
        }
        const pdict = await problem.getList(authoritativeDomainId, this.tdoc.pids, true, true, problem.PROJECTION_CONTEST_LIST);
        const psdict = {};
        let rdict = {};
        if (tsdoc) {
            if (tsdoc.attend && !tsdoc.startAt && contest.isOngoing(this.tdoc)) {
                await contest.setStatus(authoritativeDomainId, tid, this.user._id, { startAt: new Date() });
                tsdoc.startAt = new Date();
            }
            const valid = (tsdoc.journal || []).filter((p) => this.tdoc.pids.includes(p.pid));
            for (const pdetail of valid) {
                psdict[pdetail.pid] = pdetail;
                rdict[pdetail.rid] = { _id: pdetail.rid };
            }
            if (contest.canShowSelfRecord.call(this, this.tdoc) && valid.length) {
                rdict = await record.getList(
                    authoritativeDomainId,
                    valid.map((pdetail) => pdetail.rid),
                );
            }
        }
        Object.assign(this.response.body, { pdict, psdict, rdict });
    }

    async postAttend(_args: { domainId?: string }) {
        const authoritativeDomainId = String(this.domain?._id);
        this.checkPerm(PERM.PERM_ATTEND_HOMEWORK);
        if (contest.isDone(this.tdoc)) throw new HomeworkNotLiveError(this.tdoc.docId);
        await contest.attend(authoritativeDomainId, this.tdoc.docId, this.user._id);
        this.back();
    }
}

class HomeworkEditHandler extends Handler {
    @param('tid', Types.ObjectId, true)
    @param('fromCourse', Types.ObjectId, true)
    @param('chapter', Types.PositiveInt, true)
    async get(_domainId: string, tid: ObjectId, fromCourse: ObjectId | undefined, chapter = 0) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (tid && (fromCourse || chapter)) throw new ValidationError('fromCourse', 'chapter');
        const tdoc = tid ? await contest.get(authoritativeDomainId, tid) : null;
        if (!tid) this.checkPerm(PERM.PERM_CREATE_HOMEWORK);
        else if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_HOMEWORK);
        else this.checkPerm(PERM.PERM_EDIT_HOMEWORK_SELF);
        const extensionDays = tid ? Math.round((tdoc.endAt.getTime() - tdoc.penaltySince.getTime()) / (Time.day / 100)) / 100 : 1;
        const beginAt = tid
            ? moment(tdoc.beginAt).tz(this.user.timeZone)
            : moment().add(1, 'day').tz(this.user.timeZone).hour(0).minute(0).millisecond(0);
        const penaltySince = tid
            ? moment(tdoc.penaltySince).tz(this.user.timeZone)
            : beginAt.clone().add(7, 'days').tz(this.user.timeZone).hour(23).minute(59).millisecond(0);
        const quizContext = fromCourse ? await loadCourseQuizContext(authoritativeDomainId, fromCourse, chapter, this.user) : null;
        if (!fromCourse && chapter) throw new ValidationError('chapter');
        const courseGroupIds = (quizContext?.course.courseGroupIds || []).map(String);
        const participantScopeMode = quizContext
            ? courseGroupIds.length
                ? 'groups'
                : 'none'
            : tdoc?.participantScopeMode === 'groups'
              ? 'groups'
              : 'none';
        const participantGroupIds = quizContext ? courseGroupIds : (tdoc?.participantGroupIds || []).map(String);
        const scopeGroups = await listHomeworkScopeGroups(authoritativeDomainId, !!quizContext || participantScopeMode === 'groups');
        const formDoc =
            tdoc ||
            (quizContext
                ? {
                      title: `${quizContext.course.title} · ${quizContext.chapter.title}`,
                      content: '',
                      assign: [],
                      maintainer: [],
                      langs: [],
                      rated: false,
                      participantScopeMode,
                      participantGroupIds,
                  }
                : null);
        this.response.template = 'homework_edit.html';
        this.response.body = {
            tdoc: formDoc,
            dateBeginText: beginAt.format('YYYY-M-D'),
            timeBeginText: beginAt.format('H:mm'),
            datePenaltyText: penaltySince.format('YYYY-M-D'),
            timePenaltyText: penaltySince.format('H:mm'),
            extensionDays,
            penaltyRules: tid ? yaml.dump(tdoc.penaltyRules) : null,
            pids: tid ? tdoc.pids.join(',') : '',
            page_name: tid ? 'homework_edit' : 'homework_create',
            participantScopeMode,
            participantGroupIds,
            scopeGroups: scopeGroups.map((scopeGroup: any) => ({
                _id: String(scopeGroup._id),
                name: scopeGroup.name,
                archivedAt: scopeGroup.archivedAt || null,
            })),
            fromCourse: fromCourse ? String(fromCourse) : '',
            chapter: chapter || '',
            courseContext: quizContext
                ? {
                      courseTitle: quizContext.course.title,
                      chapterTitle: quizContext.chapter.title,
                  }
                : null,
        };
    }

    @param('tid', Types.ObjectId, true)
    @param('beginAtDate', Types.Date)
    @param('beginAtTime', Types.Time)
    @param('penaltySinceDate', Types.Date)
    @param('penaltySinceTime', Types.Time)
    @param('extensionDays', Types.Float)
    @param('penaltyRules', Types.Content, validatePenaltyRules, convertPenaltyRules)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('pids', Types.Content)
    @param('rated', Types.Boolean)
    @param('maintainer', Types.NumericArray, true)
    @param('assign', Types.CommaSeperatedArray, true)
    @param('langs', Types.CommaSeperatedArray, true)
    @param('participantScopeMode', Types.Range(['none', 'groups']), true)
    @param('participantGroupIds', Types.CommaSeperatedArray, true)
    @param('fromCourse', Types.ObjectId, true)
    @param('chapter', Types.PositiveInt, true)
    async postUpdate(
        _domainId: string,
        tid: ObjectId,
        beginAtDate: string,
        beginAtTime: string,
        penaltySinceDate: string,
        penaltySinceTime: string,
        extensionDays: number,
        penaltyRules: PenaltyRules,
        title: string,
        content: string,
        _pids: string,
        rated = false,
        maintainer: number[] = [],
        assign: string[] = [],
        langs: string[] = [],
        participantScopeMode: 'none' | 'groups' = 'none',
        participantGroupIds: string[] = [],
        fromCourse: ObjectId | undefined,
        chapter = 0,
    ) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const pids = parseProblemDocIds(_pids);
        const tdoc = tid ? await contest.get(authoritativeDomainId, tid) : null;
        if (tid && (fromCourse || chapter)) throw new ValidationError('fromCourse', 'chapter');
        if (!tid) this.checkPerm(PERM.PERM_CREATE_HOMEWORK);
        else if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_HOMEWORK);
        else this.checkPerm(PERM.PERM_EDIT_HOMEWORK_SELF);
        const beginAt = moment.tz(`${beginAtDate} ${beginAtTime}`, this.user.timeZone);
        if (!beginAt.isValid()) throw new ValidationError('beginAtDate', 'beginAtTime');
        const penaltySince = moment.tz(`${penaltySinceDate} ${penaltySinceTime}`, this.user.timeZone);
        if (!penaltySince.isValid()) throw new ValidationError('endAtDate', 'endAtTime');
        const endAt = penaltySince.clone().add(extensionDays, 'days');
        if (beginAt.isSameOrAfter(penaltySince)) throw new ValidationError('endAtDate', 'endAtTime');
        if (penaltySince.isAfter(endAt)) throw new ValidationError('extensionDays');
        await assertProblemBankSelection(authoritativeDomainId, pids, this.user, tdoc?.pids);
        const quizContext = fromCourse ? await loadCourseQuizContext(authoritativeDomainId, fromCourse, chapter, this.user) : null;
        if (!fromCourse && chapter) throw new ValidationError('chapter');
        const participantScope = quizContext
            ? {
                  participantScopeMode: quizContext.course.courseGroupIds?.length ? ('groups' as const) : ('none' as const),
                  participantGroupIds: quizContext.course.courseGroupIds || [],
              }
            : normalizeParticipantGroups(participantScopeMode, participantGroupIds);
        if (!tid) {
            tid = await contest.add(authoritativeDomainId, title, content, this.user._id, 'homework', beginAt.toDate(), endAt.toDate(), pids, rated, {
                penaltySince: penaltySince.toDate(),
                penaltyRules,
                assign,
                ...participantScope,
            });
            if (quizContext) {
                try {
                    const attached = await training.attachContestToCourseChapter(authoritativeDomainId, fromCourse!, chapter, tid);
                    if (!attached) throw new ValidationError('fromCourse', 'chapter');
                } catch (error) {
                    logger.error(
                        'Course quiz attach failed; deleting orphan domain=%s course=%s chapter=%d homework=%s error=%o',
                        authoritativeDomainId,
                        fromCourse,
                        chapter,
                        tid,
                        error,
                    );
                    try {
                        await contest.del(authoritativeDomainId, tid);
                    } catch (cleanupError) {
                        logger.error(
                            'Course quiz orphan cleanup failed domain=%s homework=%s error=%o cleanupError=%o',
                            authoritativeDomainId,
                            tid,
                            error,
                            cleanupError,
                        );
                        throw new Error(`course quiz attach and orphan cleanup failed: ${tid}`, {
                            cause: cleanupError,
                        });
                    }
                    throw error;
                }
            }
        } else {
            await contest.edit(authoritativeDomainId, tid, {
                title,
                content,
                beginAt: beginAt.toDate(),
                endAt: endAt.toDate(),
                pids,
                penaltySince: penaltySince.toDate(),
                penaltyRules,
                rated,
                maintainer,
                assign,
                langs,
                ...participantScope,
            });
            if (
                tdoc.beginAt !== beginAt.toDate() ||
                tdoc.endAt !== endAt.toDate() ||
                tdoc.penaltySince !== penaltySince.toDate() ||
                tdoc.pids.sort().join(' ') !== pids.sort().join(' ')
            ) {
                await contest.recalcStatus(authoritativeDomainId, tdoc.docId);
            }
        }
        this.response.body = { tid };
        this.response.redirect = quizContext
            ? `${this.url('course_detail', { tid: fromCourse })}?chapter=${chapter}`
            : this.url('homework_detail', { tid });
    }

    @param('tid', Types.ObjectId)
    async postDelete(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        const tdoc = await contest.get(authoritativeDomainId, tid);
        if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_HOMEWORK);
        await Promise.all([
            record.updateMulti(authoritativeDomainId, { domainId: authoritativeDomainId, contest: tid }, undefined, undefined, { contest: '' }),
            contest.del(authoritativeDomainId, tid),
            storage.del(tdoc.files?.map((i) => `contest/${authoritativeDomainId}/${tid}/public/${i.name}`) || [], this.user._id),
        ]);
        this.response.redirect = this.url('homework_main');
    }
}

export class HomeworkFilesHandler extends Handler {
    tdoc: Tdoc;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_HOMEWORK);
        else this.checkPerm(PERM.PERM_EDIT_HOMEWORK_SELF);
    }

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_HOMEWORK);
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: await contest.getStatus(authoritativeDomainId, this.tdoc.docId, this.user._id),
            udoc: await user.getById(authoritativeDomainId, this.tdoc.owner),
            files: sortFiles(this.tdoc.files || []),
            urlForFile: (filename: string) => this.url('homework_file_download', { tid, filename, type: 'public' }),
        };
        this.response.pjax = 'partials/files.html';
        this.response.template = 'homework_files.html';
    }

    @param('tid', Types.ObjectId)
    @post('filename', Types.Filename, true)
    async postUploadFile(_domainId: string, tid: ObjectId, filename: string) {
        const authoritativeDomainId = String(this.domain?._id);
        if ((this.tdoc.files?.length || 0) >= system.get('limit.contest_files')) {
            throw new FileLimitExceededError('count');
        }
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        const size = Math.sum((this.tdoc.files || []).map((i) => i.size)) + file.size;
        if (size >= system.get('limit.contest_files_size')) {
            throw new FileLimitExceededError('size');
        }
        await storage.put(`contest/${authoritativeDomainId}/${tid}/public/${filename}`, file.filepath, this.user._id);
        const meta = await storage.getMeta(`contest/${authoritativeDomainId}/${tid}/public/${filename}`);
        const payload = { _id: filename, name: filename, ...pick(meta, ['size', 'lastModified', 'etag']) };
        if (!meta) throw new FileUploadError();
        await contest.edit(authoritativeDomainId, tid, { files: [...(this.tdoc.files || []), payload] });
        this.back();
    }

    @param('tid', Types.ObjectId)
    @post('files', Types.ArrayOf(Types.Filename))
    async postDeleteFiles(_domainId: string, tid: ObjectId, files: string[]) {
        const authoritativeDomainId = String(this.domain?._id);
        await Promise.all([
            storage.del(
                files.map((t) => `contest/${authoritativeDomainId}/${tid}/public/${t}`),
                this.user._id,
            ),
            contest.edit(authoritativeDomainId, tid, { files: this.tdoc.files.filter((i) => !files.includes(i.name)) }),
        ]);
        this.back();
    }
}

export async function apply(ctx) {
    ctx.Route('homework_main', '/homework', HomeworkMainHandler, PERM.PERM_VIEW_HOMEWORK);
    ctx.Route('homework_create', '/homework/create', HomeworkEditHandler);
    ctx.Route('homework_detail', '/homework/:tid', HomeworkDetailHandler, PERM.PERM_VIEW_HOMEWORK);
    ctx.Route('homework_code', '/homework/:tid/code', ContestCodeHandler, PERM.PERM_VIEW_HOMEWORK);
    ctx.Route('homework_edit', '/homework/:tid/edit', HomeworkEditHandler);
    ctx.Route('homework_files', '/homework/:tid/file', HomeworkFilesHandler, PERM.PERM_VIEW_HOMEWORK);
    ctx.Route('homework_file_download', '/homework/:tid/file/:type/:filename', ContestFileDownloadHandler, PERM.PERM_VIEW_HOMEWORK);
    await ctx.inject(['scoreboard'], ({ Route }) => {
        Route('homework_scoreboard', '/homework/:tid/scoreboard', ContestScoreboardHandler, PERM.PERM_VIEW_HOMEWORK_SCOREBOARD);
        Route('homework_scoreboard_view', '/homework/:tid/scoreboard/:view', ContestScoreboardHandler, PERM.PERM_VIEW_HOMEWORK_SCOREBOARD);
    });
}
