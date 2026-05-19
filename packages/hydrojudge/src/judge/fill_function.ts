/**
 * fill_function judger — students fill in editable regions of a teacher-provided
 * template. The submitted `code` is JSON: `{ regionId -> content }`. We splice
 * the content into `config.template.source` and delegate to the `default` flow.
 *
 * See PRD §1.7 for the visual editor + splicing algorithm.
 */
import { STATUS } from '@hydrooj/common';
import { spliceFillFunction } from 'hydrooj';
import { FormatError } from '../error';
import { judge as defaultJudge } from './default';
import { Context } from './interface';

export const judge = async (ctx: Context) => {
    const template = (ctx.config as any).template;
    if (!template || !template.source || !Array.isArray(template.regions)) {
        ctx.next({
            status: STATUS.STATUS_JUDGING,
            progress: 0,
        });
        ctx.end({
            status: STATUS.STATUS_FORMAT_ERROR,
            score: 0,
            message: 'fill_function: missing template configuration',
            time: 0,
            memory: 0,
        });
        return;
    }

    // The submitted code is JSON: { regionId -> content }
    const rawCode = ('src' in (ctx.code as any))
        ? null // file-mode submissions not supported for fill_function — students always type
        : (ctx.code as any).content || '';
    let regionContents: Record<string, string>;
    try {
        regionContents = JSON.parse(rawCode || '{}');
        if (typeof regionContents !== 'object' || regionContents === null || Array.isArray(regionContents)) {
            throw new Error('expected object of regionId -> content');
        }
    } catch (e: any) {
        ctx.end({
            status: STATUS.STATUS_FORMAT_ERROR,
            score: 0,
            message: `fill_function: failed to parse submission: ${e.message}`,
            time: 0,
            memory: 0,
        });
        return;
    }

    let splicedSource: string;
    try {
        splicedSource = spliceFillFunction(template, regionContents);
    } catch (e: any) {
        ctx.end({
            status: STATUS.STATUS_FORMAT_ERROR,
            score: 0,
            message: `fill_function: ${e.message}`,
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
