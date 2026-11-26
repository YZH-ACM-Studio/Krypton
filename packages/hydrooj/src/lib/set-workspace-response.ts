import type { Tdoc } from '../interface';
import type { SetWorkspace } from './set-workspace';

/** Configured student pages expose one safe projection, including in JSON/bootstrap responses. */
export function setWorkspaceResponse(tdoc: Tdoc, fields: {
    workspace: SetWorkspace;
    workspaceProblems: unknown;
    langRange: unknown;
}) {
    if (!fields.workspace.rules?.showDifficulty && fields.workspaceProblems && typeof fields.workspaceProblems === 'object') {
        fields = { ...fields, workspaceProblems: Object.fromEntries(Object.entries(fields.workspaceProblems).map(([pid, value]) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid workspace problem');
            const { difficulty: _difficulty, ...problem } = value;
            return [pid, problem];
        })) };
    }
    return {
        tdoc: { docId: tdoc.docId, title: tdoc.title, content: tdoc.content, rule: tdoc.rule,
            beginAt: tdoc.beginAt, endAt: tdoc.endAt,
            pids: fields.workspace.groups.flatMap((group) => group.items.map((item) => item.pid)) },
        workspace: fields.workspace,
        workspaceProblems: fields.workspaceProblems,
        langRange: fields.langRange,
    };
}
