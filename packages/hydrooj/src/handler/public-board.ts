import { ObjectId } from 'mongodb';
import { Context } from '../context';
import { NotFoundError } from '../error';
import type { ProblemDoc } from '../interface';
import { CAUC_GPLT_2026_REGISTRATIONS } from '../lib/public-board-caucgplt-2026';
import { buildPublicBoard, LUCKY_BIG_RANKS, LUCKY_YUAN } from '../lib/public-contest-board';
import { PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import ProblemModel from '../model/problem';
import UserModel from '../model/user';
import { Handler, param, Types } from '../service/server';
import { studentDirectory } from '../service/student-directory';

/**
 * Public showcase boards, one per finished individual IOI contest.
 * A new year is one more entry here. Unofficial (打星) participants come from
 * the contest's own `unrank`, so saving the star roster updates the board.
 */
interface PublicBoardEntry {
    overline: string;
    domainId: string;
    tid: string;
    registrations: Readonly<Record<string, { readonly college: string; readonly major: string }>>;
    nationalScoreYear: number;
}

/** Existing cross-plugin reader exposed by krypton-tasks; scores stay in its canonical store. */
interface GpltScoreReader {
    listGpltScores(domainId: string, options: { studentDocIds: ObjectId[]; level: 'national' }): Promise<Array<{
        studentDocId: ObjectId;
        year: number;
        score: number;
    }>>;
}

export const PUBLIC_BOARDS: Readonly<Record<string, PublicBoardEntry>> = {
    'caucgplt/2026': {
        overline: 'CAUC · GPLT 2026',
        domainId: 'system',
        tid: '6aa0beed2f2f1ea8af181532',
        registrations: CAUC_GPLT_2026_REGISTRATIONS,
        nationalScoreYear: 2026,
    },
};

const PROBLEM_FIELDS: Array<keyof ProblemDoc> = ['docId', 'title', 'config'];

class PublicBoardHandler extends Handler {
    noCheckPermView = true;

    @param('series', Types.Key)
    @param('year', Types.PositiveInt)
    async get(_domainId: string, series: string, year: number) {
        const key = `${series}/${year}`;
        const entry = PUBLIC_BOARDS[key];
        if (!entry) throw new NotFoundError('board', key);
        // This URL has a private administrator projection as well as a public one.
        this.response.addHeader('Cache-Control', 'private, no-store');
        const tdoc = await contest.get(entry.domainId, new ObjectId(entry.tid));
        if (tdoc.rule !== 'ioi' || contest.getParticipationMode(tdoc) !== 'individual') {
            throw new Error(`Public board ${key} must point at an individual IOI contest, found rule ${tdoc.rule}.`);
        }
        const now = new Date();
        // A final board: the contest has ended and its freeze is lifted. IOI ignores keepScoreboardHidden,
        // and its scoreboard is open from the start, so the end time is checked here on its own.
        const published = contest.isDone(tdoc) && !contest.isLocked(tdoc, now);
        this.response.template = 'public_board.html';
        const header = {
            overline: entry.overline,
            title: tdoc.title,
            beginAt: tdoc.beginAt.toISOString(),
            endAt: tdoc.endAt.toISOString(),
            problemCount: tdoc.pids.length,
            published,
        };
        if (!published) {
            this.response.body = { board: header };
            return;
        }

        const [pdict, statuses] = await Promise.all([
            ProblemModel.getList(entry.domainId, tdoc.pids, true, true, PROBLEM_FIELDS, true),
            contest.getMultiStatus(entry.domainId, { docId: tdoc.docId }).toArray(),
        ]);
        const board = buildPublicBoard(tdoc, pdict, statuses);
        const uids = board.rows.map((row) => row.uid);
        const [udict, students] = await Promise.all([
            UserModel.getList(entry.domainId, uids),
            studentDirectory().findStudentsByUserIds(entry.domainId, uids),
        ]);
        let nationalScores: { year: number; byUid: Record<number, number> } | undefined;
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            nationalScores = { year: entry.nationalScoreYear, byUid: {} };
            const eligible = board.rows.filter((row) => row.rank !== null && students[String(row.uid)]);
            // listGpltScores treats an empty ID list as unfiltered: never call it for an empty roster.
            if (eligible.length) {
                const tasks = (global.Hydro.model as typeof global.Hydro.model & { tasks?: GpltScoreReader }).tasks;
                if (!tasks?.listGpltScores) throw new Error(`Public board ${key}: GPLT score reader is unavailable.`);
                const uidByStudent = new Map(eligible.map((row) => [String(students[String(row.uid)]._id), row.uid]));
                const scores = await tasks.listGpltScores(entry.domainId, {
                    studentDocIds: eligible.map((row) => students[String(row.uid)]._id),
                    level: 'national',
                });
                for (const score of scores) {
                    if (score.year !== entry.nationalScoreYear) continue;
                    const uid = uidByStudent.get(String(score.studentDocId));
                    if (uid === undefined) continue;
                    if (!Number.isFinite(score.score) || score.score < 0 || Object.hasOwn(nationalScores.byUid, uid)) {
                        throw new Error(`Public board ${key}: invalid or duplicate national score for uid ${uid}.`);
                    }
                    nationalScores.byUid[uid] = score.score;
                }
            }
        }
        this.response.body = {
            board: {
                ...header,
                maxScore: board.maxScore,
                entrants: board.rows.length,
            },
            columns: board.columns.map((column) => ({ ...column, title: pdict[column.pid].title })),
            rows: board.rows.map((row) => {
                const student = students[String(row.uid)];
                const registration = student ? entry.registrations[student.studentId] : undefined;
                return {
                    ...row,
                    uname: udict[row.uid].uname,
                    studentId: student?.studentId ?? null,
                    realName: student?.realName ?? null,
                    college: registration?.college ?? null,
                    major: registration?.major ?? null,
                };
            }),
            awards: board.awards,
            lucky: { bigRanks: [...LUCKY_BIG_RANKS], yuan: LUCKY_YUAN },
            ...(nationalScores ? { nationalScores } : {}),
        };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('public_board', '/board/:series/:year', PublicBoardHandler);
}
