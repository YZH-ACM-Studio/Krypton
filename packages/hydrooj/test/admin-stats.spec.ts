import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
    ADMIN_STATS_MAX_TIME_MS,
    buildTrainingStats,
    contestStatsPipeline,
    normalizeContestStats,
    trainingAcceptedPairsPipeline,
    trainingEnrollmentPipeline,
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

    it('keeps the server gate, timeout, route, navigation, and UI dimensions wired', () => {
        const handler = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/admin-stats.ts'), 'utf8');
        const page = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/admin-stats.tsx'), 'utf8');
        const resolver = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/resolver.tsx'), 'utf8');
        const sidebar = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/components/layout/sidebar.tsx'), 'utf8');

        expect(ADMIN_STATS_MAX_TIME_MS).to.equal(5_000);
        expect(handler).to.include('this.checkPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(handler).to.include("ctx.Route('admin_stats', '/admin/stats', AdminStatsHandler, PRIV.PRIV_EDIT_SYSTEM)");
        expect(handler.match(/maxTimeMS: ADMIN_STATS_MAX_TIME_MS/g)).to.have.lengthOf(3);
        expect(handler).not.to.match(/catch\s*\{/);
        for (const label of ['总提交', 'AC 提交', '参赛人数', '每题通过分布', '按小时提交曲线', '语言分布']) {
            expect(page).to.include(label);
        }
        for (const label of ['报名人数', '每题完成人数', '完成率分布', '成员进度榜']) {
            expect(page).to.include(label);
        }
        expect(resolver).to.include("'admin_stats.html': AdminStatsPage");
        expect(sidebar).to.include("href: '/admin/stats'");
    });
});
