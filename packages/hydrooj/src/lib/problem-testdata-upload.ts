import type { Readable } from 'stream';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { ValidationError } from '../error';
import { isProblemConfigFilename } from './problem-config';

/**
 * P3.13 removes the legacy multi-question objective/fill-function authoring
 * model. Validate config.yaml at the model boundary so HTTP, zip, Hydro import,
 * FPS import, and plugin callers cannot recreate it through different paths.
 */
export async function normalizeProblemTestdataUpload(name: string, source: Readable | Buffer | string): Promise<Readable | Buffer | string> {
    if (!isProblemConfigFilename(name)) return source;
    const readStream = async (stream: Readable) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    };
    const content = Buffer.isBuffer(source) ? source : typeof source === 'string' ? await fs.readFile(source) : await readStream(source);
    let parsed: any;
    try {
        parsed = yaml.load(content.toString('utf8'));
    } catch (error) {
        throw new ValidationError('config', null, `配置 YAML 无法解析：${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ValidationError('config', null, '配置 YAML 必须是对象');
    }
    if (['objective', 'fill_function', 'function'].includes(parsed.type)) {
        throw new ValidationError('config', null, '复合客观题与结构化代码题配置不能通过 config.yaml 创建，请从创建题目页选择独立题型');
    }
    return content;
}
