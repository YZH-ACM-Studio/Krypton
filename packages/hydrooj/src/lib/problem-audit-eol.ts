export type TestdataEolKind = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';

export interface TestdataEolClassification {
    kind: TestdataEolKind;
    binary: boolean;
    crlfCount: number;
    crCount: number;
    lfCount: number;
}

const TEXT_NAME = /\.(?:in|out|ans|txt|csv|dat|yaml|yml|c|cc|cpp|cxx|h|hpp|py|java|pas|js|ts)$/i;
const CONFIG_NAME = /^config\.ya?ml$/i;
const BINARY_NAME = /\.(?:png|jpe?g|gif|webp|bmp|pdf|zip|7z|rar|gz|xz|exe|dll|so|o|class|jar)$/i;

export function shouldScanTestdataName(name: string): 'text' | 'skip' | 'sniff' {
    const base = name.split('/').pop() || name;
    if (CONFIG_NAME.test(base) || TEXT_NAME.test(base)) return 'text';
    if (BINARY_NAME.test(base)) return 'skip';
    return 'sniff';
}

export function classifyTestdataEol(bytes: Buffer): TestdataEolClassification {
    if (bytes.includes(0)) {
        return { kind: 'none', binary: true, crlfCount: 0, crCount: 0, lfCount: 0 };
    }
    let crlfCount = 0;
    let crCount = 0;
    let lfCount = 0;
    for (let i = 0; i < bytes.length; i++) {
        const current = bytes[i];
        if (current === 0x0d) {
            if (bytes[i + 1] === 0x0a) {
                crlfCount++;
                i++;
            } else crCount++;
        } else if (current === 0x0a) lfCount++;
    }
    if (!crlfCount && !crCount && !lfCount) return { kind: 'none', binary: false, crlfCount, crCount, lfCount };
    const kinds = [
        crlfCount ? 'crlf' : null,
        crCount ? 'cr' : null,
        lfCount ? 'lf' : null,
    ].filter((item): item is TestdataEolKind => Boolean(item));
    if (kinds.length > 1) return { kind: 'mixed', binary: false, crlfCount, crCount, lfCount };
    return { kind: kinds[0], binary: false, crlfCount, crCount, lfCount };
}
