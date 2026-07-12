import { Filter, ObjectId } from 'mongodb';
import { Context } from '../context';
import { NotFoundError } from '../error';
import { TrainingDoc } from '../interface';
import {
    ADMIN_STATS_MAX_TIME_MS,
    buildTrainingStats,
    contestStatsPipeline,
    normalizeContestStats,
    trainingAcceptedPairsPipeline,
    trainingEnrollmentPipeline,
} from '../lib/admin-stats';
import { Handler, param, Types } from '../service/server';
import { PRIV, STATUS } from '../model/builtin';
import * as contest from '../model/contest';
import * as document from '../model/document';
import ProblemModel from '../model/problem';
import RecordModel from '../model/record';
import * as training from '../model/training';
import UserModel from '../model/user';

const STATS_VIEWS = ['contest', 'training'] as const;
type StatsView = typeof STATS_VIEWS[number];

class AdminStatsHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    @param('view', Types.Range([...STATS_VIEWS]), true)
    @param('contestId', Types.ObjectId, true)
    @param('trainingId', Types.ObjectId, true)
    async get(domainId: string, view: StatsView = 'contest', contestId?: ObjectId, trainingId?: ObjectId) {
        const trainingFilter: Filter<TrainingDoc> = { kind: { $ne: 'course' } };
        const [contests, trainings] = await Promise.all([
            contest.getMulti(domainId, { rule: { $ne: 'homework' } }).project({ docId: 1, title: 1, beginAt: 1, endAt: 1, rule: 1 }).toArray(),
            training.getMulti(domainId, trainingFilter).project({ docId: 1, title: 1 }).toArray(),
        ]);

        const selectedContestId = view === 'contest' ? contestId || contests[0]?.docId : undefined;
        const selectedTrainingId = view === 'training' ? trainingId || trainings[0]?.docId : undefined;
        let selectedContest: any = null;
        let selectedTraining: any = null;
        let stats: any = null;
        let problems: Array<{ docId: number; pid?: string; title: string }> = [];

        if (selectedContestId) {
            selectedContest = await contest.get(domainId, selectedContestId);
            if (selectedContest.rule === 'homework') throw new NotFoundError('contest');
            const rows = await RecordModel.coll.aggregate(
                contestStatsPipeline(domainId, selectedContestId, STATUS.STATUS_ACCEPTED),
                { maxTimeMS: ADMIN_STATS_MAX_TIME_MS },
            ).toArray();
            stats = normalizeContestStats(rows);
            const byProblem = new Map(stats.byProblem.map((row) => [row.pid, row]));
            stats.byProblem = (selectedContest.pids || []).map((pid) => byProblem.get(pid) || { pid, total: 0, accepted: 0 });
            problems = await this.problemSummaries(domainId, selectedContest.pids || []);
        } else if (selectedTrainingId) {
            selectedTraining = await training.get(domainId, selectedTrainingId);
            if (selectedTraining.kind === 'course') throw new NotFoundError('training');
            const pids = training.getPids(selectedTraining.dag || []);
            const enrollmentRows = await document.collStatus.aggregate(
                trainingEnrollmentPipeline(domainId, selectedTrainingId),
                { maxTimeMS: ADMIN_STATS_MAX_TIME_MS },
            ).toArray();
            const memberUids = enrollmentRows.map((row) => Number(row._id));
            const acceptedRows = memberUids.length && pids.length
                ? await document.collStatus.aggregate(
                    trainingAcceptedPairsPipeline(domainId, memberUids, pids, STATUS.STATUS_ACCEPTED),
                    { maxTimeMS: ADMIN_STATS_MAX_TIME_MS },
                ).toArray()
                : [];
            const userbind = (global as any).Hydro?.model?.userbind;
            if (!userbind?.findStudentsByUserIds) throw new Error('userbind.findStudentsByUserIds is required for admin training statistics');
            const [udict, studentDict] = await Promise.all([
                UserModel.getListForRender(domainId, memberUids, false),
                userbind.findStudentsByUserIds(domainId, memberUids),
            ]);
            const identities = memberUids.map((uid) => {
                const user = udict[uid];
                if (!user) throw new Error(`Training enrollee user is missing: uid=${uid}`);
                const student = studentDict[String(uid)];
                return {
                    uid,
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
