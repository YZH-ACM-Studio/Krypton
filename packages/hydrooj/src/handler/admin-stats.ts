import { Filter, ObjectId } from 'mongodb';
import { Context } from '../context';
import { localizedErrorText, NotFoundError, ValidationError } from '../error';
import { TrainingDoc } from '../interface';
import {
    ADMIN_STATS_MAX_TIME_MS,
    buildTrainingStats,
    contestStatsPipeline,
    dashboardStatsPipeline,
    groupUserStatsPipeline,
    normalizeDashboardStats,
    normalizeContestStats,
    normalizeProblemStats,
    normalizeUserStats,
    problemStatsPipeline,
    shanghaiDayWindow,
    trainingAcceptedPairsPipeline,
    trainingEnrollmentPipeline,
    userStatsPipeline,
} from '../lib/admin-stats';
import { isProblemSetKind, withProblemSetKind } from '../lib/training-kind';
import { Handler, param, Types } from '../service/server';
import { PRIV, STATUS } from '../model/builtin';
import * as contest from '../model/contest';
import * as document from '../model/document';
import ProblemModel from '../model/problem';
import RecordModel from '../model/record';
import * as training from '../model/training';
import UserModel from '../model/user';

const STATS_VIEWS = ['contest', 'training', 'user', 'group', 'dashboard', 'problem'] as const;
type StatsView = (typeof STATS_VIEWS)[number];

function objectIdAt(date: Date) {
    return ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
}

class AdminStatsHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    @param('view', Types.Range([...STATS_VIEWS]), true)
    @param('contestId', Types.ObjectId, true)
    @param('trainingId', Types.ObjectId, true)
    @param('q', Types.String, true)
    @param('uid', Types.PositiveInt, true)
    @param('groupIds', Types.CommaSeperatedArray, true)
    @param('range', Types.Range([30, 90]), true)
    @param('tag', Types.String, true)
    async get(
        domainId: string,
        view: StatsView = 'contest',
        contestId?: ObjectId,
        trainingId?: ObjectId,
        q = '',
        uid?: number,
        groupIds: string[] = [],
        range: 30 | 90 = 30,
        tag = '',
    ) {
        const trainingFilter: Filter<TrainingDoc> = withProblemSetKind({}) as Filter<TrainingDoc>;
        const [contests, trainings] = await Promise.all([
            contest
                .getMulti(domainId, { rule: { $ne: 'homework' } })
                .project({ docId: 1, title: 1, beginAt: 1, endAt: 1, rule: 1 })
                .toArray(),
            training.getMulti(domainId, trainingFilter).project({ docId: 1, title: 1 }).toArray(),
        ]);

        const selectedContestId = view === 'contest' ? contestId || contests[0]?.docId : undefined;
        const selectedTrainingId = view === 'training' ? trainingId || trainings[0]?.docId : undefined;
        let selectedContest: any = null;
        let selectedTraining: any = null;
        let stats: any = null;
        let problems: Array<{ docId: number; pid?: string; title: string }> = [];
        let groups: any[] = [];
        let userSearchResults: any[] = [];
        let selectedUser: any = null;
        const userbind = (global as any).Hydro?.model?.userbind;

        if (selectedContestId) {
            selectedContest = await contest.get(domainId, selectedContestId);
            if (selectedContest.rule === 'homework') throw new NotFoundError(localizedErrorText`contest`);
            const rows = await RecordModel.coll
                .aggregate(contestStatsPipeline(domainId, selectedContestId, STATUS.STATUS_ACCEPTED), { maxTimeMS: ADMIN_STATS_MAX_TIME_MS })
                .toArray();
            stats = normalizeContestStats(rows);
            const byProblem = new Map(stats.byProblem.map((row) => [row.pid, row]));
            stats.byProblem = (selectedContest.pids || []).map((pid) => byProblem.get(pid) || { pid, total: 0, accepted: 0 });
            problems = await this.problemSummaries(domainId, selectedContest.pids || []);
        } else if (selectedTrainingId) {
            selectedTraining = await training.get(domainId, selectedTrainingId);
            if (!isProblemSetKind(selectedTraining.kind)) throw new NotFoundError(localizedErrorText`training`);
            const pids = training.getPids(selectedTraining.dag || []);
            const enrollmentRows = await document.collStatus
                .aggregate(trainingEnrollmentPipeline(domainId, selectedTrainingId), { maxTimeMS: ADMIN_STATS_MAX_TIME_MS })
                .toArray();
            const memberUids = enrollmentRows.map((row) => Number(row._id));
            const acceptedRows =
                memberUids.length && pids.length
                    ? await document.collStatus
                          .aggregate(trainingAcceptedPairsPipeline(domainId, memberUids, pids, STATUS.STATUS_ACCEPTED), {
                              maxTimeMS: ADMIN_STATS_MAX_TIME_MS,
                          })
                          .toArray()
                    : [];
            if (!userbind?.findStudentsByUserIds) throw new Error('userbind.findStudentsByUserIds is required for admin training statistics');
            const [udict, studentDict] = await Promise.all([
                UserModel.getListForRender(domainId, memberUids, false),
                userbind.findStudentsByUserIds(domainId, memberUids),
            ]);
            const identities = memberUids.map((memberUid) => {
                const user = udict[memberUid];
                if (!user) throw new Error(`Training enrollee user is missing: uid=${memberUid}`);
                const student = studentDict[String(memberUid)];
                return {
                    uid: memberUid,
                    uname: user.uname,
                    studentId: student?.studentId || '',
                    realName: student?.realName || '',
                };
            });
            stats = buildTrainingStats(
                identities,
                pids,
                acceptedRows.map((row) => ({ uid: Number(row._id.uid), pid: Number(row._id.pid) })),
            );
            problems = await this.problemSummaries(domainId, pids);
        } else if (view === 'user') {
            userSearchResults = q.trim() ? await UserModel.getPrefixList(domainId, q.trim(), 20) : [];
            if (uid) {
                selectedUser = await UserModel.getById(domainId, uid);
                if (!selectedUser) throw new NotFoundError(localizedErrorText`user`);
                const dayWindow = shanghaiDayWindow(30);
                const [rows, contestStatuses, trainingStatuses, studentDict] = await Promise.all([
                    RecordModel.coll
                        .aggregate(userStatsPipeline(domainId, uid, STATUS.STATUS_ACCEPTED, objectIdAt(dayWindow.since)), {
                            maxTimeMS: ADMIN_STATS_MAX_TIME_MS,
                        })
                        .toArray(),
                    contest
                        .getMultiStatus(domainId, { uid, attend: { $exists: true } })
                        .project({ docId: 1 })
                        .toArray(),
                    training.getMultiStatus(domainId, { uid, enroll: 1 }).project({ docId: 1 }).toArray(),
                    userbind?.findStudentsByUserIds ? userbind.findStudentsByUserIds(domainId, [uid]) : {},
                ]);
                const [attendedContests, enrolledTrainings] = await Promise.all([
                    contest
                        .getMulti(domainId, {
                            docId: { $in: contestStatuses.map((row) => row.docId) },
                            rule: { $ne: 'homework' },
                        })
                        .project({ docId: 1, title: 1, beginAt: 1, endAt: 1 })
                        .toArray(),
                    training
                        .getMulti(
                            domainId,
                            withProblemSetKind({
                                docId: { $in: trainingStatuses.map((row) => row.docId) },
                            }) as Filter<TrainingDoc>,
                        )
                        .project({ docId: 1, title: 1 })
                        .toArray(),
                ]);
                stats = {
                    ...normalizeUserStats(rows, dayWindow.days),
                    student: studentDict[String(uid)] || null,
                    contests: attendedContests,
                    trainings: enrolledTrainings,
                };
            }
        } else if (view === 'group') {
            if (!userbind?.listUserGroups || !userbind?.findBoundStudentsByGroupIds) {
                throw new Error('userbind group statistics bridge is unavailable');
            }
            groups = await userbind.listUserGroups(domainId);
            const parsedGroupIds = groupIds.map((value) => {
                try {
                    return new ObjectId(value);
                } catch {
                    throw new ValidationError('groupIds');
                }
            });
            const selectedIdSet = new Set(parsedGroupIds.map(String));
            const selectedGroups = groups.filter((group) => selectedIdSet.has(String(group._id)));
            if (selectedGroups.length !== selectedIdSet.size) throw new ValidationError('groupIds');
            if (parsedGroupIds.length) {
                const students: Array<{ boundUserId: number | null; groupIds: ObjectId[] }> = await userbind.findBoundStudentsByGroupIds(
                    domainId,
                    parsedGroupIds,
                );
                const memberUids: number[] = Array.from(
                    new Set(students.flatMap((student) => (student.boundUserId && student.boundUserId > 1 ? [student.boundUserId] : []))),
                );
                const rows = memberUids.length
                    ? await RecordModel.coll
                          .aggregate(groupUserStatsPipeline(domainId, memberUids, STATUS.STATUS_ACCEPTED), { maxTimeMS: ADMIN_STATS_MAX_TIME_MS })
                          .toArray()
                    : [];
                const byUid = new Map(rows.map((row) => [Number(row._id), { total: Number(row.total), accepted: Number(row.accepted) }]));
                stats = selectedGroups.map((group) => {
                    const uids: number[] = Array.from(
                        new Set(
                            students
                                .filter((student) => student.groupIds.some((id) => String(id) === String(group._id)))
                                .flatMap((student) => (student.boundUserId && student.boundUserId > 1 ? [student.boundUserId] : [])),
                        ),
                    );
                    const total = uids.reduce((sum, memberUid) => sum + (byUid.get(memberUid)?.total || 0), 0);
                    const accepted = uids.reduce((sum, memberUid) => sum + (byUid.get(memberUid)?.accepted || 0), 0);
                    return {
                        id: String(group._id),
                        name: group.name,
                        memberCount: uids.length,
                        activeMembers: uids.filter((memberUid) => (byUid.get(memberUid)?.total || 0) > 0).length,
                        averageSubmissions: uids.length ? total / uids.length : 0,
                        averageAccepted: uids.length ? accepted / uids.length : 0,
                    };
                });
            }
        } else if (view === 'dashboard') {
            const dayWindow = shanghaiDayWindow(range);
            const rows = await RecordModel.coll
                .aggregate(dashboardStatsPipeline(domainId, STATUS.STATUS_ACCEPTED, objectIdAt(dayWindow.since)), {
                    maxTimeMS: ADMIN_STATS_MAX_TIME_MS,
                })
                .toArray();
            stats = normalizeDashboardStats(rows, dayWindow.days);
        } else if (view === 'problem') {
            const selectedTag = tag.trim();
            const pdocs = await ProblemModel.getMulti(domainId, selectedTag ? { tag: selectedTag } : {}, [
                'docId',
                'pid',
                'title',
                'tag',
            ] as any).toArray();
            const pids = pdocs.map((problem) => problem.docId);
            const rows = pids.length
                ? await RecordModel.coll
                      .aggregate(
                          problemStatsPipeline(domainId, pids, {
                              accepted: STATUS.STATUS_ACCEPTED,
                              wrongAnswer: STATUS.STATUS_WRONG_ANSWER,
                              timeLimit: STATUS.STATUS_TIME_LIMIT_EXCEEDED,
                              compileError: STATUS.STATUS_COMPILE_ERROR,
                          }),
                          { maxTimeMS: ADMIN_STATS_MAX_TIME_MS },
                      )
                      .toArray()
                : [];
            const byPid = new Map(normalizeProblemStats(rows).map((row) => [row.pid, row]));
            const difficulty = pdocs
                .map((problem) => {
                    const row = byPid.get(problem.docId) || {
                        pid: problem.docId,
                        total: 0,
                        accepted: 0,
                        wrongAnswer: 0,
                        timeLimit: 0,
                        compileError: 0,
                    };
                    return {
                        ...row,
                        displayId: problem.pid || `#${problem.docId}`,
                        title: problem.title,
                        passRate: row.total ? row.accepted / row.total : null,
                    };
                })
                .sort((a, b) => {
                    if (a.passRate === null) return b.passRate === null ? a.pid - b.pid : 1;
                    if (b.passRate === null) return -1;
                    return a.passRate - b.passRate || b.total - a.total || a.pid - b.pid;
                });
            stats = {
                selectedTag,
                difficulty,
                errors: {
                    wrongAnswer: difficulty.reduce((sum, row) => sum + row.wrongAnswer, 0),
                    timeLimit: difficulty.reduce((sum, row) => sum + row.timeLimit, 0),
                    compileError: difficulty.reduce((sum, row) => sum + row.compileError, 0),
                },
            };
        }

        this.response.template = 'admin_stats.html';
        this.response.body = {
            view,
            contests,
            trainings,
            selectedContest,
            selectedTraining,
            stats,
            problems,
            groups,
            userSearchResults,
            selectedUser: selectedUser ? { uid: selectedUser._id, uname: selectedUser.uname } : null,
            q,
            groupIds,
            range,
            tag,
            maxTimeMs: ADMIN_STATS_MAX_TIME_MS,
        };
    }

    private async problemSummaries(domainId: string, pids: number[]) {
        const pdict = await ProblemModel.getList(domainId, pids, true, false, ['docId', 'pid', 'title'] as any, true);
        return pids.map((docId) => ({
            docId,
            pid: pdict[docId]?.pid,
            title: pdict[docId]?.title || `#${docId}`,
        }));
    }
}

export async function apply(ctx: Context) {
    ctx.Route('admin_stats', '/admin/stats', AdminStatsHandler, PRIV.PRIV_EDIT_SYSTEM);
}
