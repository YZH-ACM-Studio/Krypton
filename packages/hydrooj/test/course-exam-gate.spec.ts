import { expect } from 'chai';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { ERROR_MESSAGE_TRANSLATIONS, lookupErrorMessageTranslation } from '@hydrooj/framework';

const hydroojRoot = resolve(__dirname, '..');
const repoRoot = resolve(hydroojRoot, '../..');

const COURSE_EXAM_IMPL_FILES = ['src/lib/course-exam.ts', 'src/lib/course-exam-gate.ts'] as const;

const COMMA_ERROR_KEYS = ['指定章节不存在，无法设置观看门槛', '还不能参加考试，还需看完 {0} 个视频'] as const;

const COURSE_EXAM_ERROR_KEYS = [
    '该考试不是选择题考试',
    '这场考试已绑定其它课程',
    '结业考试门槛无效',
    '指定章节不存在，无法设置观看门槛',
    '还不能参加考试',
    '还不能参加考试，还需看完 {0} 个视频',
    '还需看完 {0} 个视频',
] as const;

function readRepo(relative: string) {
    return readFileSync(resolve(repoRoot, relative), 'utf8');
}

function readHydrooj(relative: string) {
    return readFileSync(resolve(hydroojRoot, relative), 'utf8');
}

function implPaths() {
    return COURSE_EXAM_IMPL_FILES.map((relative) => resolve(hydroojRoot, relative)).filter((path) => existsSync(path));
}

function courseExamImplSource() {
    const paths = implPaths();
    if (!paths.length) {
        throw new Error('course-exam implementation source is missing (src/lib/course-exam.ts or src/lib/course-exam-gate.ts)');
    }
    return paths.map((path) => readFileSync(path, 'utf8')).join('\n');
}

function extractFunction(source: string, name: string) {
    const start = source.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`));
    if (start < 0) throw new Error(`missing function ${name}`);
    const header = source.slice(start);
    const body = header.match(/\)\s*(?::[^{=]+)?\{/);
    if (!body || body.index == null) throw new Error(`missing body for ${name}`);
    return extractBalanced(source, start + body.index);
}

function functionSource(name: string) {
    for (const relative of COURSE_EXAM_IMPL_FILES) {
        const path = resolve(hydroojRoot, relative);
        if (!existsSync(path)) continue;
        const source = readFileSync(path, 'utf8');
        if (new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`).test(source)) {
            return extractFunction(source, name);
        }
    }
    throw new Error(`${name} is not defined in src/lib/course-exam.ts or src/lib/course-exam-gate.ts`);
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

function extractNamed(source: string, marker: string, after = 0) {
    const start = source.indexOf(marker, after);
    if (start < 0) throw new Error(`missing ${JSON.stringify(marker)}`);
    return extractBalanced(source, start);
}

function firstIndex(source: string, needles: string[]) {
    const hits = needles.map((needle) => source.indexOf(needle)).filter((index) => index >= 0);
    if (!hits.length) return -1;
    return Math.min(...hits);
}

function assertGateBeforeAttend(label: string, body: string) {
    const gateAt = body.indexOf('assertCourseExamWatchGate');
    const attendAt = firstIndex(body, ['contest.attend', 'contestModel.attend']);
    expect(gateAt, `${label} must call assertCourseExamWatchGate`).to.be.at.least(0);
    expect(attendAt, `${label} must still call contest.attend / contestModel.attend`).to.be.at.least(0);
    expect(gateAt, `${label} must run the watch gate before auto-attend`).to.be.lessThan(attendAt);
}

function placeholderIndexes(template: string) {
    return [...template.matchAll(/\{(0|[1-9]\d*)\}/g)].map((match) => Number(match[1]));
}

function video(partial: Record<string, unknown> = {}) {
    return {
        id: 'cv_abcdefghijklmnopqr1',
        title: '消防一',
        filename: 'fire.mp4',
        ext: 'mp4',
        size: 1024,
        sha256: 'a'.repeat(64),
        durationMs: 10_000,
        confirmed: true,
        contentRevision: 1,
        ...partial,
    };
}

function sampleDag() {
    return [
        {
            _id: 1,
            title: '第一章',
            requireNids: [],
            pids: [1001, 1002],
            videos: [
                video({ id: 'cv_chapter_confirmed01', title: '章确认片' }),
                video({ id: 'cv_chapter_unconfirm01', title: '章未确认', confirmed: false, durationMs: 0 }),
            ],
            sections: [
                {
                    _id: 11,
                    title: '小节',
                    pids: [2001],
                    videos: [video({ id: 'cv_section_confirmed01', title: '节确认片' })],
                },
            ],
        },
        {
            _id: 2,
            title: '第二章',
            requireNids: [],
            pids: [3001],
            videos: [video({ id: 'cv_chapter2_confirmed1', title: '第二章片' })],
            sections: [],
        },
    ];
}

function callCompute(fn: Function, dag: unknown, progress: unknown, gate: unknown) {
    if (fn.length >= 3) return fn(dag, progress, gate);
    return fn({ dag, progress, gate });
}

function readProgress(result: unknown) {
    if (!result || typeof result !== 'object') throw new Error(`progress result must be an object, got ${JSON.stringify(result)}`);
    const row = result as Record<string, unknown>;
    const done = row.done ?? row.doneCount;
    const total = row.total ?? row.totalCount;
    const passed = row.passed ?? row.ok ?? row.allowed;
    if (typeof done !== 'number' || typeof total !== 'number' || typeof passed !== 'boolean') {
        throw new TypeError(`unexpected progress shape: ${JSON.stringify(result)}`);
    }
    return {
        done,
        total,
        passed,
        remaining: typeof row.remaining === 'number' ? row.remaining : total - done,
        reason: row.reason ?? null,
    };
}

describe('P6 course exam gate', () => {
    it('1. unbound exam: 0 bound courses return without throwing', () => {
        const gate = functionSource('assertCourseExamWatchGate');
        expect(gate).to.match(/findCoursesBoundToExam|courseExam\.contestId/);
        expect(gate).to.match(/\.length\s*===?\s*0|!\w+\.length/);
        expect(gate).not.to.match(/if\s*\([^)]*length\s*===?\s*0[^)]*\)\s*throw/);
    });

    it('2. homework / non-exam bindings are rejected', () => {
        const resolveSource = functionSource('resolveCourseExamForSave');
        expect(resolveSource).to.match(/rule\s*!==\s*['"]exam['"]|rule\s*===?\s*['"]exam['"]/);
        expect(resolveSource).to.include('该考试不是选择题考试');
        expect(readHydrooj('src/handler/course.ts')).to.include('resolveCourseExamForSave');
    });

    it('3. two courses with the same contestId fail closed on save and read', () => {
        const resolveSource = functionSource('resolveCourseExamForSave');
        const handler = readHydrooj('src/handler/course.ts');
        expect(resolveSource).to.include('findCoursesBoundToExam');
        expect(resolveSource).to.include('这场考试已绑定其它课程');
        expect(handler).to.include('isCourseExamDuplicateKey');
        expect(handler).to.include('这场考试已绑定其它课程');
        const gate = functionSource('assertCourseExamWatchGate');
        expect(gate).to.match(/\.length\s*>\s*1|\.length\s*>=\s*2/);
        expect(gate).to.include('这场考试已绑定其它课程');
    });

    it('4. hidden courses reject students from the bound exam', () => {
        const gate = functionSource('assertCourseExamWatchGate');
        expect(gate).to.include('isCourseHidden');
        expect(gate).to.include('该课程已隐藏');
        const hiddenAt = gate.indexOf('该课程已隐藏');
        const bypassAt = firstIndex(gate, ['canManageCourse']);
        expect(bypassAt, 'bypass must be decided before the hidden-course student reject').to.be.at.least(0);
        expect(bypassAt).to.be.lessThan(hiddenAt);
    });

    it('5. already attending skips the watch recompute', () => {
        const gate = functionSource('assertCourseExamWatchGate');
        const attendAt = firstIndex(gate, ['.attend', 'tsdoc?.attend', 'getStatus']);
        const computeAt = gate.indexOf('computeCourseExamWatchProgress');
        expect(attendAt, 'attend status must be read inside the gate').to.be.at.least(0);
        expect(computeAt, 'watch progress must still be computed for non-attendees').to.be.at.least(0);
        expect(attendAt, 'attend check must run before computeCourseExamWatchProgress').to.be.lessThan(computeAt);
    });

    it('6. auto-attend happens only after assertCourseExamWatchGate', () => {
        const paper = readHydrooj('src/handler/paper.ts');
        const contest = readHydrooj('src/handler/contest.ts');
        const vigil = readHydrooj('src/lib/vigil-integration-attendance.ts');
        assertGateBeforeAttend('ensureExamModeAccess', extractNamed(paper, 'async function ensureExamModeAccess'));
        const paperBase = extractNamed(paper, 'class PaperBaseHandler');
        assertGateBeforeAttend('PaperBaseHandler._prepare', extractNamed(paperBase, 'async _prepare('));
        assertGateBeforeAttend('ContestDetailHandler.postAttend', extractNamed(contest, 'async postAttend('));
        const vigilAttend = extractNamed(vigil, 'export async function ensureVigilContestParticipation');
        assertGateBeforeAttend('ensureVigilContestParticipation', vigilAttend);
        expect(vigilAttend).to.include('getById');
        expect(vigilAttend).not.to.match(/assertCourseExamWatchGate\(\{[\s\S]*user:\s*handler\.user/);
    });

    it('7. a completedAt on an old contentRevision does not count', () => {
        const compute = functionSource('computeCourseExamWatchProgress');
        expect(compute).to.include('contentRevision');
        expect(compute).to.match(/completedAt|isCourseVideoComplete/);
    });

    it('8. total===0 confirmed videos fail closed', () => {
        const compute = functionSource('computeCourseExamWatchProgress');
        expect(compute).to.match(/total\s*===?\s*0/);
        expect(compute).not.to.match(/total\s*===?\s*0[^;{]{0,80}return\s*\{[^}]*passed:\s*true/);
    });

    it('9. percent/chapter/all count confirmed chapter+section videos, not problems, and percent uses floor', () => {
        const compute = functionSource('computeCourseExamWatchProgress');
        expect(courseExamImplSource()).to.match(/studentVisibleVideos|confirmed\s*===?\s*true/);
        expect(compute).to.match(/sections|listCourseVideos/);
        expect(compute).to.match(/Math\.floor\([\s\S]{0,80}100[\s\S]{0,40}(?:done|completed|passed)/);
        expect(compute).not.to.include('courseUnitProgress');
        expect(compute).not.to.match(/\bpids\b/);
        expect(compute).to.match(/['"]percent['"]/);
        expect(compute).to.match(/['"]chapter['"]/);
        expect(compute).to.match(/['"]all['"]/);
    });

    it('10. postCopy extra object does not write courseExam', () => {
        const course = readHydrooj('src/handler/course.ts');
        const start = course.indexOf('async postCopy(');
        const end = course.indexOf('async postDelete(', start);
        expect(start).to.be.at.least(0);
        expect(end).to.be.greaterThan(start);
        const postCopy = course.slice(start, end);
        const extraStart = postCopy.indexOf('{', postCopy.indexOf('training.add('));
        expect(extraStart).to.be.at.least(0);
        const extra = extractBalanced(postCopy, extraStart);
        expect(extra).to.include("kind: 'course'");
        expect(extra).not.to.match(/(?:^|[^\w.])courseExam\s*:/m);
        expect(postCopy).not.to.match(/(?:^|[^\w.])courseExam\s*:/m);
    });

    it('11. contest list filter is unchanged and does not mention courseExam', () => {
        const contest = readHydrooj('src/handler/contest.ts');
        const list = extractNamed(contest, 'export class ContestListHandler');
        const get = extractNamed(list, 'async get(');
        expect(get).to.include('rule: { $in: rules }');
        expect(get).to.match(/\.\.\.\(rule \? \{ rule \} : \{ rule: \{ \$in: rules \} \}\)/);
        expect(get).not.to.match(/courseExam/);
    });

    it('12. unique index courseExamContest uses $exists:true only', () => {
        const document = readHydrooj('src/model/document.ts');
        const nameAt = firstIndex(document, ["name: 'courseExamContest'", 'name: "courseExamContest"']);
        expect(nameAt, 'document.ts must declare index courseExamContest').to.be.at.least(0);
        let index = '';
        for (let start = document.lastIndexOf('{', nameAt); start >= 0; start = document.lastIndexOf('{', start - 1)) {
            const block = extractBalanced(document, start);
            if (block.includes('courseExamContest') && block.includes('courseExam.contestId') && /unique:\s*true/.test(block)) {
                index = block;
                break;
            }
        }
        expect(index, 'could not extract the courseExamContest index object').to.not.equal('');
        expect(index).to.include('unique: true');
        expect(index).to.include('domainId: 1');
        expect(index).to.match(/'courseExam\.contestId':\s*1/);
        expect(index).to.match(/docType:\s*(40|TYPE_TRAINING|document\.TYPE_TRAINING)/);
        expect(index).to.include("kind: 'course'");
        expect(index).to.match(/'courseExam\.contestId':\s*\{\s*\$exists:\s*true\s*\}/);
        expect(index).not.to.match(/\$exists:\s*false/);
        expect(index).not.to.match(/\$ne|\$not|\$or/);
    });

    it('13. Chinese-comma error keys exist and are quoted in the catalog source', () => {
        const catalog = readRepo('framework/framework/error-catalog.ts');
        for (const key of COURSE_EXAM_ERROR_KEYS) {
            expect(ERROR_MESSAGE_TRANSLATIONS[key], key).to.be.an('object');
            expect(ERROR_MESSAGE_TRANSLATIONS[key]['zh-CN']).to.equal(key);
            expect(ERROR_MESSAGE_TRANSLATIONS[key].en).to.match(/[A-Za-z]/);
            expect(ERROR_MESSAGE_TRANSLATIONS[key].en).not.to.match(/jieye|menkan|kaoshi/i);
            expect(placeholderIndexes(ERROR_MESSAGE_TRANSLATIONS[key].en)).to.deep.equal(placeholderIndexes(key));
            expect(lookupErrorMessageTranslation(key, 'zh-CN')).to.equal(key);
            expect(lookupErrorMessageTranslation(key, 'en')).to.equal(ERROR_MESSAGE_TRANSLATIONS[key].en);
        }
        for (const key of COMMA_ERROR_KEYS) {
            expect(catalog).to.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:`));
            expect(catalog).not.to.match(new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'm'));
        }
        expect(catalog).not.to.match(/该课程已隐藏:[\s\S]{0,80}该课程已隐藏:/);
        expect(catalog).not.to.match(/你不在该课程的可见范围内:[\s\S]{0,80}你不在该课程的可见范围内:/);
    });

    it('14. bypass is canManageCourse or contest manager, never a student role', () => {
        const gate = functionSource('assertCourseExamWatchGate');
        expect(gate).to.include('canManageCourse');
        expect(gate).to.match(/PERM_EDIT_CONTEST|hasPerm\(\s*PERM\.PERM_EDIT_CONTEST/);
        expect(gate).to.match(/own\(/);
        expect(gate).to.include('PRIV_EDIT_SYSTEM');
        expect(gate).not.to.match(/role\s*===?\s*['"]student['"]/);
        expect(gate).not.to.match(/role\s*===?\s*['"]default['"]/);
        const bypassAt = gate.indexOf('canManageCourse');
        const hiddenAt = gate.indexOf('该课程已隐藏');
        const computeAt = gate.indexOf('computeCourseExamWatchProgress');
        expect(bypassAt).to.be.lessThan(hiddenAt);
        expect(hiddenAt).to.be.lessThan(computeAt);
    });
});

describe('P7 locked course-exam protocol', () => {
    it('AGENTS.md 课程结业考试协议 matches the locked PLAN and is not a second protocol', () => {
        const agents = readRepo('AGENTS.md');
        const plan = readRepo('docs/PLAN-2026-09-15-course-exam-gate.md');
        const start = agents.indexOf('## 课程结业考试协议');
        const end = agents.indexOf('## 课程隐藏与删除协议');
        expect(start).to.be.at.least(0);
        expect(end).to.be.greaterThan(start);
        const protocol = agents.slice(start, end);
        expect((agents.match(/## 课程结业考试协议/g) || []).length).to.equal(1);
        for (const token of [
            "kind:'course'",
            "rule:'exam'",
            'TrainingDoc.courseExam',
            "gate:'percent'|'chapter'|'all'",
            'exact-key',
            '缺字段 = 未绑定',
            '禁止 Vigil ExamEvent',
            '解锁令牌',
            'auto-attend',
            '0 门课绑定则本函数放行',
            '>1 门 fail closed',
            '已 attend 本场不因观看回退',
            '课程隐藏时学生不能进绑定考试',
            '比赛列表不因门槛隐藏这场 exam',
            '复制课程不复制绑定',
            '不把课程班级同步进 assign',
            '不改 Vigil 协议',
            '不算题目',
            'floor',
            '禁止读成未绑定',
        ]) {
            expect(protocol, token).to.include(token);
        }
        expect(plan).to.include('一门课 0 或 1 场');
        expect(plan).to.include("rule === 'exam'");
        expect(plan).to.include('一场 exam 最多被一门课绑定');
        expect(plan).to.match(/postCopy[`\s]*不写/);
        expect(plan).to.include('courseExam');
        expect(plan).to.include('必须在 auto-attend 之前调用');
        expect(protocol).not.to.include('解锁快照');
        expect(protocol).to.include('禁止 Vigil ExamEvent');
    });
});

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

const { ObjectId: MongoObjectId } = require('mongodb');
const stubContestId = new MongoObjectId('64a000000000000000000801');
let stubContestRule = 'exam';
let stubBoundCourses: Array<{ docId: { equals(id: unknown): boolean } }> = [];
let stubContestMissing = false;

function loadCourseExamModuleWithStubs(): Record<string, any> | null {
    const paths = implPaths();
    if (!paths.length) return null;
    const Module = require('module');
    const originalLoad = Module._load;
    const contestStub = {
        get: async () => {
            if (stubContestMissing) throw new TestContestNotFoundError('missing');
            return { rule: stubContestRule, docId: stubContestId };
        },
    };
    const documentStub = {
        TYPE_TRAINING: 40,
        getMulti: () => ({
            toArray: async () => stubBoundCourses,
        }),
    };
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename && paths.includes(parent.filename)) {
            if (request === '../error') {
                return {
                    ContestNotFoundError: TestContestNotFoundError,
                    ValidationError: TestValidationError,
                    localizedErrorText: localizedStub,
                };
            }
            if (request === '../model/contest') return contestStub;
            if (request === '../model/document') return documentStub;
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const loaded: Record<string, any> = {};
        for (const path of paths) {
            delete require.cache[path];
            Object.assign(loaded, require(path));
        }
        return loaded;
    } finally {
        Module._load = originalLoad;
    }
}

let examModule: Record<string, any> | null = null;
let examLoadError: unknown = null;
try {
    examModule = loadCourseExamModuleWithStubs();
} catch (error) {
    examLoadError = error;
}
const computeFn = examModule?.computeCourseExamWatchProgress;
const parseFn = examModule?.parseCourseExamForm;
const readStoredFn = examModule?.readStoredCourseExam;
const findFn = examModule?.findCoursesBoundToExam;
const assertFn = examModule?.assertCourseExamWatchGate;
const resolveFn = examModule?.resolveCourseExamForSave;
const gateFileExists = existsSync(resolve(hydroojRoot, 'src/lib/course-exam-gate.ts'));
const schemaFileExists = existsSync(resolve(hydroojRoot, 'src/lib/course-exam.ts'));

describe('course exam gate unit imports', () => {
    it('loads implementation modules without swallowing the error', () => {
        if (examLoadError) throw examLoadError;
        if (schemaFileExists) {
            expect(typeof parseFn, 'parseCourseExamForm').to.equal('function');
            expect(typeof readStoredFn, 'readStoredCourseExam').to.equal('function');
            expect(typeof findFn, 'findCoursesBoundToExam').to.equal('function');
            expect(typeof resolveFn, 'resolveCourseExamForSave').to.equal('function');
        }
        if (gateFileExists) {
            expect(typeof computeFn, 'computeCourseExamWatchProgress').to.equal('function');
            expect(typeof assertFn, 'assertCourseExamWatchGate').to.equal('function');
        }
    });
});

if (typeof computeFn === 'function') {
    describe('computeCourseExamWatchProgress', () => {
        const dag = sampleDag();
        const finished = [
            { videoId: 'cv_chapter_confirmed01', contentRevision: 1, completedAt: new Date('2026-09-01T00:00:00Z') },
            { videoId: 'cv_section_confirmed01', contentRevision: 1, completedAt: new Date('2026-09-01T00:00:00Z') },
        ];

        it('uses floor for percent and ignores unconfirmed videos and problems', () => {
            const twoOfThree = readProgress(callCompute(computeFn, dag, finished, { contestId: 'exam', gate: 'percent', percent: 66 }));
            expect(twoOfThree.total).to.equal(3);
            expect(twoOfThree.done).to.equal(2);
            expect(twoOfThree.passed).to.equal(true);
            const justBelow = readProgress(callCompute(computeFn, dag, finished, { contestId: 'exam', gate: 'percent', percent: 67 }));
            expect(justBelow.passed).to.equal(false);
            expect(Math.floor((100 * 2) / 3)).to.equal(66);
        });

        it('includes section videos in chapter scope and ignores problems', () => {
            const chapterPass = readProgress(
                callCompute(computeFn, dag, finished, { contestId: 'exam', gate: 'chapter', chapterId: 1 }),
            );
            expect(chapterPass.total).to.equal(2);
            expect(chapterPass.done).to.equal(2);
            expect(chapterPass.passed).to.equal(true);
            const chapterFail = readProgress(
                callCompute(computeFn, dag, finished.slice(0, 1), { contestId: 'exam', gate: 'chapter', chapterId: 1 }),
            );
            expect(chapterFail.passed).to.equal(false);
        });

        it('all requires every confirmed video in the course', () => {
            const incomplete = readProgress(callCompute(computeFn, dag, finished, { contestId: 'exam', gate: 'all' }));
            expect(incomplete.total).to.equal(3);
            expect(incomplete.passed).to.equal(false);
            const complete = readProgress(
                callCompute(computeFn, dag, [...finished, { videoId: 'cv_chapter2_confirmed1', contentRevision: 1, completedAt: new Date() }], {
                    contestId: 'exam',
                    gate: 'all',
                }),
            );
            expect(complete.passed).to.equal(true);
        });

        it('does not count an old contentRevision completedAt', () => {
            const stale = readProgress(
                callCompute(
                    computeFn,
                    dag,
                    [
                        ...finished,
                        { videoId: 'cv_chapter2_confirmed1', contentRevision: 1, completedAt: new Date() },
                        { videoId: 'cv_chapter_confirmed01', contentRevision: 0, completedAt: new Date() },
                    ],
                    { contestId: 'exam', gate: 'percent', percent: 100 },
                ),
            );
            const bumpedDag = [
                {
                    ...dag[0],
                    videos: [video({ id: 'cv_chapter_confirmed01', title: '章确认片', contentRevision: 2 }), dag[0].videos[1]],
                },
                dag[1],
            ];
            const afterBump = readProgress(
                callCompute(
                    computeFn,
                    bumpedDag,
                    [
                        { videoId: 'cv_chapter_confirmed01', contentRevision: 1, completedAt: new Date() },
                        { videoId: 'cv_section_confirmed01', contentRevision: 1, completedAt: new Date() },
                        { videoId: 'cv_chapter2_confirmed1', contentRevision: 1, completedAt: new Date() },
                    ],
                    { contestId: 'exam', gate: 'all' },
                ),
            );
            expect(stale.total).to.equal(3);
            expect(afterBump.passed).to.equal(false);
            expect(afterBump.done).to.be.lessThan(afterBump.total);
        });

        it('fail-closes when there are no confirmed videos', () => {
            const empty = readProgress(callCompute(computeFn, [], [], { contestId: 'exam', gate: 'all' }));
            expect(empty.total).to.equal(0);
            expect(empty.passed).to.equal(false);
            const unconfirmedOnly = readProgress(
                callCompute(
                    computeFn,
                    [
                        {
                            _id: 1,
                            title: '空',
                            requireNids: [],
                            pids: [1],
                            videos: [video({ id: 'cv_unconfirmed_only001', confirmed: false, durationMs: 0 })],
                            sections: [],
                        },
                    ],
                    [{ videoId: 'cv_unconfirmed_only001', contentRevision: 1, completedAt: new Date() }],
                    { contestId: 'exam', gate: 'percent', percent: 100 },
                ),
            );
            expect(unconfirmedOnly.total).to.equal(0);
            expect(unconfirmedOnly.passed).to.equal(false);
        });
    });
}

if (typeof parseFn === 'function') {
    describe('parseCourseExamForm', () => {
        it('treats a blank contestId as unbind and fail-closes extras', () => {
            expect(parseFn({})).to.equal(null);
            expect(parseFn({ contestId: '', gate: 'all' })).to.equal(null);
            expect(() => parseFn({ contestId: '64a000000000000000000801', gate: 'all', extra: 'nope' })).to.throw();
            const parsed = parseFn({ contestId: '64a000000000000000000801', gate: 'all' });
            expect(parsed?.gate).to.equal('all');
            expect(String(parsed?.contestId)).to.equal('64a000000000000000000801');
        });
    });
}

if (typeof readStoredFn === 'function') {
    describe('readStoredCourseExam', () => {
        it('fail-closes missing or extra keys on the stored exact-key object', () => {
            const contestId = new MongoObjectId('64a000000000000000000801');
            expect(() => readStoredFn(null)).to.throw();
            expect(() => readStoredFn({})).to.throw();
            expect(() => readStoredFn({ contestId, gate: 'all', extra: true })).to.throw();
            expect(readStoredFn({ contestId, gate: 'all' })).to.deep.equal({ contestId, gate: 'all' });
        });
    });
}

if (typeof resolveFn === 'function' && typeof parseFn === 'function') {
    describe('resolveCourseExamForSave', () => {
        const binding = () => parseFn({ contestId: stubContestId.toHexString(), gate: 'all' });

        it('rejects homework and other non-exam rules', async () => {
            stubContestRule = 'homework';
            stubBoundCourses = [];
            stubContestMissing = false;
            try {
                await resolveFn({ domainId: 'system', courseId: null, dag: sampleDag(), binding: binding() });
                throw new Error('expected homework binding to be rejected');
            } catch (error) {
                expect(error).to.be.instanceOf(Error);
                expect((error as Error).message).to.match(/该考试不是选择题考试/);
            }
        });

        it('rejects a contestId already bound to another course', async () => {
            stubContestRule = 'exam';
            stubBoundCourses = [{ docId: { equals: () => false } }];
            stubContestMissing = false;
            try {
                await resolveFn({ domainId: 'system', courseId: stubContestId, dag: sampleDag(), binding: binding() });
                throw new Error('expected duplicate contest binding to be rejected');
            } catch (error) {
                expect(error).to.be.instanceOf(Error);
                expect((error as Error).message).to.match(/这场考试已绑定其它课程/);
            }
        });
    });
}
