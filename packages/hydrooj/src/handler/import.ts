import { sleep } from '@hydrooj/utils';
import { Context } from '../context';
import { PermissionError, ValidationError } from '../error';
import { PERM, PRIV } from '../model/builtin';
import MessageModel from '../model/message';
import problem from '../model/problem';
import { Handler, param, Types } from '../service/server';

export class ProblemImportHydroHandler extends Handler {
    async get() {
        if (!problem.canImportProblems(this.user)) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        this.response.body = {
            knowledgeMaps: await problem.listKnowledgeMapsForProblemSelection(),
            canKeepOriginalAuthor: problem.canAssignManagedAuthor(this.user),
        };
        this.response.template = 'problem_import.html';
    }

    @param('keepUser', Types.Boolean)
    @param('knowledgeMapId', Types.String)
    async post(domainId: string, keepUser: boolean, knowledgeMapId: string) {
        if (!problem.canImportProblems(this.user)) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        if (keepUser && !problem.canAssignManagedAuthor(this.user)) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        const allowedFields = new Set(['keepUser', 'knowledgeMapId']);
        const unknownFields = Object.keys(this.request.body || {}).filter((field) => !allowedFields.has(field));
        if (unknownFields.length) throw new ValidationError('fields', null, `题目导入不接受字段：${unknownFields.join(', ')}`);
        if (!this.request.files.file) throw new ValidationError('file');
        const promise = problem
            .import(domainId, this.request.files.file.filepath, {
                actorUser: this.user,
                keepOriginalAuthor: keepUser,
                progress: this.progress.bind(this),
                delSource: true,
                knowledgeMapId,
            })
            .catch(async (e) => {
                await MessageModel.send(1, this.user._id, `Import failed: ${e.message}\n${e.stack}`);
                throw e;
            });
        let resolved = false;
        await Promise.race([
            promise.then(() => {
                resolved = true;
            }),
            sleep(5000),
        ]);
        this.response.redirect = this.url('problem_main', resolved ? {} : { query: { showImport: 1 } });
    }
}

export async function apply(ctx: Context) {
    ctx.Route('problem_import_hydro', '/problem/import/hydro', ProblemImportHydroHandler, PRIV.PRIV_USER_PROFILE);
    ctx.injectUI('ProblemAdd', 'problem_import_hydro', { icon: 'copy', text: 'Import From Hydro' });
}
