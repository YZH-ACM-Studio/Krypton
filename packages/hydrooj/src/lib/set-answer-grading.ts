import { gradeObjectiveAnswer, STATUS } from '@hydrooj/common';
import { localizedErrorText, ValidationError } from '../error';
import { gradeProgramFillTextSubmission, parseProblemConfigObject, questionKindMap } from './problem-config';
import { setProblemFact } from './set-problem-fact';

export interface SetAnswerGrade {
    rawScore: number;
    judgeResult: Record<string, 'correct' | 'wrong' | 'partial'>;
    manual: boolean;
    status: number;
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Use the same graders as submitted Records; no teacher answers leave this function. */
export function gradeSetAnswer(pdoc: { problemKind?: unknown; config?: unknown }, body: unknown): SetAnswerGrade {
    if (!object(body) || Object.values(body).some((value) => typeof value !== 'string'
        && (!Array.isArray(value) || value.some((part) => typeof part !== 'string')))) {
        throw new ValidationError('answers', null, localizedErrorText`答案格式无效。`);
    }
    const config = parseProblemConfigObject(pdoc);
    const fact = setProblemFact({ ...pdoc, config });
    if (fact.judged) throw new ValidationError('answers', null, localizedErrorText`代码题需要单独提交。`);
    if (fact.kind === 'program_fill') {
        const grade = gradeProgramFillTextSubmission(config, JSON.stringify(body));
        return {
            rawScore: grade.score,
            judgeResult: Object.fromEntries(grade.regions.map((region) => [region.id, region.correct ? 'correct' : 'wrong'])),
            manual: false,
            status: grade.correctCount === grade.regions.length ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER,
        };
    }
    if (config?.type !== 'objective' || !object(config.answers) || Object.keys(config.answers).length === 0) {
        throw new ValidationError('answers', null, localizedErrorText`题目评分配置无效。`);
    }
    const answers = config.answers;
    if (Object.keys(body).some((key) => !Object.hasOwn(answers, key))) {
        throw new ValidationError('answers', null, localizedErrorText`答案中包含未知题号。`);
    }
    if (Object.values(answers).some((entry) => !Array.isArray(entry) || entry.length < 2
        || typeof entry[1] !== 'number' || !Number.isFinite(entry[1]) || entry[1] < 0)) {
        throw new ValidationError('answers', null, localizedErrorText`题目评分配置无效。`);
    }
    const kinds = questionKindMap(answers as Parameters<typeof questionKindMap>[0]);
    if (Object.keys(kinds).length !== Object.keys(answers).length) {
        throw new ValidationError('answers', null, localizedErrorText`题目评分配置无效。`);
    }
    const manual = Object.values(kinds).includes('subjective');
    if (manual) {
        if (fact.kind !== 'subjective' || Object.values(kinds).some((kind) => kind !== 'subjective')) {
            throw new ValidationError('answers', null, localizedErrorText`主观题与客观题需要分开设置。`);
        }
        if (Object.values(body).some((value) => typeof value !== 'string')) {
            throw new ValidationError('answers', null, localizedErrorText`主观题答案必须是文本。`);
        }
        return { rawScore: 0, judgeResult: {}, manual: true, status: STATUS.STATUS_WAITING };
    }
    const judgeResult: SetAnswerGrade['judgeResult'] = {};
    let rawScore = 0;
    for (const [key, spec] of Object.entries(answers)) {
        const grade = gradeObjectiveAnswer(spec, body[key]);
        rawScore += grade.score;
        judgeResult[key] = grade.outcome;
    }
    return {
        rawScore,
        judgeResult,
        manual: false,
        status: Object.values(judgeResult).every((outcome) => outcome === 'correct') ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER,
    };
}
