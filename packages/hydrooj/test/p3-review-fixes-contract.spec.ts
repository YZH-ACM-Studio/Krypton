import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

function readSrc(relative: string) {
    return readFileSync(resolve(__dirname, '..', relative), 'utf8');
}

describe('P3 review must-fix contracts', () => {
    it('activates problem-set nav by template prefix and keeps old training templates as wrappers', () => {
        expect(readSrc('src/lib/ui.ts')).to.include("prefix: 'problem_set'");
        expect(readSrc('../ui-default/templates/training_main.html')).to.include('problem_set_main.html');
        expect(readSrc('../ui-default/templates/training_detail.html')).to.include('problem_set_detail.html');
        const overlay = readSrc('../ui-default/locales/zh.yaml');
        expect(overlay).to.include('Create Training Plan: 创建题集');
        expect(overlay).to.include('Create training plans: 创建题集');
        expect(overlay).to.include('Edit training plans: 修改题集');
        expect(overlay).to.include('View training plans: 查看题集');
        expect(overlay).not.to.include('训练计划');
        expect(overlay).to.include('You can create your own training plans and share them with others.: 您可以创建自己的题集并与他人分享。');
    });

    it('gates training discussion vnodes through the problem-set access service', () => {
        const source = readSrc('src/model/discussion.ts');
        expect(source).to.include('problemSetAccessService.assertAccessible');
        expect(source).to.include("if (!isProblemSetKind(tdoc.kind)) throw new DiscussionNodeNotFoundError");
        expect(source).to.include('DiscussionNodeNotFoundError');
        expect(source).to.include('training discussion vnode reads require the current user');
        expect(source).to.include('filterDiscussionsByVnodes');
    });

    it('renders redemption manage mutations as the manage page and redacts plaintext fields', () => {
        const handler = readSrc('src/handler/redemption.ts');
        expect(handler).to.include('private async renderManage');
        expect(handler).to.include('await this.renderManage(');
        const sanitizer = readSrc('src/lib/credential-sanitizer.ts');
        expect(sanitizer).to.include("'manualcodes'");
        expect(sanitizer).to.include("'plaintext'");
        expect(sanitizer).to.include("'csv'");
    });

    it('pins freeze CAS to the granted target before issuing entitlements', () => {
        const source = readSrc('src/model/redemption.ts');
        expect(source).to.include('freezeTargetFilter');
        expect(source).to.include('freezeTargetMatches');
        expect(source).to.include('批次状态已变化');
        expect(source).to.match(/await this\.markFirstRedeemed\(batch\);\s*const entitlementIds/);
        expect(source).to.include('await training.ensureEnrolled(input.domainId, tdoc.docId, input.uid)');
    });
});
