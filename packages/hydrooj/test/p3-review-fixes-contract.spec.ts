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
        expect(readSrc('../ui-default/templates/training_roster.html')).to.include('problem_set_roster.html');
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
        expect(source).to.include('if (!isProblemSetKind(tdoc.kind)) throw new DiscussionNodeNotFoundError');
        expect(source).to.include('DiscussionNodeNotFoundError');
        expect(source).to.include('training discussion vnode reads require the current user');
        expect(source).to.include('filterDiscussionsByVnodes');
        expect(source).to.include('PERM.PERM_MOD_BADGE');
        expect(source).to.include('vnode.hidden');
        expect(source).to.include('if (error instanceof ContestNotFoundError) throw new DiscussionNodeNotFoundError');
        expect(source).to.include("error.name === 'ContestNotFoundError'");
        expect(source).to.include('isTrainingDiscussionAccessError');
        expect(source).to.include('TrainingNotFoundError');
        expect(source).to.include('new Set(user.group || [])');
        expect(source).to.include('if (!checkVNodeVisibility(ddoc.parentType, vnode, user)) return');
        expect(source).to.include('user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(source).to.include('PERM.PERM_EDIT_CONTEST');
        expect(source).to.include('assertHomeworkAccess(domainId, tdoc, userOrUid)');
        expect(source).to.include('homework discussion vnode reads require the current user');
        expect(source).to.include('vnode.hidden');
        const visibility = source.slice(source.indexOf('export function checkVNodeVisibility'), source.indexOf('export function apply(ctx: Context)'));
        expect(visibility).to.include('vnode.hidden');
        expect(visibility).to.include('PERM.PERM_MOD_BADGE');
    });

    it('renders redemption manage mutations as the manage page and redacts plaintext fields', () => {
        const handler = readSrc('src/handler/redemption.ts');
        expect(handler).to.include('private async renderManage');
        expect(handler).to.include('await this.renderManage(');
        expect(handler).to.include("param('uid', Types.PositiveInt, true)");
        expect(handler).to.include('listActiveForUser');
        expect(handler).to.include('redemptionService.listBatches');
        expect(handler).to.include('redemptionLookupSourceIds(batches)');
        expect(handler).to.include("row.source === 'redemption' && allowedSourceIds.has(String(row.sourceId))");
        expect(handler).to.include('entitlementId: String(row._id)');
        expect(handler).to.include('sourceId: String(row.sourceId)');
        const lookupAt = handler.indexOf('listActiveForUser');
        const mapped = handler.slice(lookupAt, handler.indexOf('postCreate', lookupAt));
        expect(mapped).to.include('target:');
        expect(mapped).not.to.match(/\bcode\b/);
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
        expect(source).to.match(/await this\.markFirstRedeemed\(\{ \.\.\.batch, \.\.\.claimed \}\);/);
        expect(source).to.include('claimedTarget');
        expect(source).to.include('...this.claimPin(batch)');
        expect(source).to.include('await training.ensureEnrolled(input.domainId, tdoc.docId, input.uid)');
    });
});
