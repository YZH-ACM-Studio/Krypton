import { Time } from '@hydrooj/utils/lib/utils';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { after, beforeEach, describe, it } from 'node:test';
import { createDraftConfig, type OfficialAnswer, type SetConfig } from '@hydrooj/common';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import { requirePublishedForStudent, storedSetConfigOrNull } from '../src/lib/set-publication';
import type { RoundDoc } from '../src/model/set-round';
import { registerStudentDirectory } from '../src/service/student-directory';

const Module = require('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

const hydroHost = globalThis as unknown as {
    Hydro?: { model: Record<string, unknown> };
};
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};

const setting = require('../src/model/setting') as typeof import('../src/model/setting');

const { PERM, PRIV } = require('../src/model/builtin') as {
    PERM: {
        PERM_ATTEND_HOMEWORK: bigint;
        PERM_EDIT_HOMEWORK: bigint;
        PERM_EDIT_HOMEWORK_SELF: bigint;
    };
    PRIV: { PRIV_EDIT_SYSTEM: number };
};

const DOMAIN = 'system';
const STUDENT_UID = 42;
const MANAGER_UID = 7;
const OWNER_UID = 99;
const OBJECTIVE_PID = 11;
const FILL_PID = 12;
const BARE_PID = 13;
const SECRET_ANSWER = 'secret-answer';
const FILL_REGION = 'r_abcdefghijkl';
const homeworkId = new ObjectId('64b0000000000000000000b4');
const HOMEWORK_GROUP = new ObjectId('64b0000000000000000000c4');
const HOUR = Time.hour;
const STATEMENT = '题面 (file://statement.png)';

registerStudentDirectory(
    new InMemoryStudentDirectory({
        students: [studentRecord({ domainId: DOMAIN, boundUserId: STUDENT_UID, groupIds: [HOMEWORK_GROUP] })],
    }),
);

interface ClockDoc {
    beginAt: Date;
    endAt: Date;
    duration?: number;
    rule?: string;
}

interface StatusDoc {
    attend?: number;
    startAt?: Date | null;
    journal?: unknown[];
}

interface HomeworkDoc extends ClockDoc {
    domainId: string;
    docId: ObjectId;
    owner: number;
    maintainer: number[];
    rule: string;
    title: string;
    content: string;
    pids: number[];
    assign: string[];
    penaltySince: Date;
    participantScopeMode: string;
    participantGroupIds: ObjectId[];
    score?: Record<string, number>;
    setConfig?: SetConfig;
    _code?: string;
}

interface StoredProblem {
    docId: number;
    pid: number;
    owner: number;
    title: string;
    content: string;
    problemKind?: string;
    config: string | Record<string, unknown>;
    additional_file: Array<{ name: string }>;
}

interface Actor {
    _id: number;
    uname: string;
    group: string[];
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
    own: (doc: { owner?: number; maintainer?: number[] }) => boolean;
}

interface DetailHandler {
    domain: { _id: string };
    user: Actor;
    response: { body: Record<string, unknown>; template?: string; redirect?: string };
    request: { ip: string; method: string };
    paginate: (...args: unknown[]) => Promise<[unknown[], number, number]>;
    url: (name: string, args?: Record<string, unknown>) => string;
    back: () => void;
    checkPerm: (perm: bigint) => void;
    prepare: (domainId: string, tid: ObjectId) => Promise<void>;
    get: (domainId: string, tid: ObjectId, page?: number) => Promise<void>;
}

interface WorkspaceItem {
    pid?: number;
    title?: string;
    score?: number;
    lastScore?: number | null;
    feedback?: { score: boolean; verdict: boolean; details: boolean };
}

interface WorkspaceGroup {
    kind?: string;
    items?: WorkspaceItem[];
}

interface WorkspaceView {
    kind?: string;
    mode?: string;
    locked?: { reason?: string } | null;
    groups?: WorkspaceGroup[];
    totals?: { problemCount?: number; score?: number | null };
    officialRound?: { id: string; roundNo: number } | null;
    action?: { canAttend?: boolean; canStart?: boolean; invitationRequired?: boolean };
    urls?: {
        submitKind?: string | null;
        attend?: string | null;
        manage?: string | null;
        saveAnswers?: string | null;
        draftList?: string | null;
        draftUpsert?: string | null;
    };
}

interface StatementConfig {
    questions?: unknown[];
    answers?: unknown;
    template?: { surface?: unknown };
}

interface StatementView {
    content?: string;
    config?: StatementConfig;
}

interface UrlHandler {
    url: (name: string, args?: Record<string, unknown>) => string;
}

interface FileCarrier {
    docId?: number;
    additional_file?: Array<{ name?: string }>;
}

let currentHomework: HomeworkDoc;
let status: StatusDoc = { attend: 1, journal: [] };
let storedRounds: RoundDoc[] = [];
let storedAnswers: OfficialAnswer[] = [];
let fillMode: 'text' | 'compile' | undefined = 'text';

function at(offset: number): Date {
    return new Date(Date.now() + offset);
}

function homeworkStartRequired(tdoc: ClockDoc, tsdoc?: StatusDoc | null): boolean {
    return tdoc.rule === 'homework' && typeof tdoc.duration === 'number' && tdoc.duration > 0 && !tsdoc?.startAt;
}

function isNotStarted(tdoc: ClockDoc): boolean {
    return new Date() < tdoc.beginAt;
}

function isDone(tdoc: ClockDoc, tsdoc?: StatusDoc | null): boolean {
    if (tdoc.endAt <= new Date()) return true;
    if (tsdoc?.startAt instanceof Date && typeof tdoc.duration === 'number' && tdoc.duration > 0) {
        return tsdoc.startAt.getTime() <= Date.now() - Math.floor(tdoc.duration * HOUR);
    }
    return false;
}

function isOngoing(tdoc: ClockDoc, tsdoc?: StatusDoc | null): boolean {
    const now = new Date();
    if (tsdoc && homeworkStartRequired(tdoc, tsdoc)) return false;
    if (tsdoc && isDone(tdoc, tsdoc) && tdoc.endAt > now) return false;
    return tdoc.beginAt <= now && now < tdoc.endAt;
}

function openHomework(extra: Partial<HomeworkDoc> = {}): HomeworkDoc {
    return {
        domainId: DOMAIN,
        docId: homeworkId,
        owner: OWNER_UID,
        maintainer: [],
        rule: 'homework',
        title: '作业',
        content: '',
        pids: [OBJECTIVE_PID, FILL_PID],
        assign: [],
        beginAt: at(-HOUR),
        endAt: at(4 * HOUR),
        penaltySince: at(4 * HOUR),
        participantScopeMode: 'groups',
        participantGroupIds: [HOMEWORK_GROUP],
        ...extra,
    };
}

function objectiveConfigYaml(): string {
    return [
        'type: objective',
        'answers:',
        '  "1":',
        `    - ${SECRET_ANSWER}`,
        '    - 10',
        '    - choices:',
        '        - 对',
        '        - 错',
    ].join('\n');
}

function fillConfig(): Record<string, unknown> {
    const { templateSourceHash } = require('../src/lib/problem-config') as {
        templateSourceHash: (source: string) => string;
    };
    const source = 'int total = 0;\nreturn total;';
    return {
        type: 'program_fill',
        mode: fillMode,
        ...(fillMode === 'compile' ? { langs: ['cc.cc17'], cases: [{ input: '1.in', output: '1.out' }] } : {}),
        template: {
            ...(fillMode === 'compile' ? { lang: 'cc.cc17' } : {}),
            source,
            sourceHash: templateSourceHash(source),
            publicRanges: [{ startLine: 0, endLine: 1 }],
            regions: [{ id: FILL_REGION, startLine: 1, endLine: 2, prompt: '填空' }],
        },
    };
}

function storedProblem(pid: number): StoredProblem | undefined {
    if (pid === OBJECTIVE_PID) {
        return {
            docId: OBJECTIVE_PID,
            pid: OBJECTIVE_PID,
            owner: 4,
            title: '单选',
            content: STATEMENT,
            problemKind: 'single',
            config: objectiveConfigYaml(),
            additional_file: [{ name: 'statement.png' }],
        };
    }
    if (pid === FILL_PID) {
        return {
            docId: FILL_PID,
            pid: FILL_PID,
            owner: 4,
            title: '程序填空',
            content: STATEMENT,
            problemKind: 'program_fill',
            config: fillConfig(),
            additional_file: [{ name: 'statement.png' }],
        };
    }
    if (pid === BARE_PID) {
        return {
            docId: BARE_PID,
            pid: BARE_PID,
            owner: 4,
            title: '编程',
            content: STATEMENT,
            config: 'type: default\n',
            additional_file: [{ name: 'statement.png' }],
        };
    }
    return undefined;
}

async function parseStoredConfig(config: string | Record<string, unknown>): Promise<Record<string, unknown>> {
    const testdata = require('../src/lib/testdataConfig') as {
        parseConfig: (raw: string | Record<string, unknown>, files: string[]) => Promise<Record<string, unknown>>;
    };
    const input = typeof config === 'string' ? config : structuredClone(config);
    return testdata.parseConfig(input, []);
}

function copyProblem(raw: StoredProblem, config: string | Record<string, unknown>): StoredProblem {
    return {
        ...raw,
        additional_file: raw.additional_file.map((file) => ({ ...file })),
        config,
    };
}

function bitsOf(perms: readonly bigint[]): bigint {
    let bits = 0n;
    for (const perm of perms) bits |= perm;
    return bits;
}

function makeActor(uid: number, perms: readonly bigint[]): Actor {
    const permBits = bitsOf(perms);
    return {
        _id: uid,
        uname: `user-${uid}`,
        group: [],
        hasPerm(...wanted) {
            return wanted.every((item) => (permBits & item) === item);
        },
        hasPriv() {
            return false;
        },
        own(doc) {
            return doc.owner === uid || (doc.maintainer ?? []).includes(uid);
        },
    };
}

function textArg(value: unknown): string {
    if (value instanceof ObjectId) return value.toHexString();
    if (value == null) return '';
    return String(value);
}

function handlerUrl(name: string, args: Record<string, unknown> = {}): string {
    const tidText = textArg(args.tid);
    const pidText = textArg(args.pid);
    const ridText = textArg(args.rid);
    const filename = textArg(args.filename);
    const routes: Record<string, string> = {
        homework_detail: `/homework/${tidText}`,
        contest_detail: `/contest/${tidText}`,
        homework_draft_list: `/homework/${tidText}/draft`,
        homework_draft_upsert: `/homework/${tidText}/draft/${pidText}`,
        homework_scoreboard: `/homework/${tidText}/scoreboard`,
        homework_submit_kind: `/homework/${tidText}/submit-kind`,
        set_round_start_homework: `/homework/${tidText}/round/start`,
        set_round_answers_homework: `/homework/${tidText}/round/answers`,
        set_round_save_homework: `/homework/${tidText}/round/save`,
        set_round_hand_in_homework: `/homework/${tidText}/round/hand-in`,
        problem_file_download: `/p/${pidText}/file/${filename}`,
        problem_submit: `/p/${pidText}/submit`,
        record_detail: `/record/${ridText}`,
        record_main: '/record',
        training_main: '/problem-sets',
    };
    let path = routes[name] ?? `/missing/${name}`;
    const query = args.query;
    if (query && typeof query === 'object' && !Array.isArray(query)) {
        const pairs = Object.entries(query as Record<string, unknown>)
            .filter(([, value]) => value != null)
            .map(([key, value]) => `${key}=${String(value)}`);
        if (pairs.length) path += `?${pairs.join('&')}`;
    }
    return path;
}

function fileCarrier(pdoc: Record<string, unknown>): FileCarrier {
    const docId = typeof pdoc.docId === 'number' ? pdoc.docId : undefined;
    const rawFiles = Array.isArray(pdoc.additional_file) ? pdoc.additional_file : [];
    const additional_file = rawFiles.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const name = (item as { name?: unknown }).name;
        return typeof name === 'string' ? [{ name }] : [];
    });
    return { additional_file, docId };
}

function absolutizeProblemFileUrls(handler: UrlHandler, content: string, pdoc: FileCarrier, tid: ObjectId | string): string {
    if (!content || pdoc.docId == null) return content;
    const tidHex = typeof tid === 'string' ? tid : tid.toHexString();
    const placeholder = 'KRYPTONFILEPH';
    const sample = handler.url('problem_file_download', { filename: placeholder, pid: pdoc.docId });
    const absBase = sample.slice(0, sample.lastIndexOf(placeholder));
    const withTid = (url: string) => `${url}${url.includes('?') ? '&' : '?'}tid=${tidHex}`;
    return content.replace(/file:\/\/([^ \n)\\"]+)/g, (full: string, fileinfo: string) => {
        let filename = fileinfo.split('?')[0] ?? '';
        try {
            filename = decodeURIComponent(filename);
        } catch {
            // Keep the original filename when it is not valid percent-encoding.
        }
        const listed = pdoc.additional_file?.some((file) => file.name === filename) === true;
        if (!listed) return full;
        return withTid(`${absBase}${fileinfo}`);
    });
}

function projectAndAbsolutizeStudentPdict(
    handler: UrlHandler,
    pdict: Record<string | number, Record<string, unknown>>,
    tid: ObjectId | string,
): Record<string, Record<string, unknown>> {
    const studentPdict = require('../src/lib/student-pdict') as {
        projectStudentPdict: (docs: Record<string | number, Record<string, unknown>>) => Record<string, Record<string, unknown>>;
    };
    const projected = studentPdict.projectStudentPdict(pdict);
    for (const pdoc of Object.values(projected)) {
        if (typeof pdoc.content === 'string') pdoc.content = absolutizeProblemFileUrls(handler, pdoc.content, fileCarrier(pdoc), tid);
    }
    return projected;
}

function workspaceCodeLangRange(): Record<string, string> {
    const codeLang = setting.SETTINGS_BY_KEY.codeLang as { range?: Record<string, string> } | undefined;
    const range = codeLang?.range;
    if (!range || typeof range !== 'object') throw new Error('codeLang.range is missing from settings');
    return range;
}

function canManageHomework(
    actor: { own: (doc: { owner?: number; maintainer?: number[] }) => boolean; hasPerm: (...perm: bigint[]) => boolean; hasPriv: (...priv: number[]) => boolean },
    doc: { owner?: number; maintainer?: number[] },
): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
        || (actor.own(doc) ? actor.hasPerm(PERM.PERM_EDIT_HOMEWORK_SELF) : actor.hasPerm(PERM.PERM_EDIT_HOMEWORK));
}

function cursor() {
    const value = {
        project() {
            return value;
        },
        sort() {
            return value;
        },
        async toArray() {
            return [];
        },
    };
    return value;
}

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

const contestStub = {
    requirePublishedForStudent,
    async get() {
        return currentHomework;
    },
    async getStatus() {
        return status;
    },
    async setStatus(_domainId: string, _tid: ObjectId, _uid: number, update: { startAt?: Date | null }) {
        if (update.startAt instanceof Date) status.startAt = update.startAt;
    },
    isNotStarted,
    isDone,
    isOngoing,
    canShowSelfRecord() {
        return true;
    },
    async canShowSelfRecordForUser() {
        return true;
    },
    canShowScoreboard(tdoc: HomeworkDoc) {
        return storedSetConfigOrNull(tdoc)?.settings.scoreboard !== 'off';
    },
    async canShowScoreboardForUser(tdoc: HomeworkDoc) {
        return storedSetConfigOrNull(tdoc)?.settings.scoreboard !== 'off';
    },
    isClientRequired() { return false; },
    isClientFinished() { return false; },
    isExtended() {
        return false;
    },
};

const homeworkPath = require.resolve('../src/handler/homework.ts');
const isolatedHelpers = new Set([
    '../src/lib/set-student-state.ts', '../src/lib/set-publish-facts.ts',
    '../src/lib/set-participation-access.ts', '../src/lib/container-visibility.ts',
].map((request) => require.resolve(request)));
const roundStub = {
    participantKey(uid: number) { return `u:${uid}`; },
    async settleParticipantRounds(domainId: string, tid: ObjectId, uid: number) {
        return storedRounds.filter((round) => round.domainId === domainId && round.tid.equals(tid)
            && round.participantKey === `u:${uid}`);
    },
    async getOfficialAnswers(domainId: string, round: RoundDoc) {
        if (round.domainId !== domainId) throw new Error('fixture round domain mismatch');
        return storedAnswers;
    },
};
const originalLoad = Module._load;
const cacheBefore = new Set(Object.keys(require.cache));
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (parent?.filename !== homeworkPath && (!parent?.filename || !isolatedHelpers.has(parent.filename))) {
        return originalLoad.call(this, request, parent, isMain);
    }
    if (request === '@hydrooj/utils/lib/utils') return { sortFiles: (files: unknown[]) => files, Time };
    if (request === '@hydrooj/utils') {
        return {
            Logger: class HomeworkLogger {
                info() {
                    return undefined;
                }

                error() {
                    return undefined;
                }

                warn() {
                    return undefined;
                }
            },
        };
    }
    if (request === '../model/contest') return contestStub;
    if (request === '../model/oplog' || request === '../lib/set-basic-edit') return {};
    if (request === '../model/set-round') return roundStub;
    if (request === './course-exam-gate') return { async assertCourseExamWatchGate() { return undefined; } };
    if (request === '../model/discussion') return { getMulti: () => cursor() };
    if (request === '../model/document') return { TYPE_CONTEST: 30 };
    if (request === '../model/problem') {
        return {
            PROJECTION_CONTEST_DETAIL: ['docId', 'pid', 'title', 'content', 'config', 'html', 'data', 'additional_file'],
            PROJECTION_CONTEST_LIST: ['docId', 'pid', 'title', 'config'],
            assertProblemAclDomain() {
                return undefined;
            },
            async get(_domainId: string, pid: number, _projection?: readonly string[], rawConfig = false) {
                const raw = storedProblem(pid);
                if (!raw) return null;
                if (rawConfig) {
                    const config = typeof raw.config === 'string' ? raw.config : structuredClone(raw.config);
                    return copyProblem(raw, config);
                }
                return copyProblem(raw, await parseStoredConfig(raw.config));
            },
            async getList(
                _domainId: string,
                pids: readonly number[],
                _canViewHidden?: boolean,
                _doThrow?: boolean,
                projection?: readonly string[],
            ) {
                const wantsConfig = !projection || projection.includes('config');
                const out: Record<number, StoredProblem> = {};
                for (const pid of pids) {
                    const raw = storedProblem(pid);
                    if (!raw) continue;
                    const config = wantsConfig ? await parseStoredConfig(raw.config) : raw.config;
                    out[pid] = copyProblem(raw, config);
                }
                return out;
            },
        };
    }
    if (request === '../model/problem-access') {
        return {
            async assertProblemBankSelection() {
                return undefined;
            },
            async readContextViewableProblems(
                _domainId: string,
                _user: unknown,
                pids: number[],
                context: { kind?: string },
                adapters: { readContainer: (ids: number[]) => Promise<StoredProblem[]> },
            ) {
                if (context?.kind !== 'homework-membership') throw new TypeError(String(context?.kind));
                return adapters.readContainer(pids);
            },
        };
    }
    if (request === '../model/record') {
        return {
            coll: { find: () => cursor() },
            async getList() {
                return {};
            },
        };
    }
    if (request === '../model/storage') return {};
    if (request === '../model/system') return { get: () => 1024 };
    if (request === '../model/training') {
        return {
            getMulti: () => cursor(),
            async get() {
                return null;
            },
            async attachContestToCourseChapter() {
                return true;
            },
        };
    }
    if (request === '../model/user') {
        return {
            async getList() {
                return {};
            },
            async listGroup() {
                return [];
            },
        };
    }
    if (request === '../lib/course-access') {
        return {
            canManageCourse(user: Actor, doc: { owner?: number }) {
                return user.own(doc);
            },
            async assertCourseAccessible() {
                return undefined;
            },
        };
    }
    if (request === '../service/server') {
        return {
            Handler: class HandlerStub {},
            param: noopDecorator,
            post: noopDecorator,
            Types: new Proxy({}, { get: () => () => ({}) }),
        };
    }
    if (request === './contest') {
        return {
            ContestCodeHandler: class ContestCodeHandler {},
            ContestFileDownloadHandler: class ContestFileDownloadHandler {},
            ContestScoreboardHandler: class ContestScoreboardHandler {},
        };
    }
    if (request === '../model/paper-draft' || request === '../model/paper-draft.ts') {
        return { async getDraftsForUser() { return []; } };
    }
    // Same observable contract as handler/paper.ts: student config, file:// rewritten with ?tid=.
    if (request === './paper' || request === './paper.ts') {
        return { projectAndAbsolutizeStudentPdict, workspaceCodeLangRange };
    }
    if (request === '../lib/teach-access' || request === '../lib/teach-access.ts') {
        return {
            canManageTeachContainer(
                actor: Actor,
                type: string,
                doc: { owner?: number; maintainer?: number[] },
            ) {
                if (type !== 'homework') return false;
                return canManageHomework(actor, doc);
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

interface HomeworkModule {
    apply: (ctx: {
        Route: (name: string, path: string, HandlerClass: new () => DetailHandler) => void;
        inject: (deps: string[], callback: (ctx: { Route: () => void }) => unknown) => unknown;
    }) => Promise<void>;
}

delete require.cache[homeworkPath];
const homeworkModule = require(homeworkPath) as HomeworkModule;
const routes: Record<string, new () => DetailHandler> = {};
void homeworkModule.apply({
    Route(name, _path, HandlerClass) {
        routes[name] = HandlerClass;
    },
    async inject(_deps, callback) {
        return callback({
            Route() {
                return undefined;
            },
        });
    },
});

function bind(actor: Actor): DetailHandler {
    const HandlerClass = routes.homework_detail;
    const handler = new HandlerClass();
    handler.domain = { _id: DOMAIN };
    handler.user = actor;
    handler.response = { body: {} };
    handler.request = { ip: '127.0.0.1', method: 'get' };
    handler.paginate = async () => [[], 1, 0];
    handler.url = handlerUrl;
    handler.back = () => undefined;
    handler.checkPerm = () => undefined;
    return handler;
}

async function readBody(actor: Actor): Promise<{ body: Record<string, unknown>; template?: string }> {
    const handler = bind(actor);
    await handler.prepare(DOMAIN, homeworkId);
    await handler.get(DOMAIN, homeworkId, 1);
    return { body: handler.response.body, template: handler.response.template };
}

function workspaceOf(body: Record<string, unknown>): WorkspaceView | undefined {
    const workspace = body.workspace;
    if (!workspace || typeof workspace !== 'object') return undefined;
    return workspace as WorkspaceView;
}

function statementsOf(body: Record<string, unknown>): StatementView[] {
    const raw = body.workspaceProblems;
    if (!raw || typeof raw !== 'object') return [];
    return Object.values(raw as Record<string, StatementView>);
}

function statementAt(body: Record<string, unknown>, pid: number): StatementView | undefined {
    const raw = body.workspaceProblems;
    if (!raw || typeof raw !== 'object') return undefined;
    return (raw as Record<string, StatementView>)[String(pid)];
}

function student(): Actor {
    return makeActor(STUDENT_UID, [PERM.PERM_ATTEND_HOMEWORK]);
}

function manager(): Actor {
    return makeActor(MANAGER_UID, [PERM.PERM_EDIT_HOMEWORK]);
}

beforeEach(() => {
    currentHomework = openHomework();
    status = { attend: 1, startAt: new Date(), journal: [] };
    storedRounds = [];
    storedAnswers = [];
    fillMode = 'text';
});

after(() => {
    Module._load = originalLoad;
    for (const key of Object.keys(require.cache)) if (!cacheBefore.has(key)) delete require.cache[key];
});

describe('homework workspace route', { concurrency: false }, () => {
    it('reports unconfigured times when a teacher previews a title-only homework draft', async () => {
        currentHomework = openHomework({ pids: [], setConfig: createDraftConfig('homework') });
        Object.assign(currentHomework, { beginAt: undefined, endAt: undefined });
        let error: unknown;
        try {
            await readBody(manager());
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).name).to.equal('ValidationError');
        expect(error).to.have.nested.property('params[2]', '请先设置开放时间，再预览学生作答页面。');
        expect(currentHomework.beginAt).to.equal(undefined);
        expect(currentHomework.endAt).to.equal(undefined);
        expect(storedRounds).to.deep.equal([]);
    });

    it('uses code feedback for compiled program fills and objective feedback for text fills', async () => {
        const config: SetConfig = { ...createDraftConfig('homework'), publication: 'published' };
        config.settings.feedback.objective.when = 'after_release';
        currentHomework = openHomework({ pids: [FILL_PID], setConfig: config });
        storedRounds = [{ _id: new ObjectId(), domainId: DOMAIN, tid: homeworkId, participantKey: `u:${STUDENT_UID}`, roundNo: 1,
            state: 'open', startedAt: at(-HOUR / 2), closedAt: null, paperPids: [FILL_PID], total: 100, passed: false,
            detail: { [FILL_PID]: { pid: FILL_PID, score: 100, status: 1 } }, scoreRevision: config.revision }];
        fillMode = 'compile';
        const compiled = await readBody(student());
        expect(workspaceOf(compiled.body)?.groups?.[0]?.items?.[0]?.feedback).to.deep.equal({ score: true, verdict: true, details: true });
        fillMode = 'text';
        const text = await readBody(student());
        expect(workspaceOf(text.body)?.groups?.[0]?.items?.[0]?.feedback).to.deep.equal({ score: false, verdict: false, details: false });
    });

    it('requires the stored program-fill mode even when the workspace only loads locked metadata', async () => {
        currentHomework = openHomework({ duration: 1, pids: [FILL_PID] });
        status = { attend: 1, startAt: null, journal: [] };
        fillMode = undefined;
        let error: unknown;
        try {
            await readBody(student());
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(TypeError);
        expect((error as Error).message).to.equal('set_problem_mode_invalid');
    });

    it('offers invitation redemption for a configured homework with a personal timer', async () => {
        const config: SetConfig = { ...createDraftConfig('homework'), publication: 'published' };
        config.settings.personalLimit.hours = 1;
        currentHomework = openHomework({ duration: 1, pids: [OBJECTIVE_PID], _code: 'entry-code', setConfig: config });
        status = { attend: 0, journal: [] };
        const page = await readBody(student());
        const workspace = workspaceOf(page.body);
        expect(workspace?.action?.invitationRequired).to.equal(true);
        expect(workspace?.action?.canAttend).to.equal(true);
        expect(workspace?.action?.canStart).to.equal(false);
        expect(workspace?.urls?.attend).to.equal(`/contest/${homeworkId}`);
        expect(page.body.workspaceProblems).to.deep.equal({});
        expect(storedRounds).to.deep.equal([]);
    });

    it('reads the configured formal round instead of legacy status scores and draft routes', async () => {
        const config: SetConfig = { ...createDraftConfig('homework'), publication: 'published' };
        currentHomework = openHomework({ pids: [OBJECTIVE_PID], setConfig: config });
        const roundId = new ObjectId('64b0000000000000000000d4');
        const startedAt = at(-30 * 60 * 1000);
        storedRounds = [{
            _id: roundId, domainId: DOMAIN, tid: homeworkId, participantKey: `u:${STUDENT_UID}`, roundNo: 1,
            state: 'open', startedAt, closedAt: null, paperPids: [OBJECTIVE_PID], total: 0, passed: false,
            detail: { [OBJECTIVE_PID]: { pid: OBJECTIVE_PID, score: 0, status: 2 } }, scoreRevision: config.revision,
        }];
        storedAnswers = [{ pid: OBJECTIVE_PID, version: 3, operationId: 'fixture-operation', acceptedAt: startedAt,
            body: { 1: '错' }, rawScore: 0, status: 2, judgeResult: { 1: 'wrong' } }];
        status = { attend: 1, startAt: startedAt, journal: [{ pid: OBJECTIVE_PID, rid: 'legacy-rid', status: 1, score: 999 }] };
        const page = await readBody(student());
        const workspace = workspaceOf(page.body);
        expect(workspace?.officialRound?.id).to.equal(roundId.toHexString());
        expect(workspace?.officialRound?.roundNo).to.equal(1);
        expect(workspace?.groups?.[0]?.items?.[0]?.lastScore).to.equal(0);
        expect(workspace?.totals?.score).to.equal(0);
        expect(workspace?.urls?.saveAnswers).to.equal(`/homework/${homeworkId}/round/save`);
        expect(workspace?.urls?.draftList).to.equal(`/homework/${homeworkId}/round/answers`);
        expect(workspace?.urls?.draftUpsert).to.equal(null);
        expect(page.body).not.to.have.property('tsdoc');
        expect(page.body.tdoc).not.to.have.property('setConfig');
        expect(JSON.stringify(page.body)).not.to.include(SECRET_ANSWER);
    });

    it('does not treat legacy startAt as a configured formal round', async () => {
        currentHomework = openHomework({ pids: [OBJECTIVE_PID], setConfig: { ...createDraftConfig('homework'), publication: 'published' } });
        status = { attend: 1, startAt: at(-30 * 60 * 1000), journal: [] };
        const page = await readBody(student());
        expect(workspaceOf(page.body)?.officialRound).to.equal(null);
        expect(page.body.workspaceProblems).to.deep.equal({});
        expect(storedRounds).to.deep.equal([]);
    });

    it('renders a student homework workspace', async () => {
        currentHomework = openHomework({ pids: [OBJECTIVE_PID] });
        const codeLang = setting.SETTINGS_BY_KEY.codeLang as { range?: Record<string, string> };
        const savedRange = codeLang.range;
        codeLang.range = { 'py.py3': 'Python 3' };
        try {
            const page = await readBody(student());
            const workspace = workspaceOf(page.body);
            expect(page.template, 'template').to.equal('set_workspace.html');
            expect(workspace?.kind, 'kind').to.equal('homework');
            expect(workspace?.mode, 'mode').to.equal('browser');
            expect(workspace?.urls?.submitKind ?? '', 'submit kind').to.match(/\/submit-kind$/);
            expect(page.body.langRange, 'lang range').to.deep.equal({ 'py.py3': 'Python 3' });
        } finally {
            codeLang.range = savedRange;
        }
    });

    it('locks an unstarted personal homework and ships no statements', async () => {
        currentHomework = openHomework({
            duration: 1.5,
            pids: [OBJECTIVE_PID],
            score: { [String(OBJECTIVE_PID)]: 20 },
        });
        status = {
            attend: 1,
            startAt: null,
            journal: [{ pid: OBJECTIVE_PID, rid: 'record-1', status: 1, score: 10 }],
        };
        const page = await readBody(student());
        const workspace = workspaceOf(page.body);
        const group = workspace?.groups?.[0];
        const item = group?.items?.[0];
        expect(workspace?.locked?.reason, 'need start').to.equal('need_start');
        expect(page.body.pdict, 'pdict').to.deep.equal({});
        expect(page.body.workspaceProblems, 'statements').to.deep.equal({});
        expect([group?.kind, item?.score, item?.lastScore], 'kind and scaled scores').to.deep.equal(['single', 2, 2]);
    });

    it('keeps a locked problem that omits problem kind', async () => {
        currentHomework = openHomework({
            duration: 1.5,
            pids: [BARE_PID],
            score: { [String(BARE_PID)]: 20 },
        });
        status = { attend: 1, startAt: null, journal: [] };
        const page = await readBody(student());
        const workspace = workspaceOf(page.body);
        const group = workspace?.groups?.[0];
        const item = group?.items?.[0];
        expect(workspace?.locked?.reason, 'need start').to.equal('need_start');
        expect(
            [group?.kind, workspace?.totals?.problemCount, item?.score],
            'missing kind',
        ).to.deep.equal(['programming', 1, 20]);
    });

    it('keeps the recorded late penalty instead of rescaling the raw score', async () => {
        currentHomework = openHomework({
            pids: [OBJECTIVE_PID],
            score: { [String(OBJECTIVE_PID)]: 20 },
            penaltySince: at(-2 * HOUR),
        });
        status = {
            attend: 1,
            startAt: at(-30 * 60 * 1000),
            journal: [{ pid: OBJECTIVE_PID, rid: 'record-1', status: 1, score: 100, penaltyScore: 16 }],
        };
        const page = await readBody(student());
        const workspace = workspaceOf(page.body);
        const item = workspace?.groups?.[0]?.items?.[0];
        expect(item?.lastScore, 'late score').to.equal(16);
        expect(workspace?.totals?.score, 'late total').to.equal(16);
    });

    it('does not reveal titles while a manager previews an unstarted timed homework', async () => {
        currentHomework = openHomework({
            duration: 1.5,
            pids: [OBJECTIVE_PID],
        });
        status = { attend: 1, startAt: null, journal: [] };
        const page = await readBody(manager());
        const workspace = workspaceOf(page.body);
        const items = (workspace?.groups ?? []).flatMap((group) => group.items ?? []);
        expect(workspace?.mode, 'preview mode').to.equal('preview');
        expect(workspace?.locked, 'preview lock').to.equal(null);
        expect(page.body.workspaceProblems, 'preview statements').to.deep.equal({});
        expect(items.length, 'preview items').to.be.greaterThan(0);
        for (const item of items) expect(item.title, 'preview title').to.equal('');
    });

    it('hides statements until an untimed homework is attended', async () => {
        currentHomework = openHomework();
        status = { journal: [] };
        const locked = await readBody(student());
        const lockedWorkspace = workspaceOf(locked.body);
        const detailUrl = `/homework/${homeworkId.toHexString()}`;
        expect(lockedWorkspace?.locked?.reason, 'need attend').to.equal('need_attend');
        expect(lockedWorkspace?.urls?.attend, 'attend url').to.equal(detailUrl);
        expect(locked.body.workspaceProblems, 'statements before attend').to.deep.equal({});

        status = { attend: 1, journal: [] };
        let attendedError: unknown;
        let openBody: Record<string, unknown> | undefined;
        try {
            openBody = (await readBody(student())).body;
        } catch (error) {
            attendedError = error;
        }
        const attendedDetail = attendedError instanceof Error ? attendedError.message : 'attended get';
        expect(attendedError, attendedDetail).to.equal(undefined);
        const statements = statementsOf(openBody ?? {});
        expect(statements.length, 'statement count').to.equal(2);
        for (const item of statements) {
            expect(item.content ?? '', 'statement text').to.include('题面');
            expect(item.content ?? '', 'absolutized file').to.include(`?tid=${homeworkId.toHexString()}`);
            expect(item.content ?? '', 'raw file url').to.not.include('file://');
            expect(item.config ?? {}, 'student config').to.not.have.property('answers');
            expect(JSON.stringify(item.config ?? {}), 'answer text').to.not.include(SECRET_ANSWER);
        }
        const objective = statementAt(openBody ?? {}, OBJECTIVE_PID);
        const questions = objective?.config?.questions;
        expect(Array.isArray(questions) && questions.length > 0, 'objective questions').to.equal(true);
        expect(objective?.config ?? {}, 'objective answers').to.not.have.property('answers');
        const surface = statementAt(openBody ?? {}, FILL_PID)?.config?.template?.surface;
        expect(Array.isArray(surface) && surface.length > 0, 'program fill surface').to.equal(true);
    });

    it('allows attend only for homework without a personal limit', async () => {
        currentHomework = openHomework();
        status = { journal: [] };
        const untimed = workspaceOf((await readBody(student())).body);
        expect(untimed?.action?.canAttend, 'untimed can attend').to.equal(true);

        currentHomework = openHomework({ duration: 1.5 });
        status = { journal: [] };
        const timed = workspaceOf((await readBody(student())).body);
        expect(timed?.action?.canAttend, 'timed can attend').to.equal(false);
        expect(timed?.urls?.attend, 'timed attend url').to.equal(null);
    });

    it('previews a managed homework and links to the teach page', async () => {
        currentHomework = openHomework({ pids: [OBJECTIVE_PID] });
        const page = await readBody(manager());
        const workspace = workspaceOf(page.body);
        expect(workspace?.mode, 'preview mode').to.equal('preview');
        expect(workspace?.urls?.manage, 'manage url').to.equal(`/teach/homework/${homeworkId.toHexString()}`);
    });
});
