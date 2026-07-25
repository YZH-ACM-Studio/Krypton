import { omit, pick, throttle, uniqBy } from 'lodash';
import { normalizeSubtasks } from '@hydrooj/common';
import { readYamlCases } from '@hydrooj/common/cases';
import { load as loadYaml } from 'js-yaml';
import { Filter, ObjectId } from 'mongodb';
import {
    ContestNotFoundError,
    HackRejudgeFailedError,
    PermissionError,
    PretestRejudgeFailedError,
    ProblemConfigError,
    ProblemNotFoundError,
    RecordNotFoundError,
    UserNotFoundError,
    ValidationError,
} from '../error';
import { RecordDoc, Tdoc } from '../interface';
import { canAccessPostContestPracticeRecord, canUsePostContestPractice } from '../lib/contest-correction';
import { buildPersonalPracticeRecordQuery } from '../lib/contest-problem-status';
import { buildExamModeRecordCodePayload, shouldUseLiveClientRecordCodeOnly } from '../lib/exam-mode-record';
import { matchesRecordConnectionScope, RECORD_PRETEST_CONTEST_ID } from '../lib/record-connection-scope';
import { PERM, PRIV, STATUS, STATUS_TEXTS } from '../model/builtin';
import * as contest from '../model/contest';
import * as contestTeam from '../model/contest-team';
import problem, { ProblemDoc } from '../model/problem';
import record from '../model/record';
import {
    auditRecordScorePermissionRejection,
    cancelRecordScore,
    getRecordScoreAction,
    recoverCanceledRecord,
} from '../model/record-score-cancellation';
import { langs } from '../model/setting';
import storage from '../model/storage';
import system from '../model/system';
import user from '../model/user';
import { ConnectionHandler, param, subscribe, Types } from '../service/server';
import { buildProjection, Time } from '../utils';
import { ContestDetailBaseHandler } from './contest';

async function getCurrentTeamForRecord(
    domainId: string,
    rdoc: RecordDoc,
    uid: number,
): Promise<contestTeam.ContestTeamDoc | null> {
    if (!(rdoc.contest instanceof ObjectId) || !(rdoc.contestTeamId instanceof ObjectId)) return null;
    if ([record.RECORD_GENERATE, record.RECORD_PRETEST].some((sentinel) => sentinel.equals(rdoc.contest))) return null;
    const team = await contestTeam.getTeam(domainId, rdoc.contest, rdoc.contestTeamId);
    return team?.memberUids.includes(uid) ? team : null;
}

async function canAccessCurrentTeamRecord(domainId: string, rdoc: RecordDoc, uid: number): Promise<boolean> {
    return !!(await getCurrentTeamForRecord(domainId, rdoc, uid));
}

export class RecordListHandler extends ContestDetailBaseHandler {
    @param('page', Types.PositiveInt, true)
    @param('pid', Types.ProblemId, true)
    @param('tid', Types.ObjectId, true)
    @param('practice', Types.Boolean)
    @param('uidOrName', Types.UidOrName, true)
    @param('lang', Types.String, true)
    @param('status', Types.Int, true)
    @param('fullStatus', Types.Boolean)
    @param('all', Types.Boolean)
    @param('allDomain', Types.Boolean)
    @param('stat', Types.Boolean)
    async get(
        domainId: string,
        page = 1,
        pid?: string | number,
        tid?: ObjectId,
        practice = false,
        uidOrName?: string,
        lang?: string,
        status?: number,
        full = false,
        all = false,
        allDomain = false,
        stat = false,
    ) {
        const notification = [];
        let tdoc = null;
        let invalid = false;
        let teamRecordAccess = false;
        let postContestPracticeActive = false;
        this.response.template = 'record_main.html';
        // tid undefined → practice mode. The Node MongoDB driver strips
        // {contest: undefined} from the filter, which would otherwise let
        // pretest records (contest = RECORD_PRETEST sentinel) leak into
        // the per-problem "提交记录" list. Build the contest filter
        // explicitly to keep practice records (no contest field) only.
        let q: Filter<RecordDoc> = tid ? { contest: tid } : { contest: { $exists: false } };
        if (practice && !tid) throw new PermissionError(PERM.PERM_VIEW_RECORD);
        if (full) uidOrName = this.user._id.toString();
        if (uidOrName) {
            const udoc =
                (await user.getById(domainId, +uidOrName)) ||
                (await user.getByUname(domainId, uidOrName)) ||
                (await user.getByEmail(domainId, uidOrName));
            if (udoc) q.uid = udoc._id;
            else invalid = true;
        }
        if (tid) {
            tdoc = await contest.get(domainId, tid);
            this.tdoc = tdoc;
            if (!tdoc) throw new ContestNotFoundError(domainId, pid);
            postContestPracticeActive = practice && canUsePostContestPractice(tdoc, this.tsdoc);
            if (practice && !postContestPracticeActive) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            if (postContestPracticeActive) {
                if (!pid || all || allDomain || (q.uid !== undefined && q.uid !== this.user._id)) {
                    throw new PermissionError(PERM.PERM_VIEW_RECORD);
                }
                q = buildPersonalPracticeRecordQuery(this.user._id, tdoc.pids);
            } else if (contest.getParticipationMode(tdoc) === 'team' && q.uid === this.user._id) {
                const team = await contestTeam.getTeamByMember(domainId, tid, this.user._id);
                if (team) {
                    delete q.uid;
                    q.contestTeamId = team.teamId;
                    teamRecordAccess = true;
                } else this.checkPerm(PERM.PERM_VIEW_RECORD);
            }
            if (!postContestPracticeActive) {
                if (!teamRecordAccess && q.uid !== this.user._id) this.checkPerm(PERM.PERM_VIEW_RECORD);
                if (!contest.canShowScoreboard.call(this, tdoc, true)) {
                    throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
                }
                if (!contest[teamRecordAccess || q.uid === this.user._id ? 'canShowSelfRecord' : 'canShowRecord'].call(this, tdoc, true)) {
                    throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
                }
                if (!(await contest.getStatus(domainId, tid, this.user._id))?.attend) {
                    const name = tdoc.rule === 'homework' ? "You haven't claimed this homework yet." : "You haven't attended this contest yet.";
                    notification.push({ name, args: { type: 'note' }, checker: () => true });
                }
            }
        } else if (q.uid !== this.user._id) this.checkPerm(PERM.PERM_VIEW_RECORD);
        if (pid) {
            if (typeof pid === 'string' && tdoc && /^[A-Z]$/.test(pid)) {
                pid = tdoc.pids[Number.parseInt(pid, 36) - 10];
            }
            const pdoc = tdoc
                ? await problem.get(domainId, pid)
                : await problem.getViewableAuthorized(domainId, pid, this.user, problem.PROJECTION_LIST);
            if (pdoc) {
                if (
                    postContestPracticeActive &&
                    !canAccessPostContestPracticeRecord(tdoc, this.tsdoc, {
                        pid: pdoc.docId,
                        actorUid: this.user._id,
                        recordUid: this.user._id,
                    })
                ) {
                    throw new PermissionError(PERM.PERM_VIEW_RECORD);
                }
                q.pid = pdoc.docId;
            } else if (postContestPracticeActive) throw new ProblemNotFoundError(domainId, pid);
            else invalid = true;
        }
        if (lang) q.lang = lang;
        if (typeof status === 'number') q.status = status;
        if (all) {
            this.checkPerm(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            this.checkPerm(PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD);
            q.contest = { $nin: [record.RECORD_PRETEST, record.RECORD_GENERATE] };
        }
        if (allDomain) {
            this.checkPriv(PRIV.PRIV_MANAGE_ALL_DOMAIN);
            q.contest = { $nin: [record.RECORD_PRETEST, record.RECORD_GENERATE] };
            q._id = { $gt: Time.getObjectID(new Date(Date.now() - 10 * Time.week)) };
        }
        let cursor = record.getMulti(allDomain ? '' : domainId, q).sort('_id', -1);
        if (!full) cursor = cursor.project(buildProjection(record.PROJECTION_LIST));
        const limit = full ? 10 : system.get('pagination.record');
        let rdocs = invalid
            ? ([] as RecordDoc[])
            : await cursor
                  .skip((page - 1) * limit)
                  .limit(limit)
                  .toArray();
        const recordScoreActions = this.user.hasPerm(PERM.PERM_REJUDGE)
            ? Object.fromEntries(
                  (
                      await Promise.all(
                          rdocs.map(async (rdoc) => [rdoc._id.toHexString(), await getRecordScoreAction(rdoc, true)] as const),
                      )
                  ).filter((entry) => entry[1]),
              )
            : {};
        rdocs = rdocs.map((rdoc) => omit(rdoc, ['scoreCancellation'])) as RecordDoc[];
        const [udict, pdict] = full
            ? [{}, {}]
            : await Promise.all([
                  user.getList(
                      domainId,
                      rdocs.map((rdoc) => rdoc.uid),
                  ),
                  tid
                      ? problem.getList(
                            domainId,
                            rdocs.map((rdoc) => rdoc.pid),
                            true,
                            false,
                            problem.PROJECTION_CONTEST_LIST,
                        )
                      : this.user.hasPerm(PERM.PERM_VIEW_PROBLEM)
                        ? problem.getListViewableAuthorized(
                              domainId,
                              rdocs.map((rdoc) => rdoc.pid),
                              this.user,
                              problem.PROJECTION_LIST,
                          )
                        : Object.fromEntries(uniqBy(rdocs, 'pid').map((rdoc) => [rdoc.pid, { ...problem.default, pid: rdoc.pid }])),
              ]);
        if (this.tdoc && !postContestPracticeActive && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
            rdocs = rdocs.map((i) => contest.applyProjection(tdoc, i, this.user));
        }
        // Admin extra column: 学号 / 姓名. Only populated when the viewer has
        // PRIV_EDIT_SYSTEM and krypton-userbind is loaded; otherwise the dict
        // stays empty and the UI hides the column.
        let studentDict: Record<string, { studentId: string; realName: string }> = {};
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && global.Hydro?.model?.userbind?.findStudentsByUserIds) {
            const uids = Array.from(new Set(rdocs.map((r) => r.uid))).filter((u) => u && u > 1);
            const students = await global.Hydro.model.userbind.findStudentsByUserIds(domainId, uids);
            studentDict = Object.fromEntries(
                Object.entries(students).map(([uid, s]: [string, any]) => [uid, { studentId: s.studentId, realName: s.realName }]),
            );
        }
        this.response.body = {
            page,
            rdocs,
            tdoc,
            pdict,
            udict,
            studentDict,
            all,
            allDomain,
            filterPid: pid,
            filterTid: tid,
            filterUidOrName: uidOrName,
            filterLang: lang,
            filterStatus: status,
            notification,
            teamRecordAccess,
            postContestPracticeActive,
            recordDetailTid: postContestPracticeActive ? tid : undefined,
            recordScoreActions,
            langs,
            statusTexts: STATUS_TEXTS,
        };
        if (stat) {
            // Contest scope (PLAN 2026-07-02 §8): owner/teacher only — a
            // student (incl. the vigil exam shell) never satisfies this, so
            // the exam-mode record list DOM is unchanged for them.
            if (tid && this.tdoc && (this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST))) {
                this.response.body.statistics = await record.stat(domainId, tid);
                this.response.body.statisticsScope = 'contest';
            } else if (this.user.hasPriv(PRIV.PRIV_VIEW_JUDGE_STATISTICS)) {
                this.response.body.statistics = await record.stat(allDomain ? undefined : domainId);
                this.response.body.statisticsScope = allDomain ? 'all' : 'domain';
            }
        }
    }
}

export class RecordDetailHandler extends ContestDetailBaseHandler {
    rdoc: RecordDoc;
    teamRecordAccess = false;
    postContestPracticeRecordAccess = false;
    contestPretestRecordAccess = false;

    @param('rid', Types.ObjectId)
    @param('practice', Types.Boolean)
    async prepare(domainId: string, rid: ObjectId, practice = false) {
        this.rdoc = await record.get(domainId, rid);
        if (!this.rdoc) throw new RecordNotFoundError(rid);
        const realContestRecord =
            this.rdoc.contest instanceof ObjectId &&
            ![record.RECORD_GENERATE, record.RECORD_PRETEST].some((sentinel) => sentinel.equals(this.rdoc.contest));
        if (practice) {
            if (!this.args.tid || !this.tdoc || realContestRecord) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            const ordinaryRecord = this.rdoc.contest === undefined;
            const pretestRecord = this.rdoc.contest instanceof ObjectId && record.RECORD_PRETEST.equals(this.rdoc.contest);
            if (
                (!ordinaryRecord && !pretestRecord) ||
                this.rdoc.hackTarget !== undefined ||
                this.rdoc.contestTeamId !== undefined ||
                (ordinaryRecord && this.rdoc.input !== undefined) ||
                !canAccessPostContestPracticeRecord(this.tdoc, this.tsdoc, {
                    pid: this.rdoc.pid,
                    actorUid: this.user._id,
                    recordUid: this.rdoc.uid,
                })
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.postContestPracticeRecordAccess = true;
            return;
        }
        if (this.args.tid && this.tdoc && this.rdoc.contest instanceof ObjectId && record.RECORD_PRETEST.equals(this.rdoc.contest)) {
            if (
                this.rdoc.uid !== this.user._id ||
                this.tsdoc?.attend !== 1 ||
                !Array.isArray(this.tdoc.pids) ||
                !this.tdoc.pids.includes(this.rdoc.pid)
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.contestPretestRecordAccess = true;
            return;
        }
        if (realContestRecord) {
            this.tdoc = await contest.get(domainId, this.rdoc.contest);
            if (contest.getParticipationMode(this.tdoc) === 'team') {
                if (!(this.rdoc.contestTeamId instanceof ObjectId)) throw new PermissionError(rid);
                this.teamRecordAccess = await canAccessCurrentTeamRecord(domainId, this.rdoc, this.user._id);
                if (!this.teamRecordAccess) this.checkPerm(PERM.PERM_VIEW_RECORD);
                return;
            }
        }
        if (this.rdoc.uid !== this.user._id) this.checkPerm(PERM.PERM_VIEW_RECORD);
        this.tdoc = undefined;
        this.tsdoc = undefined;
    }

    async download() {
        for (const file of ['code', 'hack']) {
            if (!this.rdoc.files?.[file]) continue;
            const [id, filename] = this.rdoc.files?.[file]?.split('#') || [];

            this.response.redirect = await storage.signDownloadLink(`submission/${id}`, filename || file, true, 'user');
            return;
        }
        const lang = langs[this.rdoc.lang]?.pretest || this.rdoc.lang;
        this.response.body = this.rdoc.code;
        this.response.type = 'text/plain';
        this.response.disposition = `attachment; filename="${langs[lang]?.code_file || `foo.${this.rdoc.lang}`}"`;
    }

    @param('rid', Types.ObjectId)
    @param('download', Types.Boolean)
    @param('rev', Types.ObjectId, true)
    async get(domainId: string, rid: ObjectId, download = false, rev?: ObjectId) {
        let rdoc = this.rdoc;
        let currentRecordTeam: contestTeam.ContestTeamDoc | null = null;
        const allRev = await record.collHistory.find({ rid }).project({ _id: 1, judgeAt: 1 }).sort({ _id: -1 }).toArray();
        const allRevs: Record<string, Date> = Object.fromEntries(allRev.map((i) => [i._id.toString(), i.judgeAt]));
        if (rev && allRevs[rev.toString()]) {
            rdoc = { ...rdoc, ...omit(await record.collHistory.findOne({ _id: rev }), ['_id']), progress: null };
        }
        let canViewDetail = true;
        if (rdoc.contest?.toString().startsWith('0'.repeat(23))) {
            if (rdoc.uid !== this.user._id) throw new PermissionError(PERM.PERM_READ_RECORD_CODE);
        } else if (rdoc.contest) {
            this.tdoc ||= await contest.get(domainId, rdoc.contest);
            const teamContestRecord = contest.getParticipationMode(this.tdoc) === 'team';
            if (teamContestRecord) {
                currentRecordTeam = await getCurrentTeamForRecord(domainId, rdoc, this.user._id);
                this.teamRecordAccess = !!currentRecordTeam;
            }
            let canView = this.user.own(this.tdoc);
            canView ||= contest.canShowRecord.call(this, this.tdoc);
            canView ||=
                contest.canShowSelfRecord.call(this, this.tdoc, true) && (teamContestRecord ? this.teamRecordAccess : rdoc.uid === this.user._id);
            if (!canView) throw new PermissionError(rid);
            canViewDetail = canView;
            this.args.tid = this.tdoc.docId;
            if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                this.rdoc = contest.applyProjection(this.tdoc, this.rdoc, this.user);
            }
        }

        if (this.tdoc) {
            this.tsdoc = await contest.getStatus(domainId, this.tdoc.docId, this.user._id);
        }
        const liveClientRecordCodeOnly =
            !!this.tdoc &&
            shouldUseLiveClientRecordCodeOnly({
                clientRequired: contest.isClientRequired(this.tdoc),
                ongoing: contest.isOngoing(this.tdoc),
                contestOwner: this.user.own(this.tdoc),
                canEditContest: this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                systemAdmin: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
            });
        if (liveClientRecordCodeOnly && rev) throw new PermissionError(PERM.PERM_VIEW_RECORD);
        const contextualProblemAccess = this.postContestPracticeRecordAccess || this.contestPretestRecordAccess;
        const requiresDirectProblemAccess = !contextualProblemAccess && (!this.tdoc || (!this.teamRecordAccess && !this.tsdoc?.attend));
        const [pdoc, self, udoc] = await Promise.all([
            requiresDirectProblemAccess
                ? problem.getViewableAuthorized(rdoc.domainId, rdoc.pid, this.user, problem.PROJECTION_LIST.concat('config'))
                : problem.get(rdoc.domainId, rdoc.pid, problem.PROJECTION_LIST.concat('config')),
            problem.getStatus(domainId, rdoc.pid, this.user._id),
            user.getById(domainId, rdoc.uid),
        ]);

        let canViewCode =
            !contextualProblemAccess && this.tdoc && contest.getParticipationMode(this.tdoc) === 'team'
                ? this.teamRecordAccess
                : rdoc.uid === this.user._id;
        canViewCode ||= this.user.hasPriv(PRIV.PRIV_READ_RECORD_CODE);
        canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE);
        canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE_ACCEPT) && self?.status === STATUS.STATUS_ACCEPTED;
        if (this.tdoc) {
            canViewCode ||= this.user.own(this.tdoc);
            if (contest.getParticipationMode(this.tdoc) !== 'team' && this.tdoc.allowViewCode && contest.isDone(this.tdoc)) {
                canViewCode ||= this.tsdoc?.attend;
            }
        }
        if (
            download &&
            !this.postContestPracticeRecordAccess &&
            this.tdoc &&
            contest.getParticipationMode(this.tdoc) === 'team' &&
            this.teamRecordAccess
        ) {
            if (
                !currentRecordTeam ||
                currentRecordTeam.captainUid !== this.user._id ||
                !(rdoc.contestTeamId instanceof ObjectId) ||
                !currentRecordTeam.teamId.equals(rdoc.contestTeamId)
            ) {
                throw new PermissionError(PERM.PERM_READ_RECORD_CODE);
            }
        }
        if (!pdoc) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);
        if (!canViewCode) {
            rdoc.code = '';
            rdoc.files = {};
            rdoc.compilerTexts = [];
        } else if (download) return await this.download();
        // PTA-style per-test-point hints. Visibility is enforced HERE (server
        // side), never trusted to the client: a hint is exposed only when its
        // author flag `hintPublic` is set AND the record is NOT being viewed
        // inside a contest that is not yet done for THIS viewer (passing tsdoc
        // covers per-attendee duration windows — revealed only after the
        // contest ends). parseConfig() strips per-case fields, so re-load the
        // raw config and run it through the SAME readYamlCases + normalizeSubtasks
        // the judge uses, so the (subtaskId, caseId) keys line up EXACTLY with
        // the record's testCases (positional flattening mis-maps under parallel
        // judging + subtask/case id sorting). Keyed `${subtaskId}-${caseId}`.
        // NOTE(MVP): does not yet block the "open the same problem from the bank
        // while attending an ongoing contest that contains it" bypass — left as
        // a follow-up; the practice problem is normally contest-hidden anyway.
        const testHints: Record<string, { hint?: string; videoUrl?: string }> = {};
        try {
            const inActiveContest = this.tdoc ? !contest.isDone(this.tdoc, this.tsdoc) : false;
            if (canViewDetail && !inActiveContest) {
                const rawPdoc = requiresDirectProblemAccess
                    ? await problem.getViewableAuthorized(rdoc.domainId, rdoc.pid, this.user, ['domainId', 'docId', 'config'], true)
                    : await problem.get(rdoc.domainId, rdoc.pid, ['domainId', 'docId', 'config'], true);
                const rawCfg = rawPdoc?.config;
                const cfgObj: any = typeof rawCfg === 'string' ? loadYaml(rawCfg) : rawCfg;
                if (cfgObj && typeof cfgObj === 'object') {
                    const parsed: any = await readYamlCases(cfgObj);
                    const normalized = normalizeSubtasks(parsed.subtasks || [], (s: string) => s, parsed.time, parsed.memory, true);
                    for (const st of normalized) {
                        for (const c of (st.cases || []) as any[]) {
                            if (!c) continue;
                            // Hint and video have independent publish flags;
                            // videoPublic falls back to hintPublic when unset
                            // so pre-existing configs keep their behavior.
                            const showHint = c.hintPublic && c.hint;
                            const showVideo = (c.videoPublic ?? c.hintPublic) && c.videoUrl;
                            if (showHint || showVideo) {
                                testHints[`${st.id}-${c.id}`] = {
                                    ...(showHint ? { hint: c.hint } : {}),
                                    ...(showVideo ? { videoUrl: c.videoUrl } : {}),
                                };
                            }
                        }
                    }
                }
            }
        } catch {
            /* malformed config → no hints, never break the page */
        }
        let recordStudent: { studentId: string; realName: string } | null = null;
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && global.Hydro?.model?.userbind?.findStudentsByUserIds && rdoc.uid > 1) {
            const students = await global.Hydro.model.userbind.findStudentsByUserIds(domainId, [rdoc.uid]);
            const student = students[String(rdoc.uid)];
            if (student) {
                recordStudent = {
                    studentId: String(student.studentId || ''),
                    realName: String(student.realName || ''),
                };
            }
        }
        this.response.template = 'record_detail.html';
        const responseRdoc = omit(rdoc, ['scoreCancellation']);
        const recordScoreAction = this.user.hasPerm(PERM.PERM_REJUDGE) ? await getRecordScoreAction(rdoc, true) : null;
        const responseBody = {
            udoc,
            recordStudent,
            rdoc: canViewDetail ? responseRdoc : pick(responseRdoc, ['_id', 'lang', 'code']),
            pdoc,
            tdoc: this.tdoc,
            postContestPracticeRecordAccess: this.postContestPracticeRecordAccess,
            practiceTid: this.postContestPracticeRecordAccess ? this.tdoc.docId : undefined,
            rev,
            allRevs,
            // ui-next needs `langs` to render `rdoc.lang` (e.g. "cc.cc17") as
            // a human-readable label (e.g. "C++ 17"). RecordsMain already
            // ships this; mirror it here for the detail page.
            langs,
            // Per-test-point hints to render next to each case (already
            // visibility-filtered above). Keyed by 1-based case order.
            testHints,
            ...(this.user.hasPerm(PERM.PERM_REJUDGE) ? { recordScoreAction } : {}),
        };
        const teamMemberCannotDownload =
            !!this.tdoc &&
            contest.getParticipationMode(this.tdoc) === 'team' &&
            this.teamRecordAccess &&
            currentRecordTeam?.captainUid !== this.user._id;
        this.response.body = liveClientRecordCodeOnly
            ? buildExamModeRecordCodePayload({
                  ...responseBody,
                  ...(teamMemberCannotDownload ? { examRecordDownloadAvailable: false } : {}),
              })
            : responseBody;
    }

    @param('rid', Types.ObjectId)
    async post() {
        const operation = String(this.args.operation || '');
        if (!this.user.hasPerm(PERM.PERM_REJUDGE)) {
            if (operation === 'cancel' || (operation === 'rejudge' && this.rdoc.status === STATUS.STATUS_CANCELED)) {
                await auditRecordScorePermissionRejection({
                    rdoc: this.rdoc,
                    actor: this.user._id,
                    operation,
                });
            }
            throw new PermissionError(PERM.PERM_REJUDGE);
        }
        if (operation !== 'cancel') {
            if (this.rdoc.files?.hack) throw new HackRejudgeFailedError();
            if (this.rdoc.contest?.toString().startsWith('0'.repeat(23))) throw new PretestRejudgeFailedError();
        }
    }

    @param('expectedCancellationAt', Types.String, true)
    @param('rid', Types.ObjectId)
    async postRejudge(domainId: string, expectedCancellationAt: string | undefined, rid: ObjectId) {
        if (expectedCancellationAt !== undefined || this.rdoc.status === STATUS.STATUS_CANCELED || this.rdoc.scoreCancellation) {
            if (!expectedCancellationAt) throw new ValidationError('expectedCancellationAt');
            const cancellationAt = new Date(expectedCancellationAt);
            if (Number.isNaN(cancellationAt.getTime())) throw new ValidationError('expectedCancellationAt');
            const result = await recoverCanceledRecord({
                domainId,
                rid,
                actor: this.user._id,
                expectedCancellationAt: cancellationAt,
            });
            this.ctx.broadcast('record/change', result.rdoc);
            if (this.request.json) {
                this.response.body = result;
                return;
            }
            this.back();
            return;
        }
        const pdoc = await problem.get(domainId, this.rdoc.pid);
        if (!pdoc?.config || typeof pdoc.config === 'string') throw new ProblemConfigError();
        const priority = await record.submissionPriority(this.user._id, -20);
        const rdoc = await record.reset(domainId, rid, true);
        this.ctx.broadcast('record/change', rdoc);
        await record.judge(domainId, rid, priority, this.rdoc.contest ? { detail: false } : {});
        if (this.request.json) {
            this.response.body = {
                rdoc,
                recordScoreAction: null,
            };
            return;
        }
        this.back();
    }

    @param('expectedStatus', Types.Int)
    @param('expectedJudgeAt', Types.String)
    @param('reason', Types.String, true)
    @param('rid', Types.ObjectId)
    async postCancel(domainId: string, expectedStatus: number, expectedJudgeAt: string, reason: string | undefined, rid: ObjectId) {
        const judgeAt = new Date(expectedJudgeAt);
        if (Number.isNaN(judgeAt.getTime())) throw new ValidationError('expectedJudgeAt');
        const result = await cancelRecordScore({
            domainId,
            rid,
            actor: this.user._id,
            expectedStatus,
            expectedJudgeAt: judgeAt,
            reason,
        });
        this.ctx.broadcast('record/change', result.rdoc);
        if (this.request.json) {
            this.response.body = {
                ...result,
                rdoc: omit(result.rdoc, ['scoreCancellation']),
            };
            return;
        }
        this.back();
    }
}

export class RecordMainConnectionHandler extends ConnectionHandler {
    all = false;
    allDomain = false;
    tid: string;
    uid: number;
    teamId?: ObjectId;
    pid: number;
    lang: string;
    status: number;
    pretest = false;
    practice = false;
    practiceTid?: string;
    practiceTsdoc?: { attend?: number };
    tdoc: Tdoc;
    applyProjection = false;
    noTemplate = false;
    queue: Map<string, () => Promise<any>> = new Map();
    throttleQueueClear: () => void;

    @param('tid', Types.ObjectId, true)
    @param('practice', Types.Boolean)
    @param('pid', Types.ProblemId, true)
    @param('uidOrName', Types.UidOrName, true)
    @param('lang', Types.String, true)
    @param('status', Types.Int, true)
    @param('pretest', Types.Boolean)
    @param('all', Types.Boolean)
    @param('allDomain', Types.Boolean)
    @param('noTemplate', Types.Boolean, true)
    async prepare(
        domainId: string,
        tid?: ObjectId,
        practice = false,
        pid?: string | number,
        uidOrName?: string,
        lang?: string,
        status?: number,
        pretest = false,
        all = false,
        allDomain = false,
        noTemplate = false,
    ) {
        if (practice && !tid) throw new PermissionError(PERM.PERM_VIEW_RECORD);
        if (tid) {
            this.tdoc = await contest.get(domainId, tid);
            if (!this.tdoc) throw new ContestNotFoundError(domainId, tid);
            this.practiceTsdoc = practice ? await contest.getStatus(domainId, tid, this.user._id) : undefined;
            this.practice = practice && canUsePostContestPractice(this.tdoc, this.practiceTsdoc);
            if (practice && !this.practice) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            if (this.practice) this.practiceTid = tid.toHexString();
            else if (pretest || contest.canShowScoreboard.call(this, this.tdoc, true)) this.tid = tid.toHexString();
            else throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            if (!this.practice && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                this.applyProjection = true;
            }
        }
        if (pretest) {
            this.pretest = true;
            this.uid = this.user._id;
        } else if (uidOrName) {
            let udoc = await user.getById(domainId, +uidOrName);
            if (udoc) this.uid = udoc._id;
            else {
                udoc = await user.getByUname(domainId, uidOrName);
                if (udoc) this.uid = udoc._id;
                else throw new UserNotFoundError(uidOrName);
            }
        }
        if (this.practice) {
            if ((typeof this.uid === 'number' && this.uid !== this.user._id) || !pid || all || allDomain) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.uid = this.user._id;
        }
        if (!this.practice && !pretest && this.tdoc && contest.getParticipationMode(this.tdoc) === 'team' && this.uid === this.user._id) {
            const team = await contestTeam.getTeamByMember(domainId, tid, this.user._id);
            if (team) {
                this.teamId = team.teamId;
                this.uid = undefined;
            } else this.checkPerm(PERM.PERM_VIEW_RECORD);
        }
        if (!this.teamId && this.uid !== this.user._id) this.checkPerm(PERM.PERM_VIEW_RECORD);
        if (pid) {
            const pdoc = this.tdoc
                ? await problem.get(domainId, pid)
                : await problem.getViewableAuthorized(domainId, pid, this.user, problem.PROJECTION_LIST);
            if (
                pdoc &&
                this.practice &&
                !canAccessPostContestPracticeRecord(this.tdoc, this.practiceTsdoc, {
                    pid: pdoc.docId,
                    actorUid: this.user._id,
                    recordUid: this.user._id,
                })
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            if (pdoc) this.pid = pdoc.docId;
            else throw new ProblemNotFoundError(domainId, pid);
        }
        if (lang) this.lang = lang;
        if (typeof status === 'number') this.status = status;
        if (all) {
            this.checkPerm(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            this.checkPerm(PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD);
            this.all = true;
        }
        if (allDomain) {
            this.checkPriv(PRIV.PRIV_MANAGE_ALL_DOMAIN);
            this.allDomain = true;
        }
        this.noTemplate = noTemplate;
        this.throttleQueueClear = throttle(this.queueClear, 100, { trailing: true });
    }

    async message(msg: { rids: string[] }) {
        if (!(msg.rids instanceof Array)) return;
        const rids = msg.rids.map((id) => new ObjectId(id));
        const rdocs = await record
            .getMulti(this.args.domainId, { _id: { $in: rids } })
            .project<RecordDoc>({ ...buildProjection(record.PROJECTION_LIST), input: 1 })
            .toArray();
        for (const rdoc of rdocs) this.onRecordChange(rdoc);
    }

    @subscribe('record/change')
    async onRecordChange(rdoc: RecordDoc) {
        const contestId = rdoc.contest?.toString();
        if (
            !matchesRecordConnectionScope(
                {
                    domainId: rdoc.domainId,
                    contestId,
                    lang: rdoc.lang,
                    status: rdoc.status,
                    input: rdoc.input,
                },
                {
                    domainId: this.args.domainId,
                    tid: this.tid,
                    lang: this.lang,
                    status: this.status,
                    pretest: this.pretest,
                    all: this.all,
                    allDomain: this.allDomain,
                },
            )
        ) {
            return;
        }
        if (
            this.practice &&
            (rdoc.uid !== this.user._id ||
                rdoc.hackTarget !== undefined ||
                rdoc.contestTeamId !== undefined ||
                (this.pretest
                    ? !(rdoc.contest instanceof ObjectId) || !record.RECORD_PRETEST.equals(rdoc.contest)
                    : rdoc.contest !== undefined || rdoc.input !== undefined))
        ) {
            return;
        }
        if (!this.allDomain && !this.all) {
            if (this.tid && contestId !== RECORD_PRETEST_CONTEST_ID) {
                if (this.teamId) {
                    if (!(rdoc.contestTeamId instanceof ObjectId) || !rdoc.contestTeamId.equals(this.teamId)) return;
                    const team = await contestTeam.getTeam(this.args.domainId, this.tdoc.docId, this.teamId);
                    if (!team?.memberUids.includes(this.user._id)) {
                        this.close(4003, 'Team record access revoked');
                        return;
                    }
                    if (!contest.canShowSelfRecord.call(this, this.tdoc, true)) return;
                } else {
                    if (rdoc.uid !== this.user._id && !contest.canShowRecord.call(this, this.tdoc, true)) return;
                    if (rdoc.uid === this.user._id && !contest.canShowSelfRecord.call(this, this.tdoc, true)) return;
                }
            }
        }
        if (typeof this.pid === 'number' && rdoc.pid !== this.pid) return;
        if (typeof this.uid === 'number' && rdoc.uid !== this.uid) return;

        const recordScoreAction = this.user.hasPerm(PERM.PERM_REJUDGE) ? await getRecordScoreAction(rdoc, true) : null;
        let [udoc, pdoc] = await Promise.all([
            user.getById(this.args.domainId, rdoc.uid),
            rdoc.contest || this.practice ? problem.get(rdoc.domainId, rdoc.pid) : problem.getViewableAuthorized(rdoc.domainId, rdoc.pid, this.user),
        ]);
        const tdoc = this.tid || this.practice ? this.tdoc : null;
        if (pdoc && !rdoc.contest && !this.practice && !this.user.hasPerm(PERM.PERM_VIEW_PROBLEM)) pdoc = null;
        if (this.applyProjection && rdoc.contest?.toString() !== '0'.repeat(24)) rdoc = contest.applyProjection(tdoc, rdoc, this.user);
        rdoc = omit(rdoc, ['scoreCancellation']) as RecordDoc;
        if (this.pretest) {
            this.queueSend(rdoc._id.toHexString(), async () => ({ rdoc: omit(rdoc, ['code', 'input']) }));
        } else if (this.noTemplate) {
            this.queueSend(rdoc._id.toHexString(), async () => ({ rdoc, recordScoreAction }));
        } else {
            this.queueSend(rdoc._id.toHexString(), async () => ({
                html: await this.renderHTML('record_main_tr.html', {
                    rdoc,
                    udoc,
                    pdoc,
                    tdoc,
                    recordDetailTid: this.practice ? this.practiceTid : undefined,
                    allDomain: this.allDomain,
                    recordScoreActions: recordScoreAction ? { [rdoc._id.toHexString()]: recordScoreAction } : {},
                }),
            }));
        }
    }

    @subscribe('contest/team-role-change')
    async onTeamRoleChange(payload: { after: contestTeam.ContestTeamDoc }) {
        if (!this.teamId || !this.tid) return;
        if (!payload.after.teamId.equals(this.teamId) || payload.after.contestId.toHexString() !== this.tid) return;
        this.send({ teamRoleChanged: true, teamRevision: payload.after.revision });
        if (!payload.after.active || !payload.after.memberUids.includes(this.user._id)) this.close(4003, 'Team record access revoked');
    }

    queueSend(rid: string, fn: () => Promise<any>) {
        this.queue.set(rid, fn);
        this.throttleQueueClear();
    }

    async queueClear() {
        await Promise.all([...this.queue.values()].map(async (fn) => this.send(await fn())));
        this.queue.clear();
    }
}

export class RecordDetailConnectionHandler extends ConnectionHandler {
    pdoc: ProblemDoc;
    tdoc?: Tdoc;
    rid: string = '';
    disconnectTimeout: NodeJS.Timeout;
    throttleSend: any;
    applyProjection = false;
    noTemplate = false;
    canViewCode = false;
    teamRecordAccess = false;
    liveClientRecordCodeOnly = false;
    postContestPracticeRecordAccess = false;
    contestPretestRecordAccess = false;
    practiceTid?: ObjectId;
    practiceRecordPid?: number;
    recordTeamId?: ObjectId;
    recordContestId?: ObjectId;

    @param('rid', Types.ObjectId)
    @param('tid', Types.ObjectId, true)
    @param('practice', Types.Boolean)
    @param('noTemplate', Types.Boolean, true)
    async prepare(domainId: string, rid: ObjectId, tid?: ObjectId, practice = false, noTemplate = false) {
        const rdoc = await record.get(domainId, rid);
        if (!rdoc) return;
        const realContestRecord =
            rdoc.contest instanceof ObjectId && ![record.RECORD_GENERATE, record.RECORD_PRETEST].some((sentinel) => sentinel.equals(rdoc.contest));
        if (practice) {
            if (!tid || realContestRecord) throw new PermissionError(PERM.PERM_VIEW_RECORD);
            this.tdoc = await contest.get(domainId, tid);
            const tsdoc = await contest.getStatus(domainId, tid, this.user._id);
            const ordinaryRecord = rdoc.contest === undefined;
            const pretestRecord = rdoc.contest instanceof ObjectId && record.RECORD_PRETEST.equals(rdoc.contest);
            if (
                !this.tdoc ||
                (!ordinaryRecord && !pretestRecord) ||
                rdoc.hackTarget !== undefined ||
                rdoc.contestTeamId !== undefined ||
                (ordinaryRecord && rdoc.input !== undefined) ||
                !canAccessPostContestPracticeRecord(this.tdoc, tsdoc, {
                    pid: rdoc.pid,
                    actorUid: this.user._id,
                    recordUid: rdoc.uid,
                })
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.postContestPracticeRecordAccess = true;
            this.practiceTid = tid;
            this.practiceRecordPid = rdoc.pid;
        } else if (tid && rdoc.contest instanceof ObjectId && record.RECORD_PRETEST.equals(rdoc.contest)) {
            this.tdoc = await contest.get(domainId, tid);
            const tsdoc = await contest.getStatus(domainId, tid, this.user._id);
            if (
                !this.tdoc ||
                rdoc.uid !== this.user._id ||
                tsdoc?.attend !== 1 ||
                !Array.isArray(this.tdoc.pids) ||
                !this.tdoc.pids.includes(rdoc.pid)
            ) {
                throw new PermissionError(PERM.PERM_VIEW_RECORD);
            }
            this.contestPretestRecordAccess = true;
        } else if (realContestRecord) {
            this.tdoc = await contest.get(domainId, rdoc.contest);
            this.liveClientRecordCodeOnly = shouldUseLiveClientRecordCodeOnly({
                clientRequired: contest.isClientRequired(this.tdoc),
                ongoing: contest.isOngoing(this.tdoc),
                contestOwner: this.user.own(this.tdoc),
                canEditContest: this.user.hasPerm(PERM.PERM_EDIT_CONTEST),
                systemAdmin: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
            });
            const teamContestRecord = contest.getParticipationMode(this.tdoc) === 'team';
            if (teamContestRecord) {
                if (!(rdoc.contestTeamId instanceof ObjectId)) throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
                this.teamRecordAccess = await canAccessCurrentTeamRecord(domainId, rdoc, this.user._id);
                this.recordTeamId = rdoc.contestTeamId;
                this.recordContestId = rdoc.contest;
            }
            let canView = this.user.own(this.tdoc);
            canView ||= contest.canShowRecord.call(this, this.tdoc);
            canView ||= (teamContestRecord ? this.teamRecordAccess : this.user._id === rdoc.uid) && contest.canShowSelfRecord.call(this, this.tdoc);
            if (!canView) throw new PermissionError(PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD);
            if (!this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_EDIT_CONTEST)) {
                this.applyProjection = true;
            }
        }
        const contextualProblemAccess = this.postContestPracticeRecordAccess || this.contestPretestRecordAccess;
        const requiresDirectProblemAccess = !contextualProblemAccess && (!rdoc.contest || (!this.teamRecordAccess && this.user._id !== rdoc.uid));
        const [pdoc, self] = await Promise.all([
            requiresDirectProblemAccess ? problem.getViewableAuthorized(rdoc.domainId, rdoc.pid, this.user) : problem.get(rdoc.domainId, rdoc.pid),
            problem.getStatus(domainId, rdoc.pid, this.user._id),
        ]);

        this.canViewCode =
            !contextualProblemAccess && this.tdoc && contest.getParticipationMode(this.tdoc) === 'team'
                ? this.teamRecordAccess
                : rdoc.uid === this.user._id;
        this.canViewCode ||= this.user.hasPriv(PRIV.PRIV_READ_RECORD_CODE);
        this.canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE);
        this.canViewCode ||= this.user.hasPerm(PERM.PERM_READ_RECORD_CODE_ACCEPT) && self?.status === STATUS.STATUS_ACCEPTED;

        if (!pdoc) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);

        this.pdoc = pdoc;
        this.noTemplate = noTemplate;
        this.throttleSend = throttle(this.sendUpdate, 1000, { trailing: true });
        this.rid = rid.toString();
        this.onRecordChange(rdoc);
    }

    @subscribe('contest/team-role-change')
    async onTeamRoleChange(payload: { before: contestTeam.ContestTeamDoc; after: contestTeam.ContestTeamDoc }) {
        if (!this.teamRecordAccess || !this.recordTeamId || !this.recordContestId) return;
        if (!payload.after.teamId.equals(this.recordTeamId) || !payload.after.contestId.equals(this.recordContestId)) return;
        this.send({ teamRoleChanged: true, teamRevision: payload.after.revision });
        if (!payload.after.active || !payload.after.memberUids.includes(this.user._id)) this.close(4003, 'Team record access revoked');
    }

    async sendUpdate(rdoc: RecordDoc) {
        const recordScoreAction =
            !this.liveClientRecordCodeOnly && this.user.hasPerm(PERM.PERM_REJUDGE) ? await getRecordScoreAction(rdoc, true) : null;
        rdoc = omit(rdoc, ['scoreCancellation']) as RecordDoc;
        if (this.liveClientRecordCodeOnly) {
            const codeVisibleRecord = this.canViewCode
                ? rdoc
                : {
                      ...rdoc,
                      code: '',
                      files: {},
                      compilerTexts: [],
                  };
            const payload = buildExamModeRecordCodePayload({ rdoc: codeVisibleRecord, pdoc: this.pdoc, langs });
            this.send({ rdoc: payload.rdoc });
            return;
        }
        if (this.noTemplate) {
            this.send({ rdoc, recordScoreAction });
        } else {
            this.send({
                status: rdoc.status,
                status_html: await this.renderHTML('record_detail_status.html', { rdoc, pdoc: this.pdoc }),
                summary_html: await this.renderHTML('record_detail_summary.html', { rdoc, pdoc: this.pdoc }),
            });
        }
    }

    @subscribe('record/change')
    // eslint-disable-next-line
    async onRecordChange(rdoc: RecordDoc, $set?: any, $push?: any) {
        if (rdoc._id.toString() !== this.rid) return;
        if (
            this.postContestPracticeRecordAccess &&
            (rdoc.uid !== this.user._id ||
                rdoc.pid !== this.practiceRecordPid ||
                rdoc.hackTarget !== undefined ||
                rdoc.contestTeamId !== undefined ||
                (rdoc.contest === undefined && rdoc.input !== undefined) ||
                (rdoc.contest !== undefined && (!(rdoc.contest instanceof ObjectId) || !record.RECORD_PRETEST.equals(rdoc.contest))))
        ) {
            this.close(4003, 'Post-contest practice record access revoked');
            return;
        }
        if (this.teamRecordAccess && !(await canAccessCurrentTeamRecord(this.args.domainId, rdoc, this.user._id))) {
            this.close(4003, 'Team record access revoked');
            return;
        }
        if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
        }
        if (this.applyProjection) rdoc = contest.applyProjection(this.tdoc, rdoc, this.user);
        // TODO: frontend doesn't support incremental update
        // if ($set) this.send({ $set, $push });
        if (!this.canViewCode) {
            rdoc = {
                ...rdoc,
                code: '',
                compilerTexts: [],
            };
        }
        if (![STATUS.STATUS_WAITING, STATUS.STATUS_JUDGING, STATUS.STATUS_COMPILING, STATUS.STATUS_FETCHED].includes(rdoc.status)) {
            this.disconnectTimeout = setTimeout(() => this.close(4001, 'Ended'), 30000);
        }
        this.throttleSend(rdoc);
    }
}

export async function apply(ctx) {
    ctx.Route('record_main', '/record', RecordListHandler);
    ctx.Route('record_detail', '/record/:rid', RecordDetailHandler);
    ctx.Connection('record_conn', '/record-conn', RecordMainConnectionHandler);
    ctx.Connection('record_detail_conn', '/record-detail-conn', RecordDetailConnectionHandler);
}
