type Translate = (message: string) => string;

interface JudgeMessageLike {
    message?: unknown;
    msg?: unknown;
    text?: unknown;
    params?: unknown;
    stack?: unknown;
}

interface RecordJudgeMessageFields {
    compilerTexts?: unknown;
    judgeTexts?: unknown;
    testCases?: unknown;
    cases?: unknown;
}

function placeholderIndexes(template: string): Set<number> {
    const indexes = new Set<number>();
    let cursor = 0;
    while (cursor < template.length) {
        const open = template.indexOf('{', cursor);
        const closeBeforeOpen = template.indexOf('}', cursor);
        if (closeBeforeOpen !== -1 && (open === -1 || closeBeforeOpen < open)) {
            throw new TypeError(`Malformed judge message template: ${template}`);
        }
        if (open === -1) break;
        const close = template.indexOf('}', open + 1);
        if (close === -1) throw new TypeError(`Malformed judge message template: ${template}`);
        const token = template.slice(open + 1, close);
        if (!/^(?:0|[1-9]\d*)$/.test(token)) throw new TypeError(`Malformed judge message template: ${template}`);
        indexes.add(Number(token));
        cursor = close + 1;
    }
    return indexes;
}

function sameIndexes(left: Set<number>, right: Set<number>): boolean {
    return left.size === right.size && [...left].every((index) => right.has(index));
}

function formatTemplate(template: string, params: string[], translate: Translate): string {
    const translated = translate(template);
    if (typeof translated !== 'string' || !translated) throw new TypeError(`Judge message translation must be a non-empty string: ${template}`);
    const sourceIndexes = placeholderIndexes(template);
    const translatedIndexes = placeholderIndexes(translated);
    if (!sameIndexes(sourceIndexes, translatedIndexes)) {
        throw new TypeError(`Judge message translation changed placeholder indexes: ${template}`);
    }
    for (const index of sourceIndexes) {
        if (index >= params.length) throw new TypeError(`Judge message parameter {${index}} is missing: ${template}`);
    }
    const formatted = translated.replace(/\{(0|[1-9]\d*)\}/g, (_, index) => params[Number(index)]);
    return sourceIndexes.size ? formatted : [formatted, params.join(' ')].filter(Boolean).join(' ');
}

function formatJudgeMessage(value: unknown, translate: Translate): string {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Judge message must be a scalar or object');

    const item = value as JudgeMessageLike;
    const source = item.message ?? item.msg ?? item.text;
    if (source == null || source === '') throw new TypeError('Judge message object must contain message, msg, or text');
    const params = item.params === undefined ? [] : Array.isArray(item.params) ? item.params.map(String) : null;
    if (!params) throw new TypeError('Judge message params must be an array');
    const formatted = formatTemplate(String(source), params, translate);
    const stack = process.env.DEV && item.stack ? `\n${String(item.stack)}` : '';
    return `${formatted}${stack}`.trim();
}

function formatTextCollection(value: unknown, translate: Translate): string[] {
    const source = Array.isArray(value) ? value : value == null ? [] : [value];
    return source.map((item) => formatJudgeMessage(item, translate)).filter(Boolean);
}

function formatCaseCollection(value: unknown, translate: Translate): unknown {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new TypeError('Record test cases must be an array');
    return value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Record test case must be an object');
        const entry = item as Record<string, unknown>;
        if (!('message' in entry)) return item;
        return {
            ...entry,
            message: formatJudgeMessage(entry.message, translate),
        };
    });
}

/**
 * Convert judge diagnostics to request-locale strings before the record leaves
 * the server. Both initial HTML/bootstrap responses and record WebSocket
 * snapshots use this boundary, so clients never need a placeholder parser.
 */
export function formatRecordJudgeMessages<T extends RecordJudgeMessageFields>(record: T, translate: Translate): T {
    const result: RecordJudgeMessageFields = { ...record };
    if ('compilerTexts' in record) result.compilerTexts = formatTextCollection(record.compilerTexts, translate);
    if ('judgeTexts' in record) result.judgeTexts = formatTextCollection(record.judgeTexts, translate);
    if ('testCases' in record) result.testCases = formatCaseCollection(record.testCases, translate);
    if ('cases' in record) result.cases = formatCaseCollection(record.cases, translate);
    return result as T;
}
