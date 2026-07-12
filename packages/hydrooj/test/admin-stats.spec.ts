import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
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
} from '../src/lib/admin-stats';

describe('admin statistics aggregation contracts', () => {
    it('builds one contest facet for all required dimensions and uses the provided accepted status', () => {
        const pipeline = contestStatsPipeline('system', 'contest-id', 12);
        expect(pipeline).to.have.lengthOf(2);
        expect(pipeline[0]).to.deep.equal({ $match: { domainId: 'system', contest: 'contest-id' } });
        const source = JSON.stringify(pipeline[1]);
        expect(source).to.include('overall');
        expect(source).to.include('byProblem');
        expect(source).to.include('byHour');
        expect(source).to.include('byLanguage');
        expect(source).to.include('Asia/Shanghai');
        expect(source).to.include('12');
    });

    it('normalizes an empty or populated contest facet without NaN values', () => {
        expect(normalizeContestStats([])).to.deep.equal({
            total: 0,
            accepted: 0,
            participants: 0,
            byProblem: [],
            byHour: [],
            byLanguage: [],
        });
        expect(normalizeContestStats([{
            overall: [{ total: 10, accepted: 4, participants: 3 }],
            byProblem: [{ _id: 7, total: 6, accepted: 2 }],
            byHour: [{ _id: '2026-07-13T01', count: 5 }],
            byLanguage: [{ _id: 'cpp', count: 8 }],
        }])).to.deep.equal({
            total: 10,
            accepted: 4,
            participants: 3,
            byProblem: [{ pid: 7, total: 6, accepted: 2 }],
            byHour: [{ hour: '2026-07-13T01', count: 5 }],
            byLanguage: [{ language: 'cpp', count: 8 }],
        });
    });

    it('deduplicates training AC pairs and builds stable member progress', () => {
        const stats = buildTrainingStats(
            [
                { uid: 3, uname: 'beta', studentId: '3' },
                { uid: 2, uname: 'alpha', studentId: '2' },
                { uid: 4, uname: 'gamma', studentId: '4' },
            ],
            [10, 11, 10, 12],
            [
                { uid: 2, pid: 10 },
                { uid: 2, pid: 10 },
                { uid: 2, pid: 11 },
                { uid: 2, pid: 12 },
                { uid: 3, pid: 10 },
                { uid: 4, pid: 999 },
            ],
        );
        expect(stats.enrollmentCount).to.equal(3);
        expect(stats.problemCount).to.equal(3);
        expect(stats.byProblem).to.deep.equal([
            { pid: 10, completed: 2 },
            { pid: 11, completed: 1 },
            { pid: 12, completed: 1 },
        ]);
        expect(stats.members.map((member) => [member.uid, member.done, member.progress])).to.deep.equal([
            [2, 3, 100],
            [3, 1, 33],
            [4, 0, 0],
        ]);
        expect(stats.progressDistribution).to.deep.include.members([
            { label: '0%', count: 1 },
            { label: '26–50%', count: 1 },
            { label: '100%', count: 1 },
        ]);
    });

    it('scopes training pipelines to enrollments and unique accepted uid/problem pairs', () => {
        expect(trainingEnrollmentPipeline('system', 'training-id')[0]).to.deep.equal({
            $match: { domainId: 'system', docType: 40, docId: 'training-id', uid: { $gt: 1 }, enroll: 1 },
        });
        const accepted = trainingAcceptedPairsPipeline('system', [2, 3], [10, 11], 12);
        expect(accepted[0]).to.deep.equal({
            $match: {
                domainId: 'system',
                docType: 10,
                uid: { $in: [2, 3] },
                docId: { $in: [10, 11] },
                status: 12,
            },
        });
        expect(accepted[1]).to.deep.equal({ $group: { _id: { uid: '$uid', pid: '$docId' } } });
    });

    it('builds and normalizes per-user and dashboard facets', () => {
        const userPipeline = userStatsPipeline('system', 42, 1, 'since-id');
        expect(userPipeline[0]).to.deep.equal({ $match: { domainId: 'system', uid: 42 } });
        expect(JSON.stringify(userPipeline[1])).to.include('activeDays');
        expect(JSON.stringify(userPipeline[1])).to.include('since-id');
        expect(normalizeUserStats([{
            overall: [{ total: 8, accepted: 3, activeDays: 4 }],
            byDay: [{ _id: '2026-07-12', total: 2, accepted: 1 }],
        }])).to.deep.equal({
            total: 8,
            accepted: 3,
            activeDays: 4,
            byDay: [{ day: '2026-07-12', total: 2, accepted: 1 }],
        });

        const dashboard = dashboardStatsPipeline('system', 1, 'since-id');
        expect(dashboard[0]).to.deep.equal({ $match: { domainId: 'system' } });
        expect(JSON.stringify(dashboard[1])).to.include('activeUsers');
        expect(normalizeDashboardStats([{
            overall: [{ total: 10, accepted: 5, participants: 3 }],
            byDay: [{ _id: '2026-07-12', total: 4, accepted: 2, activeUsers: 2 }],
        }])).to.deep.equal({
            total: 10,
            accepted: 5,
            participants: 3,
            byDay: [{ day: '2026-07-12', total: 4, accepted: 2, activeUsers: 2 }],
        });
    });

    it('uses strict Shanghai natural-day windows and fills inactive days with zeroes', () => {
        const window = shanghaiDayWindow(3, new Date('2026-07-13T17:30:00.000Z'));
        expect(window.since.toISOString()).to.equal('2026-07-11T16:00:00.000Z');
        expect(window.days).to.deep.equal(['2026-07-12', '2026-07-13', '2026-07-14']);

        const user = normalizeUserStats([{
            overall: [{ total: 2, accepted: 1, activeDays: 1 }],
            byDay: [{ _id: '2026-07-13', total: 2, accepted: 1 }],
        }], window.days);
        expect(user.byDay).to.deep.equal([
            { day: '2026-07-12', total: 0, accepted: 0 },
            { day: '2026-07-13', total: 2, accepted: 1 },
            { day: '2026-07-14', total: 0, accepted: 0 },
        ]);

        const dashboard = normalizeDashboardStats([{
            overall: [{ total: 2, accepted: 1, participants: 1 }],
            byDay: [{ _id: '2026-07-12', total: 2, accepted: 1, activeUsers: 1 }],
        }], window.days);
        expect(dashboard.byDay).to.deep.equal([
            { day: '2026-07-12', total: 2, accepted: 1, activeUsers: 1 },
            { day: '2026-07-13', total: 0, accepted: 0, activeUsers: 0 },
            { day: '2026-07-14', total: 0, accepted: 0, activeUsers: 0 },
        ]);
        expect(shanghaiDayWindow(30, new Date('2026-07-13T17:30:00.000Z')).days).to.have.lengthOf(30);
        expect(shanghaiDayWindow(90, new Date('2026-07-13T17:30:00.000Z')).days).to.have.lengthOf(90);
    });

    it('scopes group and problem aggregations and preserves error counts', () => {
        const groups = groupUserStatsPipeline('system', [2, 3], 1);
        expect(groups[0]).to.deep.equal({ $match: { domainId: 'system', uid: { $in: [2, 3] } } });
        expect(JSON.stringify(groups[1])).to.include('accepted');

        const problems = problemStatsPipeline('system', [10, 11], {
            accepted: 1,
            wrongAnswer: 2,
            timeLimit: 3,
            compileError: 7,
        });
        expect(problems[0]).to.deep.equal({ $match: { domainId: 'system', pid: { $in: [10, 11] } } });
        expect(JSON.stringify(problems[1])).to.include('wrongAnswer');
        expect(JSON.stringify(problems[1])).to.include('timeLimit');
        expect(JSON.stringify(problems[1])).to.include('compileError');
        expect(normalizeProblemStats([{
            _id: 10,
            total: 12,
            accepted: 5,
            wrongAnswer: 4,
            timeLimit: 2,
            compileError: 1,
        }])).to.deep.equal([{
            pid: 10,
            total: 12,
            accepted: 5,
            wrongAnswer: 4,
            timeLimit: 2,
            compileError: 1,
        }]);
    });

    it('keeps the server gate, timeout, route, navigation, and UI dimensions wired', () => {
        const handler = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/admin-stats.ts'), 'utf8');
        const page = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/admin-stats.tsx'), 'utf8');
        const resolver = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/resolver.tsx'), 'utf8');
        const sidebar = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/components/layout/sidebar.tsx'), 'utf8');
        const userbindModel = readFileSync(resolve(process.cwd(), 'packages/krypton-userbind/src/model.ts'), 'utf8');

        expect(ADMIN_STATS_MAX_TIME_MS).to.equal(5_000);
        expect(handler).to.include('this.checkPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(handler).to.include("ctx.Route('admin_stats', '/admin/stats', AdminStatsHandler, PRIV.PRIV_EDIT_SYSTEM)");
        expect(handler.match(/maxTimeMS: ADMIN_STATS_MAX_TIME_MS/g)).to.have.lengthOf(7);
        expect(handler).not.to.match(/catch(?:\s*\([^)]*\))?\s*\{\s*\}/);
        for (const label of ['总提交', 'AC 提交', '参赛人数', '每题通过分布', '按小时提交曲线', '语言分布']) {
            expect(page).to.include(label);
        }
        for (const label of ['报名人数', '每题完成人数', '完成率分布', '成员进度榜']) {
            expect(page).to.include(label);
        }
        for (const label of ['按人', '班级组', '大盘', '按题目', '导出 CSV', '日活跃用户', '错误类型占比']) {
            expect(page).to.include(label);
        }
        expect(page).to.include('if (/^[=+\\-@\\t\\r]/.test(text))');
        expect(handler).to.include('\'contest\', \'training\', \'user\', \'group\', \'dashboard\', \'problem\'');
        expect(userbindModel).to.include('findBoundStudentsByGroupIds');
        expect(userbindModel).to.include('boundUserId: { $gt: 1 }');
        expect(resolver).to.include("'admin_stats.html': AdminStatsPage");
        expect(sidebar).to.include("href: '/admin/stats'");
    });
});
