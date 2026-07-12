import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('P4.5 Vigil all-contests contracts', () => {
    it('exposes a site-admin-only paginated OJ contest endpoint', () => {
        const handler = read('packages/hydrooj/src/handler/vigil-integration.ts');
        const section = handler.slice(handler.indexOf('class VigilAdminContestsHandler'), handler.indexOf('class VigilAdminExamDetailHandler'));

        expect(section).to.include('this.checkPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(section).to.include('docType: document.TYPE_CONTEST');
        expect(section).to.include('new RegExp(escapeRegExp(query)');
        expect(section).to.include('.skip((page - 1) * VIGIL_CONTESTS_PAGE_SIZE)');
        expect(section).to.include('.limit(VIGIL_CONTESTS_PAGE_SIZE)');
        expect(section).to.include('document.coll.countDocuments(filter)');
        expect(section).to.include('.sort({ beginAt: -1, docId: -1 })');
        expect(handler).to.include("ctx.Route('admin_vigil_contests', '/api/admin/vigil/contests', VigilAdminContestsHandler, PRIV.PRIV_EDIT_SYSTEM)");
    });

    it('renders the searchable all-contests tab and reuses the existing detail route', () => {
        const page = read('packages/ui-next/src/pages/vigil/index.tsx');

        expect(page).to.include("{ value: 'all', label: '全部比赛', href: '/admin/vigil?view=all' }");
        expect(page).to.match(/fetch\(`\/api\/admin\/vigil\/contests\?\$\{params\}`/);
        expect(page).to.include('placeholder="搜索比赛标题"');
        expect(page).to.include('第 {page} / {totalPages} 页');
        expect(page).to.match(/`\/admin\/vigil\/exams\/\$\{encodeURIComponent\(contest\.examId\)\}`/);
    });

    it('keeps recordings reachable even when a contest has no student cards', () => {
        const page = read('packages/ui-next/src/pages/vigil/index.tsx');

        expect(page).to.include("type SecondaryView = 'sessions' | 'approvals' | 'events' | 'recordings'");
        expect(page).to.include("secondary === 'recordings' ? listContestRecordings(examId) : Promise.resolve([])");
        expect(page).to.include('{ value: \'recordings\', label: \'录像\' }');
        expect(page).to.include('buildRecordingUrl(recording.filename)');
        expect(page).to.include('recordingsQ.offlineErr');
        expect(page).to.include('<OfflineBanner err={recordingsQ.offlineErr} onRetry={recordingsQ.retry} />');
        expect(page).to.include('此比赛暂无录像。');
    });

    it('clears stale error variants before each Vigil request', () => {
        const page = read('packages/ui-next/src/pages/vigil/index.tsx');
        const hook = page.slice(page.indexOf('function useVigilData'), page.indexOf('function Stat'));

        expect(hook).to.match(/setLoading\(true\);\s*setOfflineErr\(null\);\s*setErr\(null\);\s*loader\(\)/);
        expect(hook).to.include('if (e instanceof VigilOfflineError) setOfflineErr(e)');
        expect(hook).to.include("else setErr(e?.message || '加载失败')");
    });
});
