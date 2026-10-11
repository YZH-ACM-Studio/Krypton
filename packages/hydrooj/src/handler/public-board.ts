import { ObjectId } from 'mongodb';
import { Context } from '../context';
import { NotFoundError } from '../error';
import type { ProblemDoc } from '../interface';
import { buildPublicBoard, LUCKY_BIG_RANKS, LUCKY_YUAN, type PublicBoardTier } from '../lib/public-contest-board';
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
    tiers: PublicBoardTier[];
}

const GPLT_TIERS = (l1: number, l2: number, l3: number): PublicBoardTier[] => [
    { label: 'L1', name: '基础级', count: l1 },
    { label: 'L2', name: '进阶级', count: l2 },
    { label: 'L3', name: '登顶级', count: l3 },
];

export const PUBLIC_BOARDS: Readonly<Record<string, PublicBoardEntry>> = {
    'caucgplt/2026': {
        overline: 'CAUC · GPLT 2026',
        domainId: 'system',
        tid: '6aa0beed2f2f1ea8af181532',
        tiers: GPLT_TIERS(9, 4, 3),
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
        const tdoc = await contest.get(entry.domainId, new ObjectId(entry.tid));
        if (tdoc.rule !== 'ioi' || contest.getParticipationMode(tdoc) !== 'individual') {
            throw new Error(`Public board ${key} must point at an individual IOI contest, found rule ${tdoc.rule}.`);
        }
        const now = new Date();
        // Same gate as the contest scoreboard for an outsider: ended, not hidden, and the freeze lifted.
        const published = contest.RULES.ioi.showScoreboard(tdoc, now) && !contest.isLocked(tdoc, now);
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
        const board = buildPublicBoard(tdoc, pdict, statuses, entry.tiers);
        const uids = board.rows.map((row) => row.uid);
        const [udict, students] = await Promise.all([
            UserModel.getList(entry.domainId, uids),
            studentDirectory().findStudentsByUserIds(entry.domainId, uids),
        ]);
        this.response.body = {
            board: {
                ...header,
                maxScore: board.maxScore,
                entrants: board.rows.length,
            },
            tiers: board.tiers,
            columns: board.columns.map((column) => ({ ...column, title: pdict[column.pid].title })),
            rows: board.rows.map((row) => ({
                ...row,
                uname: udict[row.uid].uname,
                studentId: students[String(row.uid)]?.studentId ?? null,
                realName: students[String(row.uid)]?.realName ?? null,
            })),
            awards: board.awards,
            lucky: { bigRanks: [...LUCKY_BIG_RANKS], yuan: LUCKY_YUAN },
        };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('public_board', '/board/:series/:year', PublicBoardHandler);
}
