import { Context } from 'hydrooj';
import { JudgeSettings, overrideConfig } from './config';

export const Config = JudgeSettings;

export function apply(ctx: Context, config: ReturnType<typeof Config>) {
    overrideConfig(config);
    if (process.env.NODE_APP_INSTANCE !== '0') return;

    if (!config.disable) return require('./hosts/builtin').apply(ctx);
}
