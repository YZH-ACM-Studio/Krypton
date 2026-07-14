/**
 * Structured-code judge adapter — students fill editable regions of a teacher-provided
 * template. The submitted `code` is JSON: `{ regionId -> content }`. We splice
 * the content into `config.template.source` and delegate to the `default` flow.
 *
 * See PRD §1.7 for the visual editor + splicing algorithm.
 */
import { STATUS, SubtaskType } from '@hydrooj/common';
import {
    gradeProgramFillTextSubmission,
    parseStructuredRegionSubmission,
    spliceStructuredCodeTemplate,
    validateStructuredCodeJudgeConfig,
} from 'hydrooj';
import { judge as defaultJudge } from './default';
import { Context } from './interface';

export const judge = async (ctx: Context) => {
    const template = (ctx.config as any).template;
    const kind = (ctx.config as any).type === 'function' ? 'function' : 'program_fill';
    try {
        validateStructuredCodeJudgeConfig(ctx.config, kind);
    } catch (error: any) {
        ctx.next({
            status: STATUS.STATUS_JUDGING,
            progress: 0,
        });
        ctx.end({
            status: STATUS.STATUS_FORMAT_ERROR,
            score: 0,
            message: error.message,
            time: 0,
            memory: 0,
        });
        return;
    }
    const textMode = kind === 'program_fill' && (ctx.config as any).mode === 'text';
    const expectedLang = textMode ? '_' : template.lang;
    if (ctx.lang !== expectedLang) {
        ctx.end({
            status: STATUS.STATUS_FORMAT_ERROR,
            score: 0,
            message: `${kind}: language mismatch (${ctx.lang} != ${expectedLang})`,
            time: 0,
            memory: 0,
        });
        return;
    }

    // The submitted code is JSON: { regionId -> content }
    const rawCode =
        'src' in (ctx.code as any)
            ? null // File-mode submissions are unsupported; structured-code answers are always JSON text.
            : (ctx.code as any).content || '';
    let regionContents: Record<string, string>;
    try {
        regionContents = parseStructuredRegionSubmission(kind, template, rawCode ?? '');
    } catch (e: any) {
        ctx.end({
            status: STATUS.STATUS_FORMAT_ERROR,
            score: 0,
            message: `${kind}: failed to parse submission: ${e.message}`,
            time: 0,
            memory: 0,
        });
        return;
    }

    if (textMode) {
        const grade = gradeProgramFillTextSubmission(ctx.config, rawCode ?? '');
        ctx.next({ status: STATUS.STATUS_JUDGING, progress: 0 });
        const subtasks: Record<number, { type: SubtaskType; score: number; status: STATUS }> = {};
        for (const [index, region] of grade.regions.entries()) {
            const status = region.correct ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER;
            subtasks[index + 1] = { type: SubtaskType.sum, score: region.score, status };
            ctx.next({
                case: {
                    subtaskId: index + 1,
                    id: 1,
                    time: 0,
                    memory: 0,
                    status,
                    score: region.score,
                    message: region.correct ? 'Correct' : 'Incorrect',
                },
            });
        }
        ctx.end({
            status: grade.correctCount === grade.regions.length ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER,
            score: grade.score,
            time: 0,
            memory: 0,
            subtasks,
        });
        return;
    }

    let splicedSource: string;
    try {
        splicedSource = spliceStructuredCodeTemplate(template, regionContents, kind);
    } catch (e: any) {
        ctx.end({
            status: STATUS.STATUS_FORMAT_ERROR,
            score: 0,
            message: `${kind}: ${e.message}`,
            time: 0,
            memory: 0,
        });
        return;
    }

    // Mutate ctx.code and ctx.lang to point at the spliced full program,
    // then hand off to the default judger. The default judger compiles &
    // runs ctx.code through normal testcases.
    (ctx as any).code = { content: splicedSource };
    (ctx as any).lang = template.lang || ctx.lang;
    await defaultJudge(ctx);
};
