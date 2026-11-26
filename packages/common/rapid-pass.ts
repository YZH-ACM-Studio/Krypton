export interface RapidPassRule {
    enabled: boolean;
    minutes: number;
    minProblems: number;
}

export const DEFAULT_RAPID_PASS_RULE: Readonly<RapidPassRule> = Object.freeze({ enabled: true, minutes: 8, minProblems: 4 });

export interface RapidPassEvidence {
    roundNo: number;
    passed: number;
    total: number;
    seconds: number;
    fromStart: boolean;
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function parseRapidPassRule(raw: unknown): RapidPassRule {
    if (!raw || typeof raw !== 'object' || !('enabled' in raw) || typeof raw.enabled !== 'boolean'
        || !('minutes' in raw) || !integer(raw.minutes, 1, 180)
        || !('minProblems' in raw) || !integer(raw.minProblems, 2, 200)
        || Object.keys(raw).length !== 3) throw new TypeError('时间窗口须为 1 至 180 分钟，题数须为 2 至 200 的整数。');
    return { enabled: raw.enabled, minutes: raw.minutes, minProblems: raw.minProblems };
}

export function parseRapidPassEvidence(raw: unknown): RapidPassEvidence {
    if (!raw || typeof raw !== 'object' || !('roundNo' in raw) || !integer(raw.roundNo, 1)
        || !('total' in raw) || !integer(raw.total, 2) || !('passed' in raw) || !integer(raw.passed, 2, raw.total)
        || !('seconds' in raw) || !integer(raw.seconds, 0) || !('fromStart' in raw) || typeof raw.fromStart !== 'boolean') {
        throw new TypeError('作答速度分析数据无效。');
    }
    return { roundNo: raw.roundNo, passed: raw.passed, total: raw.total, seconds: raw.seconds, fromStart: raw.fromStart };
}
