import { localizedErrorText, PermissionError, ValidationError } from '../error';
import { Logger } from '../logger';
import { PERM, PRIV } from '../model/builtin';
import problem from '../model/problem';
import { setProblemSchoolBank } from '../model/problem-school-bank';
import { Handler, param, Types } from '../service/server';

const logger = new Logger('problem-school-bank');

export class ProblemSchoolBankHandler extends Handler {
    // Types.Boolean marks itself optional, so a literal false would be dropped.
    @param('docIds', Types.NumericArray)
    @param('shared', Types.Boolean, false)
    async post(_domainId: string, docIds: number[], shared: boolean) {
        if (this.request.json !== true) throw new ValidationError('body', null, localizedErrorText`请使用 JSON 提交。`);
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (
            !problem.canBrowseProblemBank(this.user) ||
            (!this.user.hasPerm(PERM.PERM_CREATE_PROBLEM) && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM))
        ) {
            throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        }
        const result = await setProblemSchoolBank(domainId, this.user, docIds, shared);
        logger.info(
            'School bank share domain=%s actor=%d shared=%s changed=%d unchanged=%d result=ok',
            domainId,
            this.user._id,
            shared,
            result.changed.length,
            result.unchanged.length,
        );
        this.response.body = { changed: result.changed, unchanged: result.unchanged };
    }
}

export async function apply(ctx: {
    Route: (name: string, path: string, HandlerClass: typeof ProblemSchoolBankHandler) => void;
}) {
    ctx.Route('problem_school_bank', '/problem/school-bank', ProblemSchoolBankHandler);
}
