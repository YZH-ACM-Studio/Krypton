import { createHash } from 'node:crypto';
import { parseMemoryMB, parseTimeMS } from '@hydrooj/utils';
import { localizedErrorText, ValidationError } from '../error';
import type { LocalizedErrorText } from '../error';
import { parseProblemConfigObject } from './problem-config';

export const PROGRAMMING_STATEMENT_SCHEMA_VERSION = 1 as const;
export const PROGRAMMING_STATEMENT_LOCALE = 'zh-CN' as const;

export type ProgrammingStatementFormat = 'structured-v1' | 'legacy-import-v1';
export type ProgrammingStatementTriState = 'undecided' | 'present' | 'absent';

export interface ProgrammingStatementTextSection {
    state: ProgrammingStatementTriState;
    content: string;
}

export interface ProgrammingStatementDescriptionSection {
    state: 'undecided' | 'present';
    content: string;
}

export interface ProgrammingStatementExample {
    input: string;
    inputEmpty: boolean;
    output: string;
    outputEmpty: boolean;
    note: string;
}

export interface ProgrammingStatementExamplesSection {
    state: ProgrammingStatementTriState;
    items: ProgrammingStatementExample[];
}

export interface ProgrammingStatement {
    schemaVersion: 1;
    locale: 'zh-CN';
    background: ProgrammingStatementTextSection;
    description: ProgrammingStatementDescriptionSection;
    input: ProgrammingStatementTextSection;
    output: ProgrammingStatementTextSection;
    examples: ProgrammingStatementExamplesSection;
    hints: ProgrammingStatementTextSection;
}

export interface ProgrammingStatementLimitView {
    complete: boolean;
    time: unknown;
    memory: unknown;
}

export interface ProgrammingStatementClientView {
    schemaVersion: 1;
    locale: 'zh-CN';
    background?: { content: string };
    description: { state: 'undecided' | 'present'; content: string };
    input: { state: ProgrammingStatementTriState; content: string };
    output: { state: ProgrammingStatementTriState; content: string };
    examples?: { items: ProgrammingStatementExample[] };
    hints?: { content: string };
    limits: ProgrammingStatementLimitView;
}

export interface LegacyProgrammingStatementPreview {
    statement: ProgrammingStatement;
    unclassified: string;
    fingerprint: string;
}

export class ProgrammingStatementValidationError extends Error {
    constructor(
        readonly field: string,
        readonly localizedMessage: LocalizedErrorText,
    ) {
        super(localizedMessage.raw);
        this.name = 'ProgrammingStatementValidationError';
    }
}

function fail(field: string, message: LocalizedErrorText): never {
    throw new ProgrammingStatementValidationError(field, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function text(value: unknown, field: string): string {
    if (typeof value !== 'string') fail(field, localizedErrorText`${field} must be text`);
    return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') fail(field, localizedErrorText`${field} must be boolean`);
    return value;
}

function triState(value: unknown, field: string): ProgrammingStatementTriState {
    if (!['undecided', 'present', 'absent'].includes(String(value))) fail(field, localizedErrorText`${field} has an invalid state`);
    return value as ProgrammingStatementTriState;
}

function normalizeTextSection(value: unknown, field: string): ProgrammingStatementTextSection {
    if (!isPlainObject(value)) fail(field, localizedErrorText`${field} must be an object`);
    const state = triState(value.state, `${field}.state`);
    const content = text(value.content, `${field}.content`);
    if (state === 'absent' && content) fail(`${field}.content`, localizedErrorText`${field} cannot retain hidden content`);
    return { state, content };
}

function normalizeDescription(value: unknown): ProgrammingStatementDescriptionSection {
    if (!isPlainObject(value)) fail('description', localizedErrorText`description must be an object`);
    if (!['undecided', 'present'].includes(String(value.state))) {
        fail('description.state', localizedErrorText`description has an invalid state`);
    }
    return {
        state: value.state as 'undecided' | 'present',
        content: text(value.content, 'description.content'),
    };
}

function normalizeExample(value: unknown, index: number): ProgrammingStatementExample {
    const field = `examples.items.${index}`;
    if (!isPlainObject(value)) fail(field, localizedErrorText`${field} must be an object`);
    const input = text(value.input, `${field}.input`);
    const output = text(value.output, `${field}.output`);
    const note = text(value.note, `${field}.note`);
    const inputEmpty = optionalBoolean(value.inputEmpty, `${field}.inputEmpty`) ?? input === '';
    const outputEmpty = optionalBoolean(value.outputEmpty, `${field}.outputEmpty`) ?? output === '';
    if (inputEmpty && input) fail(`${field}.input`, localizedErrorText`${field} cannot retain hidden input`);
    if (outputEmpty && output) fail(`${field}.output`, localizedErrorText`${field} cannot retain hidden output`);
    if (!inputEmpty && !input) {
        fail(`${field}.input`, localizedErrorText`${field} input must have content or be explicitly empty`);
    }
    if (!outputEmpty && !output) {
        fail(`${field}.output`, localizedErrorText`${field} output must have content or be explicitly empty`);
    }
    if (inputEmpty && outputEmpty) fail(field, localizedErrorText`${field} cannot have both sides empty`);
    return { input, inputEmpty, output, outputEmpty, note };
}

function normalizeExamples(value: unknown): ProgrammingStatementExamplesSection {
    if (!isPlainObject(value)) fail('examples', localizedErrorText`examples must be an object`);
    const state = triState(value.state, 'examples.state');
    if (!Array.isArray(value.items)) fail('examples.items', localizedErrorText`examples.items must be an array`);
    const items = value.items.map(normalizeExample);
    if (state === 'absent' && items.length) fail('examples.items', localizedErrorText`absent examples cannot retain hidden items`);
    if (state === 'present' && !items.length) fail('examples.items', localizedErrorText`present examples require at least one item`);
    return { state, items };
}

export function emptyProgrammingStatement(): ProgrammingStatement {
    return {
        schemaVersion: PROGRAMMING_STATEMENT_SCHEMA_VERSION,
        locale: PROGRAMMING_STATEMENT_LOCALE,
        background: { state: 'undecided', content: '' },
        description: { state: 'undecided', content: '' },
        input: { state: 'undecided', content: '' },
        output: { state: 'undecided', content: '' },
        examples: { state: 'undecided', items: [] },
        hints: { state: 'undecided', content: '' },
    };
}

export function normalizeProgrammingStatement(value: unknown): ProgrammingStatement {
    if (!isPlainObject(value)) fail('programmingStatement', localizedErrorText`programmingStatement must be an object`);
    if (value.schemaVersion !== PROGRAMMING_STATEMENT_SCHEMA_VERSION) {
        fail('schemaVersion', localizedErrorText`unsupported programming statement schema`);
    }
    if (value.locale !== PROGRAMMING_STATEMENT_LOCALE) fail('locale', localizedErrorText`unsupported programming statement locale`);
    return {
        schemaVersion: PROGRAMMING_STATEMENT_SCHEMA_VERSION,
        locale: PROGRAMMING_STATEMENT_LOCALE,
        background: normalizeTextSection(value.background, 'background'),
        description: normalizeDescription(value.description),
        input: normalizeTextSection(value.input, 'input'),
        output: normalizeTextSection(value.output, 'output'),
        examples: normalizeExamples(value.examples),
        hints: normalizeTextSection(value.hints, 'hints'),
    };
}

function block(title: string, content: string): string {
    return `## ${title}\n\n${content.trim()}`;
}

function fenced(kind: 'input' | 'output', index: number, value: string): string {
    const fence = '```';
    return `${fence}${kind}${index}\n${value}\n${fence}`;
}

export function compileProgrammingStatement(value: unknown): string {
    const statement = normalizeProgrammingStatement(value);
    const blocks: string[] = [];
    if (statement.background.state === 'present') blocks.push(block('题目背景', statement.background.content));
    if (statement.description.state === 'present') blocks.push(block('题目描述', statement.description.content));
    if (statement.input.state === 'present') blocks.push(block('输入格式', statement.input.content));
    else if (statement.input.state === 'absent') blocks.push(block('输入格式', '本题无输入。'));
    if (statement.output.state === 'present') blocks.push(block('输出格式', statement.output.content));
    else if (statement.output.state === 'absent') blocks.push(block('输出格式', '本题无输出。'));
    if (statement.examples.state === 'present') {
        const items = statement.examples.items.map((item, index) => {
            const input = fenced('input', index + 1, item.inputEmpty ? '' : item.input);
            const output = fenced('output', index + 1, item.outputEmpty ? '' : item.output);
            return [input, output, item.note.trim()].filter(Boolean).join('\n\n');
        });
        blocks.push(block('样例', items.join('\n\n')));
    }
    if (statement.hints.state === 'present') blocks.push(block('提示', statement.hints.content));
    return `${blocks.join('\n\n')}${blocks.length ? '\n' : ''}`;
}

export function deriveProgrammingStatementContent(statementInput: unknown, content?: unknown): string {
    const statement = normalizeProgrammingStatement(statementInput);
    const compiled = compileProgrammingStatement(statement);
    if (content !== undefined) {
        throw new ValidationError('content', null, localizedErrorText`结构化题面正文必须由服务端生成，不能直接提交`);
    }
    return compiled;
}

function validLimit(value: unknown, parse: (value: any) => number): boolean {
    if (value === undefined || value === null || value === '') return false;
    try {
        const parsed = parse(value);
        return Number.isFinite(parsed) && parsed > 0;
    } catch {
        return false;
    }
}

export function programmingStatementLimits(configInput: unknown): ProgrammingStatementLimitView {
    const config = parseProblemConfigObject({ config: configInput });
    if (!isPlainObject(config)) return { complete: false, time: null, memory: null };
    const time = config.time ?? config.timeMax ?? config.timeMin;
    const memory = config.memory ?? config.memoryMax ?? config.memoryMin;
    return { complete: validLimit(time, parseTimeMS) && validLimit(memory, parseMemoryMB), time, memory };
}

export function assertProgrammingStatementComplete(statementInput: unknown, configInput: unknown): ProgrammingStatement {
    const statement = normalizeProgrammingStatement(statementInput);
    const unresolved = [
        statement.background.state === 'undecided' && '背景',
        statement.description.state === 'undecided' && '描述',
        statement.input.state === 'undecided' && '输入',
        statement.output.state === 'undecided' && '输出',
        statement.examples.state === 'undecided' && '样例',
        statement.hints.state === 'undecided' && '提示',
    ].filter(Boolean);
    if (unresolved.length) fail('programmingStatement', localizedErrorText`unresolved sections: ${unresolved.join('、')}`);
    if (statement.description.state !== 'present' || !statement.description.content.trim()) {
        fail('description.content', localizedErrorText`description must be present and non-empty`);
    }
    if (statement.background.state === 'present' && !statement.background.content.trim()) {
        fail('background.content', localizedErrorText`present background must be non-empty`);
    }
    if (statement.input.state === 'present' && !statement.input.content.trim()) {
        fail('input.content', localizedErrorText`present input must be non-empty`);
    }
    if (statement.output.state === 'present' && !statement.output.content.trim()) {
        fail('output.content', localizedErrorText`present output must be non-empty`);
    }
    if (statement.hints.state === 'present' && !statement.hints.content.trim()) {
        fail('hints.content', localizedErrorText`present hints must be non-empty`);
    }
    if (!programmingStatementLimits(configInput).complete) fail('config', localizedErrorText`time and memory limits must be configured`);
    return statement;
}

export function assertProgrammingStatementProjection(statementInput: unknown, configInput: unknown, content: unknown): ProgrammingStatement {
    const statement = assertProgrammingStatementComplete(statementInput, configInput);
    if (typeof content !== 'string' || compileProgrammingStatement(statement) !== content) {
        fail('content', localizedErrorText`structured statement projection differs from canonical`);
    }
    return statement;
}

export function programmingStatementClientView(statementInput: unknown, configInput: unknown): ProgrammingStatementClientView {
    const statement = normalizeProgrammingStatement(statementInput);
    return {
        schemaVersion: PROGRAMMING_STATEMENT_SCHEMA_VERSION,
        locale: PROGRAMMING_STATEMENT_LOCALE,
        ...(statement.background.state === 'present' ? { background: { content: statement.background.content } } : {}),
        description: { ...statement.description },
        input: { ...statement.input },
        output: { ...statement.output },
        ...(statement.examples.state === 'present' ? { examples: { items: statement.examples.items.map((item) => ({ ...item })) } } : {}),
        ...(statement.hints.state === 'present' ? { hints: { content: statement.hints.content } } : {}),
        limits: programmingStatementLimits(configInput),
    };
}

function sourceFingerprint(source: string): string {
    return createHash('sha256').update(source).digest('hex');
}

const STANDARD_HEADINGS = new Map([
    ['题目背景', 'background'],
    ['题目描述', 'description'],
    ['输入格式', 'input'],
    ['输出格式', 'output'],
    ['样例', 'examples'],
    ['提示', 'hints'],
] as const);

function parseExampleSection(source: string): { items: ProgrammingStatementExample[]; unclassified: string } {
    const items: ProgrammingStatementExample[] = [];
    let remaining = source.trim();
    let expected = 1;
    while (remaining) {
        const input = remaining.match(/^```input(\d+)\n([\s\S]*?)\n```\s*/);
        if (!input || Number(input[1]) !== expected) break;
        const afterInput = remaining.slice(input[0].length);
        const output = afterInput.match(/^```output(\d+)\n([\s\S]*?)\n```\s*/);
        if (!output || Number(output[1]) !== expected) break;
        remaining = afterInput.slice(output[0].length);
        const next = remaining.search(/^```input\d+\n/m);
        const note = (next < 0 ? remaining : remaining.slice(0, next)).trim();
        remaining = next < 0 ? '' : remaining.slice(next);
        items.push({
            input: input[2],
            inputEmpty: input[2] === '',
            output: output[2],
            outputEmpty: output[2] === '',
            note,
        });
        expected++;
    }
    return { items, unclassified: remaining.trim() };
}

export function previewLegacyProgrammingStatement(source: string): LegacyProgrammingStatementPreview {
    if (typeof source !== 'string') fail('content', localizedErrorText`legacy content must be text`);
    const sections = new Map<string, string[]>();
    const unclassified: string[] = [];
    let target: string | null = null;
    let unknown = false;
    for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
        const heading = line.match(/^## ([^\n]+)$/);
        if (heading) {
            const known = STANDARD_HEADINGS.get(heading[1] as any);
            if (known && !sections.has(known)) {
                target = known;
                unknown = false;
                sections.set(known, []);
            } else {
                target = null;
                unknown = true;
                unclassified.push(line);
            }
            continue;
        }
        if (unknown || !target) unclassified.push(line);
        else sections.get(target)!.push(line);
    }
    const statement = emptyProgrammingStatement();
    const assignText = (key: 'background' | 'input' | 'output' | 'hints') => {
        if (!sections.has(key)) return;
        const content = sections.get(key)!.join('\n').trim();
        statement[key] = { state: 'present', content };
    };
    assignText('background');
    assignText('input');
    assignText('output');
    assignText('hints');
    if (sections.has('description')) {
        statement.description = { state: 'present', content: sections.get('description')!.join('\n').trim() };
    }
    if (sections.has('examples')) {
        const parsed = parseExampleSection(sections.get('examples')!.join('\n'));
        if (parsed.items.length) statement.examples = { state: 'present', items: parsed.items };
        if (parsed.unclassified) unclassified.push(parsed.unclassified);
    }
    return {
        statement: normalizeProgrammingStatement(statement),
        unclassified: unclassified.join('\n').trim(),
        fingerprint: sourceFingerprint(source),
    };
}

export function assertLegacyProgrammingStatementFingerprint(source: string, fingerprint: string): void {
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || sourceFingerprint(source) !== fingerprint) {
        fail('conversionFingerprint', localizedErrorText`legacy statement changed after conversion preview`);
    }
}
