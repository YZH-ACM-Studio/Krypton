import { ObjectId } from 'mongodb';
import { parseProblemKind, type ProblemKind } from '@hydrooj/common';
import { ContestNotFoundError, LocalizedErrorText, ValidationError } from '../error';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
    const strings = [message] as unknown as TemplateStringsArray;
    Object.defineProperty(strings, 'raw', { value: [message] });
    throw new ValidationError('round', null, new LocalizedErrorText(strings, []));
}

export function parseRoundTid(raw: unknown): ObjectId {
    const tid = isRecord(raw) ? raw.tid : undefined;
    if (typeof tid === 'string' && /^[0-9a-f]{24}$/i.test(tid)) return new ObjectId(tid);
    if (tid instanceof ObjectId) return tid;
    throw new ContestNotFoundError('', tid instanceof ObjectId ? tid : new ObjectId());
}

export interface ParsedSaveItem {
    pid: number;
    body: unknown;
    baseVersion: number;
}

export function parseSaveBody(raw: unknown): { roundId: ObjectId; kind: ProblemKind; operationId: string; items: ParsedSaveItem[] } {
    if (!isRecord(raw)) fail('请求参数无效。');
    const allowed = new Set(['domainId', 'tid', 'roundId', 'kind', 'operationId', 'items']);
    for (const key of Object.keys(raw)) {
        if (!allowed.has(key)) fail('请求参数无效。');
    }
    const operationId = raw.operationId;
    if (typeof raw.roundId !== 'string' || !/^[a-f0-9]{24}$/i.test(raw.roundId)) fail('作答轮次无效，请重新打开题目集。');
    const roundId = new ObjectId(raw.roundId);
    const kind = parseProblemKind(raw.kind);
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(operationId)) fail('保存编号无效。');
    if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > 200) fail('保存内容无效。');
    const items: ParsedSaveItem[] = [];
    const seen = new Set<number>();
    for (const item of raw.items) {
        if (!isRecord(item)) fail('保存内容无效。');
        const extra = Object.keys(item).filter((key) => !['pid', 'body', 'baseVersion'].includes(key));
        if (extra.length) fail('保存内容无效。');
        if (!Object.hasOwn(item, 'body')) fail('保存内容无效。');
        if (!isRecord(item.body) || Object.values(item.body).some((value) => typeof value !== 'string'
            && (!Array.isArray(value) || value.some((part) => typeof part !== 'string')))) fail('答案内容无效。');
        if (JSON.stringify(item.body).length > 128 * 1024) fail('答案内容过长。');
        const pid = item.pid;
        const baseVersion = item.baseVersion;
        if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) fail('题目编号无效。');
        if (typeof baseVersion !== 'number' || !Number.isSafeInteger(baseVersion) || baseVersion < 0) fail('答案版本无效。');
        if (seen.has(pid)) fail('同一题不能保存两次。');
        seen.add(pid);
        items.push({ pid, body: item.body, baseVersion });
    }
    return { roundId, kind, operationId, items };
}
