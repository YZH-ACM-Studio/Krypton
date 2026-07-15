import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { normalizeProblemTestdataUpload } from '../src/lib/problem-testdata-upload';

describe('P3.13 problem testdata config boundary', () => {
    const hasDetail = (detail: string) => (error: any) => {
        assert.match(String(error?.params?.[2] || ''), new RegExp(detail));
        return true;
    };

    it('keeps non-config testdata streams untouched', async () => {
        const source = Readable.from('sample');
        assert.equal(await normalizeProblemTestdataUpload('1.in', source), source);
    });

    it('buffers and accepts a normal programming config', async () => {
        const result = await normalizeProblemTestdataUpload('config.yaml', Readable.from('type: default\ntime: 1s\n'));
        assert.ok(Buffer.isBuffer(result));
        assert.equal(result.toString(), 'type: default\ntime: 1s\n');
    });

    for (const legacyType of ['objective', 'fill_function']) {
        it(`rejects legacy ${legacyType} before any model storage write`, async () => {
            await assert.rejects(
                normalizeProblemTestdataUpload('config.yaml', Buffer.from(`type: ${legacyType}\n`)),
                hasDetail('复合客观题与结构化代码题配置不能通过 config.yaml 创建'),
            );
        });
    }

    it('rejects malformed or non-object config instead of storing latent failures', async () => {
        await assert.rejects(normalizeProblemTestdataUpload('config.yaml', Buffer.from('type: [')), hasDetail('配置 YAML 无法解析'));
        await assert.rejects(normalizeProblemTestdataUpload('config.yaml', Buffer.from('default')), hasDetail('配置 YAML 必须是对象'));
    });
});
