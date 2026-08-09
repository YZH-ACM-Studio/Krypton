import { isEqual } from 'lodash';

const CONTEXT_LENGTH = 24;
const MARKER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const CONTENT_LANGUAGE = /^[A-Za-z0-9_-]{1,32}$/;
const STRUCTURED_TEXT_PATHS = ['background', 'description', 'input', 'output', 'hints'] as const;

export interface AntiAiMarkerAnchor {
    path: string;
    offset: number;
    affinity: 'before' | 'after';
    before: string;
    after: string;
}

export interface AntiAiMarker {
    id: string;
    anchor: AntiAiMarkerAnchor;
    injectionText: string;
    revision: number;
}

export interface AntiAiMarkerDocument {
    schemaVersion: 1;
    markers: AntiAiMarker[];
}

export interface AntiAiMarkerInput {
    schemaVersion: 1;
    markers: Array<{
        id: string;
        anchor: Pick<AntiAiMarkerAnchor, 'path' | 'offset' | 'affinity'>;
        injectionText: string;
        revision: number;
    }>;
}

export interface AntiAiMarkerClientView {
    schemaVersion: 1;
    markers: Array<{
        id: string;
        path: string;
        offset: number;
        injectionText: string;
    }>;
}

interface StatementLikeProblem {
    content?: unknown;
    statementFormat?: unknown;
    programmingStatement?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: string) {
    const actual = Object.keys(value).sort();
    const canonical = [...expected].sort();
    if (!isEqual(actual, canonical)) throw new TypeError(`${path} fields are invalid`);
}

function localizedContentSources(content: unknown): Map<string, string> {
    const sources = new Map<string, string>();
    if (isPlainObject(content)) {
        const entries = Object.entries(content);
        if (!entries.length || entries.some(([language, source]) => !CONTENT_LANGUAGE.test(language) || typeof source !== 'string')) {
            throw new TypeError('localized statement content is invalid for anti AI markers');
        }
        for (const [language, source] of entries) sources.set(`content.${language}`, source as string);
        return sources;
    }
    if (typeof content !== 'string') throw new TypeError('statement content is invalid for anti AI markers');
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (
                isPlainObject(parsed) &&
                Object.keys(parsed).length > 0 &&
                Object.keys(parsed).every((key) => CONTENT_LANGUAGE.test(key)) &&
                Object.values(parsed).every((value) => typeof value === 'string')
            ) {
                for (const [language, source] of Object.entries(parsed)) {
                    sources.set(`content.${language}`, source as string);
                }
                return sources;
            }
        } catch {
            // It is ordinary Markdown beginning and ending with braces.
        }
    }
    sources.set('content', content);
    return sources;
}

export function isRawStatementContentInput(value: unknown): boolean {
    const content = String(value ?? '');
    return content.length < 65_536 && content.trim().length > 0;
}

export function statementSourcesForAntiAiMarkers(problem: StatementLikeProblem): Map<string, string> {
    if (problem.statementFormat !== 'structured-v1') return localizedContentSources(problem.content);
    if (!isPlainObject(problem.programmingStatement)) throw new TypeError('structured statement is unavailable for anti AI markers');
    const statement = problem.programmingStatement;
    const sources = new Map<string, string>();
    for (const key of STRUCTURED_TEXT_PATHS) {
        const section = statement[key];
        if (!isPlainObject(section) || typeof section.content !== 'string') {
            throw new TypeError(`programmingStatement.${key} is invalid`);
        }
        sources.set(`programmingStatement.${key}`, section.content);
    }
    const examples = statement.examples;
    if (!isPlainObject(examples) || !Array.isArray(examples.items)) throw new TypeError('programmingStatement.examples is invalid');
    for (const [index, example] of examples.items.entries()) {
        if (!isPlainObject(example) || typeof example.note !== 'string') {
            throw new TypeError(`programmingStatement.examples.${index}.note is invalid`);
        }
        sources.set(`programmingStatement.examples.${index}.note`, example.note);
    }
    return sources;
}

function graphemeBoundaries(source: string): Set<number> {
    const boundaries = new Set<number>([0, source.length]);
    const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
    for (const segment of segmenter.segment(source)) boundaries.add(segment.index);
    return boundaries;
}

function canonicalInput(value: unknown): AntiAiMarkerInput {
    if (!isPlainObject(value)) throw new TypeError('antiAiMarkers must be an object');
    exactKeys(value, ['schemaVersion', 'markers'], 'antiAiMarkers');
    if (value.schemaVersion !== 1) throw new TypeError('antiAiMarkers.schemaVersion is unsupported');
    if (!Array.isArray(value.markers)) throw new TypeError('antiAiMarkers.markers must be an array');
    const ids = new Set<string>();
    const markers: AntiAiMarkerInput['markers'] = value.markers.map((raw, index) => {
        if (!isPlainObject(raw)) throw new TypeError(`antiAiMarkers.markers.${index} must be an object`);
        exactKeys(raw, ['id', 'anchor', 'injectionText', 'revision'], `antiAiMarkers.markers.${index}`);
        if (typeof raw.id !== 'string' || !MARKER_ID.test(raw.id) || ids.has(raw.id)) {
            throw new TypeError(`antiAiMarkers.markers.${index}.id is invalid`);
        }
        ids.add(raw.id);
        if (!isPlainObject(raw.anchor)) throw new TypeError(`antiAiMarkers.markers.${index}.anchor must be an object`);
        exactKeys(raw.anchor, ['path', 'offset', 'affinity'], `antiAiMarkers.markers.${index}.anchor`);
        if (typeof raw.anchor.path !== 'string' || !raw.anchor.path) throw new TypeError(`antiAiMarkers.markers.${index}.anchor.path is invalid`);
        if (!Number.isSafeInteger(raw.anchor.offset) || Number(raw.anchor.offset) < 0) {
            throw new TypeError(`antiAiMarkers.markers.${index}.anchor.offset is invalid`);
        }
        if (raw.anchor.affinity !== 'before' && raw.anchor.affinity !== 'after') {
            throw new TypeError(`antiAiMarkers.markers.${index}.anchor.affinity is invalid`);
        }
        if (typeof raw.injectionText !== 'string' || raw.injectionText.length === 0) {
            throw new TypeError(`antiAiMarkers.markers.${index}.injectionText is invalid`);
        }
        if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0) {
            throw new TypeError(`antiAiMarkers.markers.${index}.revision is invalid`);
        }
        return {
            id: raw.id,
            anchor: {
                path: raw.anchor.path,
                offset: Number(raw.anchor.offset),
                affinity: raw.anchor.affinity,
            },
            injectionText: raw.injectionText,
            revision: Number(raw.revision),
        };
    });
    return { schemaVersion: 1, markers };
}

function canonicalStored(value: unknown): AntiAiMarkerDocument {
    if (!isPlainObject(value)) throw new TypeError('stored antiAiMarkers must be an object');
    exactKeys(value, ['schemaVersion', 'markers'], 'stored antiAiMarkers');
    if (value.schemaVersion !== 1) throw new TypeError('stored antiAiMarkers.schemaVersion is unsupported');
    if (!Array.isArray(value.markers)) throw new TypeError('stored antiAiMarkers.markers must be an array');
    const ids = new Set<string>();
    const markers = value.markers.map((raw, index) => {
        if (!isPlainObject(raw)) throw new TypeError(`stored antiAiMarkers.markers.${index} must be an object`);
        exactKeys(raw, ['id', 'anchor', 'injectionText', 'revision'], `stored antiAiMarkers.markers.${index}`);
        if (typeof raw.id !== 'string' || !MARKER_ID.test(raw.id) || ids.has(raw.id)) {
            throw new TypeError(`stored antiAiMarkers.markers.${index}.id is invalid`);
        }
        ids.add(raw.id);
        if (!isPlainObject(raw.anchor)) throw new TypeError(`stored antiAiMarkers.markers.${index}.anchor must be an object`);
        exactKeys(raw.anchor, ['path', 'offset', 'affinity', 'before', 'after'], `stored antiAiMarkers.markers.${index}.anchor`);
        if (
            typeof raw.anchor.path !== 'string' ||
            !raw.anchor.path ||
            !Number.isSafeInteger(raw.anchor.offset) ||
            Number(raw.anchor.offset) < 0 ||
            (raw.anchor.affinity !== 'before' && raw.anchor.affinity !== 'after') ||
            typeof raw.anchor.before !== 'string' ||
            typeof raw.anchor.after !== 'string' ||
            typeof raw.injectionText !== 'string' ||
            raw.injectionText.length === 0 ||
            !Number.isSafeInteger(raw.revision) ||
            Number(raw.revision) < 1
        ) {
            throw new TypeError(`stored antiAiMarkers.markers.${index} is invalid`);
        }
        return raw as unknown as AntiAiMarker;
    });
    return { schemaVersion: 1, markers };
}

function storedSemantic(marker: AntiAiMarker) {
    return {
        id: marker.id,
        anchor: { path: marker.anchor.path, offset: marker.anchor.offset, affinity: marker.anchor.affinity },
        injectionText: marker.injectionText,
    };
}

export function canonicalAntiAiMarkers(inputValue: unknown, nextProblem: StatementLikeProblem, previousValue: unknown): AntiAiMarkerDocument {
    const input = canonicalInput(inputValue);
    const previous = previousValue === undefined ? undefined : canonicalStored(previousValue);
    const previousById = new Map((previous?.markers || []).map((marker) => [marker.id, marker]));
    const sources = statementSourcesForAntiAiMarkers(nextProblem);
    const boundaries = new Map<string, Set<number>>();
    const markers = input.markers.map((marker) => {
        const source = sources.get(marker.anchor.path);
        if (source === undefined) throw new TypeError(`antiAiMarkers path is not part of the canonical statement: ${marker.anchor.path}`);
        if (marker.anchor.offset > source.length) throw new TypeError(`antiAiMarkers offset is outside ${marker.anchor.path}`);
        let allowed = boundaries.get(marker.anchor.path);
        if (!allowed) {
            allowed = graphemeBoundaries(source);
            boundaries.set(marker.anchor.path, allowed);
        }
        if (!allowed.has(marker.anchor.offset)) throw new TypeError(`antiAiMarkers offset is not a grapheme boundary: ${marker.anchor.path}`);
        const prior = previousById.get(marker.id);
        if (prior) {
            if (marker.revision !== prior.revision) throw new TypeError(`antiAiMarkers marker revision is stale: ${marker.id}`);
        } else if (marker.revision !== 0) {
            throw new TypeError(`new antiAiMarkers marker revision must be zero: ${marker.id}`);
        }
        const semantic = {
            id: marker.id,
            anchor: marker.anchor,
            injectionText: marker.injectionText,
        };
        const revision = prior && isEqual(storedSemantic(prior), semantic) ? prior.revision : (prior?.revision || 0) + 1;
        return {
            ...semantic,
            anchor: {
                ...marker.anchor,
                before: source.slice(Math.max(0, marker.anchor.offset - CONTEXT_LENGTH), marker.anchor.offset),
                after: source.slice(marker.anchor.offset, marker.anchor.offset + CONTEXT_LENGTH),
            },
            revision,
        };
    });
    markers.sort((left, right) => {
        const path = left.anchor.path.localeCompare(right.anchor.path);
        return path || left.anchor.offset - right.anchor.offset || left.id.localeCompare(right.id);
    });
    return { schemaVersion: 1, markers };
}

export function assertStoredAntiAiMarkers(value: unknown, problem: StatementLikeProblem): AntiAiMarkerDocument {
    const stored = canonicalStored(value);
    const sources = statementSourcesForAntiAiMarkers(problem);
    const boundaries = new Map<string, Set<number>>();
    for (const marker of stored.markers) {
        const source = sources.get(marker.anchor.path);
        if (source === undefined || marker.anchor.offset > source.length) {
            throw new TypeError(`stored antiAiMarkers path or offset is invalid: ${marker.id}`);
        }
        let allowed = boundaries.get(marker.anchor.path);
        if (!allowed) {
            allowed = graphemeBoundaries(source);
            boundaries.set(marker.anchor.path, allowed);
        }
        if (!allowed.has(marker.anchor.offset)) throw new TypeError(`stored antiAiMarkers offset is not a grapheme boundary: ${marker.id}`);
        const before = source.slice(Math.max(0, marker.anchor.offset - CONTEXT_LENGTH), marker.anchor.offset);
        const after = source.slice(marker.anchor.offset, marker.anchor.offset + CONTEXT_LENGTH);
        if (before !== marker.anchor.before || after !== marker.anchor.after) {
            throw new TypeError(`stored antiAiMarkers anchor context is stale: ${marker.id}`);
        }
    }
    return stored;
}

export function antiAiMarkerClientView(value: unknown, problem: StatementLikeProblem): AntiAiMarkerClientView {
    const stored = assertStoredAntiAiMarkers(value, problem);
    return {
        schemaVersion: 1,
        markers: stored.markers.map((marker) => ({
            id: marker.id,
            path: marker.anchor.path,
            offset: marker.anchor.offset,
            injectionText: marker.injectionText,
        })),
    };
}
