import { rankingDate, rankingDay, rankingWindow, type ActivityBoard, type ActivityRankingPage } from '@hydrooj/common/activity-ranking';
import type { Context } from '../context';
import { ValidationError } from '../error';
import { SUPERADMIN_UID } from '../lib/admin-account';
import avatar from '../lib/avatar';
import { hasRankingFilters, rankingPublicRatings, rankingQuery, RankingQueryError, selectRankingPage, type RankingEntry } from '../lib/domain-ranking';
import { activityStandings } from '../lib/activity-ranking';
import { readPublicActivity } from '../model/activity-ranking';
import { Logger } from '../logger';
import { PERM, PRIV } from '../model/builtin';
import domain from '../model/domain';
import user from '../model/user';
import { Handler, query, Types } from '../service/server';
import { studentDirectory } from '../service/student-directory';

const logger = new Logger('ranking');

export class DomainRankHandler extends Handler {
    @query('page', Types.PositiveInt, true)
    async get(domainId: string, page = 1) {
        const canFilterRanking = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const rpDefinitions = Object.fromEntries(
            Object.entries(global.Hydro.model.rp || {}).map(([key, def]) => [key, { hidden: !!def.hidden }]),
        );
        let filters: ReturnType<typeof rankingQuery>;
        try {
            filters = rankingQuery(this.args, canFilterRanking, Object.keys(rpDefinitions).filter((key) => !rpDefinitions[key].hidden));
        } catch (error) {
            if (!(error instanceof RankingQueryError)) throw error;
            logger.warn('Ranking query rejected domain=%s uid=%d field=%s forbidden=%s', domainId, this.user._id, error.field, error.forbidden);
            if (error.forbidden) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
            throw new ValidationError(error.field);
        }
        // Existing bookmarked sort and directory-filter links belong to the RP standings.
        const legacyQuery = ['sort', 'order', 'q', 'schoolId', 'groupId', 'binding'].some((key) => this.args[key] !== undefined);
        const board = this.args.board ?? (legacyQuery ? 'rp' : 'solves');
        if (board !== 'rp') {
            if (board !== 'solves' && board !== 'newcomers' && board !== 'consistency') throw new ValidationError('board');
            if (legacyQuery) throw new ValidationError('board');
            return await this.activity(domainId, page, board);
        }
        if (this.args.period !== undefined || this.args.date !== undefined) throw new ValidationError('period');
        // Load only the fields used by sorting/filtering across the full ranking.
        // Full renderable User objects are still fetched for the selected page only.
        const ranked = await domain.getMultiUserInDomain(domainId, { $or: [
            { uid: { $gt: SUPERADMIN_UID }, rp: { $gt: 0 }, join: true },
            { uid: SUPERADMIN_UID, rank: { $gt: 0 } },
        ] })
            .project<{ uid: number; rp: number; rank?: number; rpInfo?: Record<string, unknown>; nAccept?: number; nSubmit?: number }>({
                uid: 1, rp: 1, rank: 1, rpInfo: 1, nAccept: 1, nSubmit: 1,
            }).sort({ rp: -1, uid: 1 }).toArray();
        // Earlier RP snapshots counted root. A tie with root keeps its rank. Lower ranks move up one.
        const oldRootRank = ranked.find((row) => row.uid === SUPERADMIN_UID)?.rank ?? 0;
        const publicRank = (rank: number) => oldRootRank > 0 && rank > oldRootRank ? rank - 1 : rank;
        const candidates = ranked.filter((row) => row.uid !== SUPERADMIN_UID);
        const uids = candidates.map((row) => row.uid);
        const rawUsers = await user.getMulti({ _id: { $in: uids } }).project<{
            _id: number; uname: string; bio?: string; externalRating?: unknown;
        }>({ _id: 1, uname: 1, bio: 1, externalRating: 1 }).toArray();
        const userById = new Map(rawUsers.map((row) => [row._id, row]));
        const [students, schools, groups] = canFilterRanking ? await Promise.all([
            studentDirectory().findStudentsByUserIds(domainId, [...new Set([...uids, this.user._id])]),
            studentDirectory().listSchools(domainId),
            studentDirectory().listUserGroups(domainId),
        ]) : [{}, [], []];
        const activeGroups = groups.filter((group) => !group.archivedAt);
        if (filters.schoolId && !schools.some((school) => school._id.toHexString() === filters.schoolId)) throw new ValidationError('schoolId');
        if (filters.groupId && !activeGroups.some((group) => group._id.toHexString() === filters.groupId
            && (!filters.schoolId || group.schoolId.toHexString() === filters.schoolId))) throw new ValidationError('groupId');
        let fallbackRank = 1;
        const entries: RankingEntry[] = candidates.flatMap((row, index) => {
            if (index === 0 || row.rp !== candidates[index - 1].rp) fallbackRank = index + 1;
            const raw = userById.get(row.uid);
            if (!raw) throw new Error(`Ranking user missing: domain=${domainId} uid=${row.uid}`);
            const student = students[row.uid];
            return [{
                ...row,
                rank: typeof row.rank === 'number' && row.rank > 0 ? publicRank(row.rank) : fallbackRank,
                uname: raw.uname,
                bio: raw.bio || '',
                nAccept: row.nAccept ?? 0,
                ratings: rankingPublicRatings(raw.externalRating),
                student: student ? {
                    studentId: student.studentId,
                    realName: student.realName,
                    schoolId: student.schoolId.toHexString(),
                    groupIds: student.groupIds.map((id) => id.toHexString()),
                } : undefined,
            }];
        });
        const pageSize = Number(this.ctx.setting.get('pagination.ranking') || 20);
        const selected = selectRankingPage(entries, filters, page, pageSize);
        const udict = await user.getList(domainId, selected.rows.map((row) => row.uid));
        const udocs = selected.rows.map((row) => ({
            ...udict[row.uid],
            rp: row.rp,
            rpInfo: row.rpInfo,
            rank: row.rank,
            nAccept: row.nAccept,
            nSubmit: row.nSubmit ?? 0,
        }));
        const self = this.user._id > SUPERADMIN_UID && this.user.hasPriv(PRIV.PRIV_USER_PROFILE) && !hasRankingFilters(filters)
            && filters.sort === 'rp' && filters.order === 'desc' && !selected.rows.some((row) => row.uid === this.user._id)
            ? {
                  _id: this.user._id,
                  uname: this.user.uname,
                  avatar: this.user.avatar,
                  rp: this.user.rp,
                  rpInfo: this.user.rpInfo,
                  nAccept: this.user.nAccept,
                  rank: entries.find((row) => row.uid === this.user._id)?.rank,
                  bio: this.user.bio,
              }
            : null;
        const visibleUids = [...selected.rows.map((row) => row.uid), ...(self ? [self._id] : [])];
        const studentDict = canFilterRanking ? Object.fromEntries(visibleUids.flatMap((uid) => {
            const student = students[uid];
            return student ? [[uid, { studentId: student.studentId, realName: student.realName }]] : [];
        })) : {};
        this.response.template = 'ranking.html';
        this.response.body = {
            udocs,
            upcount: selected.pages,
            ucount: selected.count,
            page,
            pageSize,
            rpDefinitions,
            board: 'rp',
            self,
            studentDict,
            sort: filters.sort,
            order: filters.order,
            canFilterRanking,
            ...(canFilterRanking ? {
                filters: { q: filters.q, schoolId: filters.schoolId, groupId: filters.groupId, binding: filters.binding },
                schools: schools.map((school) => ({ id: school._id.toHexString(), name: school.name })),
                groups: activeGroups.map((group) => ({ id: group._id.toHexString(), schoolId: group.schoolId.toHexString(), name: group.name })),
            } : {}),
        };
    }

    private async activity(domainId: string, page: number, board: ActivityBoard) {
        const period = this.args.period ?? 'week';
        if (period !== 'day' && period !== 'week' && period !== 'month') throw new ValidationError('period');
        if (board === 'consistency' && period === 'day') throw new ValidationError('period');
        const today = rankingDate(rankingDay(new Date()));
        const date = this.args.date ?? today;
        if (typeof date !== 'string' || date > today) throw new ValidationError('date');
        let window: ReturnType<typeof rankingWindow>;
        try { window = rankingWindow(period, date); } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            throw new ValidationError('date');
        }
        const pageSize = Number(this.ctx.setting.get('pagination.ranking') || 20);
        if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new ValidationError('pagination.ranking');
        const [{ users, updatedAt }, members] = await Promise.all([
            readPublicActivity(domainId),
            domain.getMultiUserInDomain(domainId, { uid: { $gt: SUPERADMIN_UID }, join: true }).project<{ uid: number }>({ uid: 1 }).toArray(),
        ]);
        const { rows, earliest } = activityStandings(users, board, window, new Set(members.map((member) => member.uid)));
        const pages = Math.ceil(rows.length / pageSize);
        if (page > Math.max(1, pages)) throw new ValidationError('page');
        const selected = rows.slice((page - 1) * pageSize, page * pageSize);
        const profiles = await user.getMulti({ _id: { $in: selected.map((row) => row.uid) } }, ['_id', 'uname', 'avatar']).toArray();
        const names = new Map(profiles.map((profile) => [profile._id, profile]));
        const activity: ActivityRankingPage = {
            board, period, date, window, today, updatedAt: updatedAt.toISOString(),
            earliest: earliest === null ? null : rankingDate(earliest),
            page, pages, count: rows.length,
            mine: rows.find((row) => row.uid === this.user._id) ?? null,
            rows: selected.map((row) => {
                const profile = names.get(row.uid);
                if (!profile) throw new Error(`Ranking user missing: domain=${domainId} uid=${row.uid}`);
                return { ...row, uname: profile.uname, ...(profile.avatar ? { avatarUrl: avatar(profile.avatar, 64) } : {}) };
            }),
        };
        this.response.addHeader('Cache-Control', 'private, no-store');
        this.response.template = 'ranking.html';
        this.response.body = { activity };
    }
}

export function apply(ctx: Context) {
    ctx.Route('ranking', '/ranking', DomainRankHandler, PERM.PERM_VIEW_RANKING);
}
