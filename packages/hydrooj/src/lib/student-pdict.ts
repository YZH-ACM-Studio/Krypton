import { localizedErrorText, ValidationError } from '../error';
import { clientProblemConfig } from './problem-config';
import { compileProgrammingStatement, programmingStatementClientView } from './programming-statement';

export function projectStudentPdoc(pdoc: Record<string, unknown>): Record<string, unknown> {
    const next = { ...pdoc };
    delete next.origStat;
    delete next.reactions;
    delete next.antiAiMarkers;
    if (next.statementFormat === 'structured-v1') {
        const view = programmingStatementClientView(next.programmingStatement, next.config);
        if (compileProgrammingStatement(next.programmingStatement) !== next.content) {
            throw new ValidationError('content', null, localizedErrorText`结构化题面投影不一致`);
        }
        next.programmingStatementView = view;
    }
    delete next.programmingStatement;
    next.config = clientProblemConfig(next.config);
    return next;
}

export function projectStudentPdict(pdict: Record<string | number, Record<string, unknown>>): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [pid, pdoc] of Object.entries(pdict)) {
        out[pid] = projectStudentPdoc(pdoc);
    }
    return out;
}
