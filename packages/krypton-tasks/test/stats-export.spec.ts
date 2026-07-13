import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { buildTaskStatsCsv, defaultTaskGroupName, shanghaiNaturalDate } from '../src/stats-export';

describe('P1.6 task statistics CSV export', () => {
    it('emits UTF-8 BOM and CRLF while preserving Chinese and CSV escaping', () => {
        const csv = buildTaskStatsCsv([
            {
                userId: 42,
                username: '张"三',
                studentId: '24000001',
                realName: '张三',
                status: 'completed',
                completedNodes: 3,
                totalNodes: 3,
                completedAt: '2026-07-13T00:00:00.000Z',
                note: '第一行\n第二行',
            },
        ]);

        expect(Array.from(Buffer.from(csv).subarray(0, 3))).to.deep.equal([0xef, 0xbb, 0xbf]);
        expect(csv).to.include('张""三');
        expect(csv).to.include('第一行\r\n第二行');
        expect(csv.replaceAll('\r\n', '')).not.to.include('\n');
        expect(csv.endsWith('\r\n')).to.equal(true);
    });

    it('neutralizes Excel formula prefixes even after leading whitespace', () => {
        const csv = buildTaskStatsCsv([
            {
                userId: 7,
                username: '=HYPERLINK("https://example.invalid")',
                studentId: '+24000002',
                realName: ' @SUM(1,1)',
                status: 'pending',
                completedNodes: 0,
                totalNodes: 1,
                completedAt: '',
                note: '-1+1',
            },
        ]);

        expect(csv).to.include("'=HYPERLINK");
        expect(csv).to.include("'+24000002");
        expect(csv).to.include("' @SUM(1,1)");
        expect(csv).to.include("'-1+1");
    });

    it('uses the Asia/Shanghai natural date for the default group name', () => {
        const boundary = new Date('2026-07-12T16:00:00.000Z');
        expect(shanghaiNaturalDate(boundary)).to.equal('2026-07-13');
        expect(defaultTaskGroupName('暑期任务', boundary)).to.equal('暑期任务 2026-07-13');
    });
});

describe('P1.6 task statistics UI contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/admin-tasks/index.tsx'), 'utf8');

    it('renders the group export only from the server capability and posts the dedicated operation', () => {
        expect(source).to.include('{data.canExportUserGroup && (');
        expect(source).to.include('name="operation" value="export_group"');
        expect(source).to.include('exportUserGroupDefaultName');
    });
});
