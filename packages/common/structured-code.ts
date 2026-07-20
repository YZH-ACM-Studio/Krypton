import type { ClientStructuredCodeSegment, StructuredCodeRange, StructuredCodeRegion } from './types';

export function compareStructuredCodeRegions(left: StructuredCodeRegion, right: StructuredCodeRegion): number {
    return left.startLine - right.startLine || left.endLine - right.endLine || left.id.localeCompare(right.id);
}

function assertSurfaceRange(range: StructuredCodeRange, lineCount: number, label: string): void {
    if (!Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLine)) {
        throw new TypeError(`${label} must use integer whole-line bounds`);
    }
    if (range.startLine < 0 || range.endLine <= range.startLine || range.endLine > lineCount) {
        throw new RangeError(`${label} is out of bounds`);
    }
}

/**
 * The only serializer allowed to turn a private structured-code template into
 * a student-visible code surface. Private lines and source coordinates are
 * omitted rather than represented by placeholders or counts.
 */
export function buildClientStructuredCodeSurface(template: {
    source: string;
    publicRanges: StructuredCodeRange[];
    regions: StructuredCodeRegion[];
}): ClientStructuredCodeSegment[] {
    if (!template || typeof template.source !== 'string') throw new TypeError('structured code source must be text');
    if (template.source.includes('\r')) throw new Error('structured code source must use LF line endings');
    if (!Array.isArray(template.publicRanges)) throw new TypeError('structured code public ranges must be an array');
    if (!Array.isArray(template.regions)) throw new TypeError('structured code regions must be an array');
    const lines = template.source.split('\n');
    const entries = [
        ...template.publicRanges.map((range, index) => ({ type: 'code' as const, range, index })),
        ...template.regions.map((region, index) => ({ type: 'region' as const, range: region, region, index })),
    ].sort(
        (left, right) =>
            left.range.startLine - right.range.startLine || left.range.endLine - right.range.endLine || left.type.localeCompare(right.type),
    );
    let previousEnd = -1;
    const surface: ClientStructuredCodeSegment[] = [];
    for (const entry of entries) {
        assertSurfaceRange(entry.range, lines.length, `${entry.type} range ${entry.index + 1}`);
        if (entry.range.startLine < previousEnd) throw new Error('structured code visible ranges overlap');
        previousEnd = entry.range.endLine;
        if (entry.type === 'code') {
            surface.push({ type: 'code', code: lines.slice(entry.range.startLine, entry.range.endLine).join('\n') });
            continue;
        }
        if (typeof entry.region.id !== 'string' || !entry.region.id) throw new TypeError('structured code region id must be text');
        surface.push({
            type: 'region',
            id: entry.region.id,
            ...(entry.region.title ? { title: entry.region.title } : {}),
            ...(entry.region.description ? { description: entry.region.description } : {}),
            ...(entry.region.prompt ? { prompt: entry.region.prompt } : {}),
        });
    }
    return surface;
}
