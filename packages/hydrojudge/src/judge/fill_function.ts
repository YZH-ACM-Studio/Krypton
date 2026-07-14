/**
 * Structured-code judge adapter — students fill editable regions of a teacher-provided
 * template. The submitted `code` is JSON: `{ regionId -> content }`. We splice
 * the content into `config.template.source` and delegate to the `default` flow.
 *
 * See PRD §1.7 for the visual editor + splicing algorithm.
 */
import { STATUS } from '@hydrooj/common';
import { parseStructuredRegionSubmission, spliceStructuredCodeTemplate, validateStructuredCodeJudgeConfig } from 'hydrooj';
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
    if (ctx.lang !== template.lang) {
        ctx.end({
            status: STATUS.STATUS_FORMAT_ERROR,
            score: 0,
            message: `${kind}: language mismatch (${ctx.lang} != ${template.lang})`,
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
