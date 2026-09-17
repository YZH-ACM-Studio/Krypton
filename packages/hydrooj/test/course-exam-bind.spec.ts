import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { ERROR_MESSAGE_TRANSLATIONS, lookupErrorMessageTranslation } from '@hydrooj/framework';

const hydroojRoot = resolve(__dirname, '..');
const repoRoot = resolve(hydroojRoot, '../..');

const BIND_ERROR_KEYS = [
    '结业考试不能使用客户端入场',
    '结业考试不能使用比赛分配名单',
    '结业考试不能绑定空试卷',
    '课程还没有已确认视频，不能设置观看门槛',
    '指定章节没有已确认视频，不能设置观看门槛',
    '结业考试的参赛范围必须覆盖课程可见班级',
    '全站可见的课程不能绑定限定范围的结业考试',
    '仍有收集要求先完成结业考试，不能解除绑定',
] as const;

const COMMA_ERROR_KEYS = [
    '课程还没有已确认视频，不能设置观看门槛',
    '指定章节没有已确认视频，不能设置观看门槛',
    '仍有收集要求先完成结业考试，不能解除绑定',
] as const;

function readRepo(relative: string) {
    return readFileSync(resolve(repoRoot, relative), 'utf8');
}

function readHydrooj(relative: string) {
    return readFileSync(resolve(hydroojRoot, relative), 'utf8');
}

function extractBalanced(source: string, start: number) {
    const brace = source.indexOf('{', start);
    if (brace < 0) throw new Error(`no block starting at ${start}`);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error('unclosed block');
}

function extractFunction(source: string, name: string) {
    const start = source.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`));
    if (start < 0) throw new Error(`missing function ${name}`);
    const header = source.slice(start);
    const body = header.match(/\)\s*(?::[^{=]+)?\{/);
    if (!body || body.index == null) throw new Error(`missing body for ${name}`);
    return extractBalanced(source, start + body.index);
}

function video(partial: Record<string, unknown> = {}) {
    return {
        id: 'cv_abcdefghijklmnopqr1',
        title: '片',
        filename: 'a.mp4',
        ext: 'mp4',
        size: 1024,
        sha256: 'a'.repeat(64),
        durationMs: 10_000,
        confirmed: true,
        contentRevision: 1,
        ...partial,
    };
}

function dagWithConfirmed() {
    return [
        {
            _id: 1,
            title: '一',
            requireNids: [],
            pids: [],
            videos: [video({ id: 'cv_chapter_confirmed001' })],
            sections: [],
        },
    ];
}

function localizedStub(strings: TemplateStringsArray, ...values: unknown[]) {
    const raw = strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');
    return { raw, toString: () => raw };
}

class TestValidationError extends Error {
    constructor(_field: string, _hint: unknown, detail: unknown) {
        const text = detail && typeof detail === 'object' && 'raw' in detail ? String((detail as { raw: unknown }).raw) : String(detail ?? '');
        super(text);
    }
}

class TestContestNotFoundError extends Error {}

const examPath = resolve(hydroojRoot, 'src/lib/course-exam.ts');
let stubContest: Record<string, unknown> = { rule: 'exam', entryMode: 'open', pids: [1] };
let stubBoundCourses: Array<{ docId: { equals(id: unknown): boolean } }> = [];

function loadCourseExamLib(): Record<string, any> {
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename === examPath) {
            if (request === '../error') {
                return {
                    ContestNotFoundError: TestContestNotFoundError,
                    ValidationError: TestValidationError,
                    localizedErrorText: localizedStub,
                };
            }
            if (request === '../model/contest') {
                return {
                    get: async () => stubContest,
                    isClientRequired: (tdoc: { entryMode?: string }) => tdoc.entryMode === 'client_required',
                };
            }
            if (request === '../model/document') {
                return {
                    TYPE_TRAINING: 40,
                    getMulti: () => ({ toArray: async () => stubBoundCourses }),
                };
            }
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[examPath];
        return require(examPath);
    } finally {
        Module._load = originalLoad;
    }
}

const examLib = loadCourseExamLib();
const decide = examLib.decideCourseExamBindConstraints as (input: {
    isClientRequired: boolean;
    hasAssign: boolean;
    hasPids: boolean;
    studentVisibleCount: number;
    gate: string;
    courseGroupIds: ObjectId[];
    participantScopeMode?: string;
    participantGroupIds?: ObjectId[];
}) => string | null;
const resolveFn = examLib.resolveCourseExamForSave as (params: Record<string, unknown>) => Promise<unknown>;
const parseFn = examLib.parseCourseExamForm as (input: Record<string, unknown>) => { contestId: ObjectId; gate: string };

function groupId(hex: string) {
    return new ObjectId(hex);
}

describe('course exam bind source contract', () => {
    it('resolveCourseExamForSave mentions isClientRequired, studentVisibleVideos, and courseGroupIds', () => {
        const resolveSource = extractFunction(readHydrooj('src/lib/course-exam.ts'), 'resolveCourseExamForSave');
        expect(resolveSource).to.include('isClientRequired');
        expect(resolveSource).to.include('studentVisibleVideos');
        expect(resolveSource).to.include('courseGroupIds');
        expect(resolveSource).to.include('decideCourseExamBindConstraints');
        expect(resolveSource).to.include('hasAssign');
        expect(resolveSource).to.match(/tdoc\.assign/);
        expect(resolveSource).to.include('hasPids');
        expect(resolveSource).to.match(/tdoc\.pids/);
        expect(resolveSource).not.to.match(/assign\s*:/);
        expect(resolveSource).not.to.include('contest.assign');
    });

    it('unbind on course edit calls existsRequiringCourseExam before unsetting courseExam', () => {
        const course = readHydrooj('src/handler/course.ts');
        const start = course.indexOf('async post(');
        expect(start, 'CourseEditHandler.post').to.be.at.least(0);
        const post = extractBalanced(course, start);
        const checkAt = post.indexOf('existsRequiringCourseExam');
        const unsetAt = post.indexOf('courseExam: 1');
        expect(checkAt, 'unbind must call existsRequiringCourseExam').to.be.at.least(0);
        expect(unsetAt, 'edit must still $unset courseExam').to.be.at.least(0);
        expect(checkAt, 'collect unbind check must run before $unset courseExam').to.be.lessThan(unsetAt);
        expect(post).to.include('仍有收集要求先完成结业考试，不能解除绑定');
        expect(post).to.include('courseGroupIds: groupIds');
        expect(post).to.match(/typeof collect\?\.existsRequiringCourseExam === 'function'/);
        expect(course).to.include('existsRequiringCourseExam?:');
        expect(post).not.to.match(/contest\.(edit|add|set)\(/);
    });

    it('serializeVideos uses isCourseVideoComplete when completedAt is missing', () => {
        const course = readHydrooj('src/handler/course.ts');
        const start = course.indexOf('const serializeVideos =');
        expect(start).to.be.at.least(0);
        const serialize = extractBalanced(course, start);
        expect(serialize).to.include('isCourseVideoComplete');
        expect(serialize).to.include('completedAt');
        expect(serialize).to.match(/progress\.ranges\s*\|\|\s*\[\]/);
        expect(course).to.match(/isCourseVideoComplete,/);
        expect(course).to.include('hydrateCourseExamContest(domainId, tdoc, this.user._id)');
        expect(course).to.include('contest.getStatus');
        expect(course).to.include('endAt.toISOString()');
        expect(course).to.include('missing: true');
    });

    it('catalogs the new teacher-facing bind errors', () => {
        const catalog = readRepo('framework/framework/error-catalog.ts');
        for (const key of BIND_ERROR_KEYS) {
            expect(ERROR_MESSAGE_TRANSLATIONS[key], key).to.be.an('object');
            expect(ERROR_MESSAGE_TRANSLATIONS[key]['zh-CN']).to.equal(key);
            expect(ERROR_MESSAGE_TRANSLATIONS[key].en).to.match(/[A-Za-z]/);
            expect(ERROR_MESSAGE_TRANSLATIONS[key].en).not.to.match(/jieye|menkan|kaoshi/i);
            expect(lookupErrorMessageTranslation(key, 'zh-CN')).to.equal(key);
            expect(lookupErrorMessageTranslation(key, 'en')).to.equal(ERROR_MESSAGE_TRANSLATIONS[key].en);
        }
        for (const key of COMMA_ERROR_KEYS) {
            expect(catalog).to.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:`));
        }
    });
});

describe('decideCourseExamBindConstraints', () => {
    const classA = groupId('64a0000000000000000000a1');
    const classB = groupId('64a0000000000000000000a2');
    const classC = groupId('64a0000000000000000000a3');

    it('rejects empty papers', () => {
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: false,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [],
            }),
        ).to.equal('empty_pids');
    });

    it('rejects leftover Hydro assign lists', () => {
        expect(
            decide({
                isClientRequired: false,
                hasAssign: true,
                hasPids: true,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [],
            }),
        ).to.equal('assign_set');
    });

    it('rejects client_required regardless of videos and scope', () => {
        expect(
            decide({
                isClientRequired: true,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 3,
                gate: 'all',
                courseGroupIds: [classA],
                participantScopeMode: 'none',
            }),
        ).to.equal('client_required');
    });

    it('rejects empty confirmed videos by gate scope', () => {
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 0,
                gate: 'all',
                courseGroupIds: [],
            }),
        ).to.equal('no_confirmed_videos');
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 0,
                gate: 'percent',
                courseGroupIds: [classA],
            }),
        ).to.equal('no_confirmed_videos');
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 0,
                gate: 'chapter',
                courseGroupIds: [classA],
            }),
        ).to.equal('no_chapter_confirmed_videos');
    });

    it('allows none/missing participant scope and covered groups', () => {
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [],
            }),
        ).to.equal(null);
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [classA],
                participantScopeMode: 'none',
            }),
        ).to.equal(null);
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [classA, classB],
                participantScopeMode: 'groups',
                participantGroupIds: [classC, classB, classA],
            }),
        ).to.equal(null);
    });

    it('rejects site-wide courses against any participant scope', () => {
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [],
                participantScopeMode: 'groups',
                participantGroupIds: [classA],
            }),
        ).to.equal('site_wide_scoped');
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [],
                participantScopeMode: 'schools',
            }),
        ).to.equal('site_wide_scoped');
    });

    it('rejects schools mode and uncovered group scope', () => {
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [classA],
                participantScopeMode: 'schools',
            }),
        ).to.equal('scope_uncovered');
        expect(
            decide({
                isClientRequired: false,
                hasAssign: false,
                hasPids: true,
                studentVisibleCount: 1,
                gate: 'all',
                courseGroupIds: [classA, classB],
                participantScopeMode: 'groups',
                participantGroupIds: [classA],
            }),
        ).to.equal('scope_uncovered');
    });
});

describe('resolveCourseExamForSave bind rejects', () => {
    it('rejects client_required exams after the exam-rule check', async () => {
        stubContest = { rule: 'exam', entryMode: 'client_required', pids: [1] };
        stubBoundCourses = [];
        try {
            await resolveFn({
                domainId: 'system',
                courseId: null,
                dag: dagWithConfirmed(),
                binding: parseFn({ contestId: '64a000000000000000000801', gate: 'all' }),
                courseGroupIds: [],
            });
            throw new Error('expected client_required bind to fail');
        } catch (error) {
            expect((error as Error).message).to.equal('结业考试不能使用客户端入场');
        }
    });

    it('rejects a chapter gate with no confirmed videos in that chapter', async () => {
        stubContest = { rule: 'exam', entryMode: 'open', pids: [1] };
        stubBoundCourses = [];
        try {
            await resolveFn({
                domainId: 'system',
                courseId: null,
                dag: [
                    {
                        _id: 1,
                        title: '空章',
                        requireNids: [],
                        pids: [],
                        videos: [video({ id: 'cv_unconfirmed_only0001', confirmed: false, durationMs: 0 })],
                        sections: [],
                    },
                ],
                binding: parseFn({ contestId: '64a000000000000000000801', gate: 'chapter', chapterId: 1 }),
                courseGroupIds: [],
            });
            throw new Error('expected empty chapter videos to fail');
        } catch (error) {
            expect((error as Error).message).to.equal('指定章节没有已确认视频，不能设置观看门槛');
        }
    });

    it('rejects an exam with no paper pids', async () => {
        stubContest = { rule: 'exam', entryMode: 'open', pids: [] };
        stubBoundCourses = [];
        try {
            await resolveFn({
                domainId: 'system',
                courseId: null,
                dag: dagWithConfirmed(),
                binding: parseFn({ contestId: '64a000000000000000000801', gate: 'all' }),
                courseGroupIds: [],
            });
            throw new Error('expected empty paper bind to fail');
        } catch (error) {
            expect((error as Error).message).to.equal('结业考试不能绑定空试卷');
        }
    });
});
