// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A static import fails collection while legacy-forms.ts is absent.
const formLoaders = import.meta.glob('../../src/pages/teach/legacy-forms.ts');

const FORM_SOURCE = 'src/pages/teach/legacy-forms.ts';
const repoRoot = resolve(import.meta.dirname, '../../../..');
const BEGIN_ISO = '2026-10-16T06:30:00.000Z';
const CONTEST_ID = '64b7c3a2e4b0f96d1a2c3d4e';
const PLANNED_BATCH_ID = '64b7c3a2e4b0f96d1a2c3d4f';
const FINAL_BATCH_ID = '64b7c3a2e4b0f96d1a2c3d40';
const COURSE_ID = '64b7c3a2e4b0f96d1a2c3d41';

const EXAM_FIELD_NAMES = ['examShowVerdict', 'examPassScore', 'examAttemptLimit', 'examPaperQuotas', 'examScores'] as const;

interface LegacyCatalogs {
  groups: Array<{ id: string; name: string; archived: boolean }>;
  schools: Array<{ id: string; name: string }>;
}

interface ContestVigilFields {
  vigilEnabled: boolean;
  entryMode: 'open' | 'client_required';
  approvalMode: 'strict' | 'auto';
  lockdownMode: boolean;
  networkLockdownMode: boolean;
  networkLockdownFailurePolicy: string;
  networkWhitelistHosts: string;
  networkWhitelistIps: string;
  networkWhitelistPorts: string;
  pauseOnDisconnect: boolean;
  screenshotIntervalMs: number;
  exclusive: boolean;
  clientLoginBlockBeforeMinutes: number;
  clientLoginBlockAfterMinutes: number;
  liveEnabled: boolean;
  recordEnabled: boolean;
  cameraEnabled: boolean;
  screenshotJitterMs: number;
  vigilProcessWhitelist: string;
}

interface ContestFormState {
  rule: string;
  title: string;
  content: string;
  beginDate: string;
  beginTime: string;
  windowHours: number;
  personalHours: number | null;
  pids: number[];
  scores: Record<number, number> | null;
  examPaperQuotas: Partial<Record<string, number>> | null;
  rated: boolean;
  code: string;
  autoHide: boolean;
  assign: string[];
  hidden: boolean;
  lockMinutes: number | null;
  maintainer: number[];
  allowViewCode: boolean;
  allowPrint: boolean;
  keepScoreboardHidden: boolean;
  allowVirtual: boolean | null;
  allowPostContestPractice: boolean | null;
  allowPostContestView: boolean | null;
  allowPostContestSubmit: boolean | null;
  langs: string[];
  vigil: ContestVigilFields;
  participantScopeMode: 'none' | 'schools' | 'groups';
  participantSchoolIds: string[];
  participantGroupIds: string[];
  participationMode: 'individual' | 'team';
  participationRevision: number;
  teamModeClearConfirmation: string;
  plannedTeamBatchId: string | null;
  examShowVerdict: boolean | null;
  examPassScore: number | null;
  examAttemptLimit: number | null;
}

interface HomeworkFormState {
  title: string;
  content: string;
  beginDate: string;
  beginTime: string;
  deadlineDate: string;
  deadlineTime: string;
  extensionDays: number;
  penaltyRules: Array<{ hours: number; coefficient: number }>;
  personalMinutes: number | null;
  pids: number[];
  scores: Record<number, number> | null;
  rated: boolean;
  maintainer: number[];
  assign: string[];
  langs: string[];
  participantScopeMode: 'none' | 'groups';
  participantGroupIds: string[];
  fromCourse: { courseId: string; chapterId: number } | null;
}

interface PracticeStage {
  id: number;
  title: string;
  requireIds: number[];
  pids: number[];
}

interface PracticeFormState {
  title: string;
  content: string;
  description: string;
  pin: boolean;
  stages: PracticeStage[];
  audiencePublic: boolean;
  audienceGroupIds: string[];
}

interface ContestSnapshot {
  tid: string | null;
  state: ContestFormState;
  catalogs: LegacyCatalogs;
  extras: {
    activeTeamCount: number;
    recordCount: number;
    canAutoHideProblems: boolean;
    teamModeClearToken: string;
    canManageTeamBatches: boolean;
    canUpdatePlannedTeamBatch: boolean;
    teamBatchId: string | null;
    teamBatches: Array<{ batchId: string; name: string; status: string; teamCount: number; memberCount: number }>;
  };
}

interface HomeworkSnapshot {
  tid: string | null;
  state: HomeworkFormState;
  catalogs: LegacyCatalogs;
  courseContext: { courseTitle: string; chapterTitle: string } | null;
}

interface PracticeSnapshot {
  tid: string | null;
  state: PracticeFormState;
  catalogs: LegacyCatalogs;
}

interface LegacyFormsApi {
  parseContestSnapshot: (raw: unknown, createRule?: 'exam' | 'acm' | 'oi' | 'ioi' | 'strictioi') => ContestSnapshot;
  parseHomeworkSnapshot: (raw: unknown) => HomeworkSnapshot;
  parsePracticeSnapshot: (raw: unknown) => PracticeSnapshot;
  contestFormBody: (state: ContestFormState) => URLSearchParams;
  homeworkFormBody: (state: HomeworkFormState) => URLSearchParams;
  practiceFormBody: (state: PracticeFormState) => URLSearchParams;
  legacyEditPath: (type: 'practice' | 'homework' | 'exam' | 'acm' | 'oi', id: string | null, query?: URLSearchParams) => string;
  DEFAULT_PENALTY_RULES: ReadonlyArray<{ hours: number; coefficient: number }>;
}

const VIGIL: ContestVigilFields = {
  vigilEnabled: false,
  entryMode: 'open',
  approvalMode: 'strict',
  lockdownMode: false,
  networkLockdownMode: false,
  networkLockdownFailurePolicy: 'off',
  networkWhitelistHosts: '',
  networkWhitelistIps: '',
  networkWhitelistPorts: '',
  pauseOnDisconnect: false,
  screenshotIntervalMs: 60000,
  exclusive: false,
  clientLoginBlockBeforeMinutes: 60,
  clientLoginBlockAfterMinutes: 30,
  liveEnabled: true,
  recordEnabled: false,
  cameraEnabled: true,
  screenshotJitterMs: 30000,
  vigilProcessWhitelist: '',
};

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} is not exported`);
  return value as Fn;
}

function formLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(formLoaders)) {
    if (key.endsWith(FORM_SOURCE)) return load;
  }
  return undefined;
}

async function loadLegacyForms(): Promise<LegacyFormsApi> {
  const load = formLoader();
  expect(typeof load, FORM_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${FORM_SOURCE} is not exported`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('legacy forms module must be an object');
  const rules = readField(imported, 'DEFAULT_PENALTY_RULES');
  expect(Array.isArray(rules), 'DEFAULT_PENALTY_RULES').toBe(true);
  if (!Array.isArray(rules)) throw new TypeError('DEFAULT_PENALTY_RULES is not exported');
  return {
    parseContestSnapshot: asFunction(readField(imported, 'parseContestSnapshot'), 'parseContestSnapshot'),
    parseHomeworkSnapshot: asFunction(readField(imported, 'parseHomeworkSnapshot'), 'parseHomeworkSnapshot'),
    parsePracticeSnapshot: asFunction(readField(imported, 'parsePracticeSnapshot'), 'parsePracticeSnapshot'),
    contestFormBody: asFunction(readField(imported, 'contestFormBody'), 'contestFormBody'),
    homeworkFormBody: asFunction(readField(imported, 'homeworkFormBody'), 'homeworkFormBody'),
    practiceFormBody: asFunction(readField(imported, 'practiceFormBody'), 'practiceFormBody'),
    legacyEditPath: asFunction(readField(imported, 'legacyEditPath'), 'legacyEditPath'),
    DEFAULT_PENALTY_RULES: rules as LegacyFormsApi['DEFAULT_PENALTY_RULES'],
  };
}

function sourceText(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function postUpdateParamNames(source: string, className: string): string[] {
  const classAt = source.indexOf(`class ${className}`);
  expect(classAt, className).toBeGreaterThanOrEqual(0);
  const postAt = source.indexOf('async postUpdate(', classAt);
  expect(postAt, `${className}.postUpdate`).toBeGreaterThan(classAt);
  const names = [...source.slice(classAt, postAt).matchAll(/@param\('([A-Za-z]+)'/g)].flatMap((match) => {
    const name = match[1];
    return name ? [name] : [];
  });
  expect(names.length, className).toBeGreaterThan(0);
  return [...new Set(names)];
}

function requiredParam(body: URLSearchParams, name: string): string {
  const value = body.get(name);
  expect(value, name).not.toBeNull();
  if (value === null) throw new Error(`${name} is missing`);
  return value;
}

function contestState(patch: Partial<ContestFormState> = {}): ContestFormState {
  return {
    rule: 'acm',
    title: '周赛',
    content: '说明',
    beginDate: '2026-10-16',
    beginTime: '14:00',
    windowHours: 3,
    personalHours: null,
    pids: [8, 9],
    scores: null,
    examPaperQuotas: null,
    rated: true,
    code: '',
    autoHide: false,
    assign: ['class-a', 'class-b'],
    hidden: false,
    lockMinutes: null,
    maintainer: [3, 4],
    allowViewCode: true,
    allowPrint: false,
    keepScoreboardHidden: false,
    allowVirtual: null,
    allowPostContestPractice: null,
    allowPostContestView: null,
    allowPostContestSubmit: null,
    langs: [],
    participantScopeMode: 'groups',
    participantSchoolIds: [],
    participantGroupIds: ['g1', 'g2'],
    participationMode: 'individual',
    participationRevision: 4,
    teamModeClearConfirmation: '',
    plannedTeamBatchId: null,
    examShowVerdict: null,
    examPassScore: null,
    examAttemptLimit: null,
    ...patch,
    vigil: { ...VIGIL, ...patch.vigil },
  };
}

function examBodyState(): ContestFormState {
  return contestState({
    rule: 'exam',
    rated: true,
    hidden: false,
    scores: { 8: 10, 9: 20 },
    examPaperQuotas: { single: 2 },
    examShowVerdict: true,
    examPassScore: null,
    examAttemptLimit: 1,
    allowVirtual: false,
    allowPostContestPractice: false,
    allowPostContestView: true,
    allowPostContestSubmit: false,
    plannedTeamBatchId: '',
    code: '',
    langs: [],
    vigil: {
      ...VIGIL,
      liveEnabled: false,
      cameraEnabled: false,
      networkWhitelistHosts: 'judge.example',
    },
  });
}

function homeworkState(patch: Partial<HomeworkFormState> = {}): HomeworkFormState {
  return {
    title: '一次函数作业',
    content: '请写出过程',
    beginDate: '2026-10-17',
    beginTime: '08:00',
    deadlineDate: '2026-10-24',
    deadlineTime: '23:59',
    extensionDays: 0,
    penaltyRules: [
      { hours: 1, coefficient: 0.9 },
      { hours: 3, coefficient: 0.8 },
    ],
    personalMinutes: 90,
    pids: [3, 4],
    scores: null,
    rated: true,
    maintainer: [7, 8],
    assign: ['class-a'],
    langs: ['cc.cc14o2'],
    participantScopeMode: 'groups',
    participantGroupIds: ['g1', 'g2'],
    fromCourse: null,
    ...patch,
  };
}

function localDateAndTime(iso: string): { date: string; time: string } {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function thrownMessage(run: () => unknown): string {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TypeError);
  if (!(thrown instanceof Error)) return '';
  return thrown.message;
}

function editPayload(
  participationRevision: number,
  tdocPatch: Record<string, unknown> = {},
  inviteCode: unknown = 'abc123',
): Record<string, unknown> {
  return {
    page_name: 'contest_edit',
    inviteCode,
    rules: { exam: '考试', acm: 'ACM' },
    pdict: {},
    files: [],
    duration: 3,
    pids: '8,9',
    beginAt: BEGIN_ISO,
    participationRevision,
    teamModeClearConfirmation: 'clear-token',
    scopeSchools: [{ _id: 'school-1', name: '一中' }],
    scopeGroups: [
      { _id: 'group-open', name: '一班', schoolId: 'school-1' },
      { _id: 'group-old', name: '旧班', archivedAt: '2020-01-01T00:00:00.000Z' },
    ],
    canAutoHideProblems: true,
    activeTeamCount: 2,
    recordCount: 6,
    canManageTeamBatches: true,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [
      {
        batchId: '64b7c3a2e4b0f96d1a2c3d42',
        name: '第一批',
        status: 'open',
        teamCount: 2,
        memberCount: 5,
        closedAt: null,
      },
    ],
    tdoc: {
      _id: CONTEST_ID,
      title: '期末考试',
      content: '闭卷',
      rule: 'exam',
      beginAt: BEGIN_ISO,
      endAt: '2026-10-16T09:30:00.000Z',
      duration: 1.5,
      pids: [8, 9],
      score: { 8: 10, 9: 20 },
      rated: true,
      autoHide: false,
      assign: ['class-a'],
      hidden: true,
      maintainer: [3],
      allowViewCode: false,
      allowPrint: false,
      keepScoreboardHidden: false,
      allowVirtual: false,
      allowPostContestPractice: true,
      allowPostContestView: false,
      allowPostContestSubmit: true,
      langs: ['py.py3'],
      vigilEnabled: true,
      entryMode: 'client_required',
      approvalMode: 'auto',
      lockdownMode: true,
      networkLockdownMode: true,
      networkLockdownFailurePolicy: 'report_only',
      networkWhitelistHosts: ['judge.example', 'cdn.example'],
      networkWhitelistIps: ['10.0.0.8'],
      networkWhitelistPorts: ['443'],
      pauseOnDisconnect: true,
      screenshotIntervalMs: 15000,
      exclusive: true,
      clientLoginBlockBeforeMinutes: 20,
      clientLoginBlockAfterMinutes: 10,
      liveEnabled: false,
      recordEnabled: true,
      cameraEnabled: false,
      screenshotJitterMs: 5000,
      vigilProcessWhitelist: ['Code.exe', 'python.exe'],
      participantScopeMode: 'groups',
      participantSchoolIds: [],
      participantGroupIds: ['group-open'],
      participationMode: 'individual',
      examShowVerdict: false,
      examPassScore: 60,
      examAttemptLimit: 3,
      examPaperQuotas: { single: 2 },
      ...tdocPatch,
    },
  };
}

function createPayload(duration: number, canAutoHideProblems: boolean): Record<string, unknown> {
  return {
    page_name: 'contest_create',
    rules: { exam: '考试', acm: 'ACM', oi: 'OI' },
    pdict: {},
    files: [],
    duration,
    pids: '',
    beginAt: BEGIN_ISO,
    participationRevision: 0,
    teamModeClearConfirmation: '',
    scopeSchools: [],
    scopeGroups: [],
    canAutoHideProblems,
    activeTeamCount: 0,
    recordCount: 0,
    canManageTeamBatches: false,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [],
  };
}

describe('contest form body', () => {
  it('posts every contest update field for an exam snapshot', async () => {
    const api = await loadLegacyForms();
    const state = examBodyState();
    const body = api.contestFormBody(state);
    const names = postUpdateParamNames(sourceText('packages/hydrooj/src/handler/contest.ts'), 'ContestEditHandler').filter(
      (name) => name !== 'tid',
    );
    expect(names).toContain('plannedTeamBatchId');
    expect(names).toContain('examScores');
    for (const name of names) {
      expect(body.has(name), name).toBe(true);
    }
    expect(body.get('operation')).toBe('update');
    expect(body.get('rule')).toBe('exam');
    expect(body.get('beginAtDate')).toBe(state.beginDate);
    expect(body.get('beginAtTime')).toBe(state.beginTime);
    expect(body.get('duration')).toBe(String(state.windowHours));
    expect(body.get('lock')).toBe('');
    expect(body.get('contestDuration')).toBe('');
    expect(body.get('plannedTeamBatchId')).toBe('');
    expect(body.get('teamModeClearConfirmation')).toBe('');
    expect(body.get('code')).toBe('');
    expect(body.get('langs')).toBe('');
    expect(body.get('pids')).toBe('8,9');
    expect(body.getAll('pids')).toEqual(['8,9']);
    expect(body.get('maintainer')).toBe('3,4');
    expect(body.get('assign')).toBe('class-a,class-b');
    expect(body.get('participantGroupIds')).toBe('g1,g2');
    expect(body.get('participantSchoolIds')).toBe('');
    expect(body.getAll('rated')).toEqual(['true']);
    expect(body.getAll('hidden')).toEqual(['false']);
    expect(body.get('networkWhitelistHosts')).toBe('judge.example');
    expect(JSON.parse(requiredParam(body, 'examScores'))).toEqual({ 8: 10, 9: 20 });
  });

  it('omits exam-only fields from an acm snapshot', async () => {
    const api = await loadLegacyForms();
    const body = api.contestFormBody(contestState());
    for (const name of EXAM_FIELD_NAMES) {
      expect(body.has(name), name).toBe(false);
    }
  });

  it('omits exam scores for acm even when scores are set', async () => {
    const api = await loadLegacyForms();
    const body = api.contestFormBody(contestState({ scores: { 8: 10, 9: 20 } }));
    expect(body.has('examScores')).toBe(false);
  });

  it('sends live and camera flags even when they are false', async () => {
    const api = await loadLegacyForms();
    const body = api.contestFormBody(examBodyState());
    expect(body.getAll('liveEnabled')).toEqual(['false']);
    expect(body.getAll('cameraEnabled')).toEqual(['false']);
  });

  it('omits a null allowVirtual and sends an explicit false', async () => {
    const api = await loadLegacyForms();
    const omitted = api.contestFormBody(contestState({ allowVirtual: null }));
    const sent = api.contestFormBody(contestState({ allowVirtual: false }));
    expect(omitted.has('allowVirtual')).toBe(false);
    expect(sent.get('allowVirtual')).toBe('false');
    const omittedPost = api.contestFormBody(contestState({ allowPostContestPractice: null }));
    const sentPost = api.contestFormBody(contestState({ allowPostContestPractice: false }));
    expect(omittedPost.has('allowPostContestPractice')).toBe(false);
    expect(sentPost.get('allowPostContestPractice')).toBe('false');
  });

  it('omits null post-contest view and submit switches', async () => {
    const api = await loadLegacyForms();
    const omitted = api.contestFormBody(contestState({
      allowPostContestView: null,
      allowPostContestSubmit: null,
    }));
    expect(omitted.has('allowPostContestView')).toBe(false);
    expect(omitted.has('allowPostContestSubmit')).toBe(false);
    const sent = api.contestFormBody(contestState({
      allowPostContestView: false,
      allowPostContestSubmit: false,
    }));
    expect(sent.get('allowPostContestView')).toBe('false');
    expect(sent.get('allowPostContestSubmit')).toBe('false');
  });

  it('encodes an exam attempt limit of one as empty and quotas as json', async () => {
    const api = await loadLegacyForms();
    const body = api.contestFormBody(examBodyState());
    expect(body.get('examAttemptLimit')).toBe('');
    expect(body.get('examPassScore')).toBe('');
    expect(body.get('examPaperQuotas')).toBe('{"single":2}');
    expect(body.get('examShowVerdict')).toBe('true');
  });

  it('clears a missing exam attempt limit and sends a higher limit', async () => {
    const api = await loadLegacyForms();
    const missing = api.contestFormBody({ ...examBodyState(), examAttemptLimit: null });
    const twice = api.contestFormBody({ ...examBodyState(), examAttemptLimit: 2 });
    expect(missing.get('examAttemptLimit')).toBe('');
    expect(twice.get('examAttemptLimit')).toBe('2');
  });

  it('sends an empty exam paper quota string when quotas are null', async () => {
    const api = await loadLegacyForms();
    const body = api.contestFormBody({ ...examBodyState(), examPaperQuotas: null });
    expect(body.has('examPaperQuotas')).toBe(true);
    expect(body.get('examPaperQuotas')).toBe('');
  });

  it('writes personal hours into contest duration without converting them again', async () => {
    const api = await loadLegacyForms();
    const body = api.contestFormBody(contestState({ personalHours: 2 }));
    expect(body.get('contestDuration')).toBe('2');
  });

  it('clears a planned batch for an individual contest and keeps one for a team', async () => {
    const api = await loadLegacyForms();
    const individual = api.contestFormBody(contestState({
      participationMode: 'individual',
      plannedTeamBatchId: PLANNED_BATCH_ID,
    }));
    expect(individual.get('plannedTeamBatchId')).toBe('');
    const individualUnset = api.contestFormBody(contestState({
      participationMode: 'individual',
      plannedTeamBatchId: null,
    }));
    expect(individualUnset.get('plannedTeamBatchId')).toBe('');
    const team = api.contestFormBody(contestState({
      participationMode: 'team',
      plannedTeamBatchId: PLANNED_BATCH_ID,
    }));
    expect(team.get('plannedTeamBatchId')).toBe(PLANNED_BATCH_ID);
    const teamUnset = api.contestFormBody(contestState({
      participationMode: 'team',
      plannedTeamBatchId: null,
    }));
    expect(teamUnset.has('plannedTeamBatchId')).toBe(false);
  });
});

describe('homework form body', () => {
  it('turns off penalty rules when extension days are zero and converts personal minutes', async () => {
    const api = await loadLegacyForms();
    const state = homeworkState();
    const body = api.homeworkFormBody(state);
    expect(body.get('penaltyRules')).toBe('{}');
    expect(body.get('contestDuration')).toBe('1.5');
    expect(body.get('operation')).toBe('update');
    expect(body.has('problemScores')).toBe(false);
    expect(body.has('fromCourse')).toBe(false);
    expect(body.has('chapter')).toBe(false);
  });

  it('writes penalty rules as yaml lines when late submission is allowed', async () => {
    const api = await loadLegacyForms();
    const body = api.homeworkFormBody(
      homeworkState({
        extensionDays: 2,
        personalMinutes: null,
        penaltyRules: [
          { hours: 1, coefficient: 0.9 },
          { hours: 12, coefficient: 0.75 },
        ],
      }),
    );
    expect(body.get('penaltyRules')).toBe('1: 0.9\n12: 0.75');
    expect(body.get('contestDuration')).toBe('');
  });

  it('posts problem scores json only when scores are present', async () => {
    const api = await loadLegacyForms();
    const body = api.homeworkFormBody(homeworkState({ scores: { 3: 5, 4: 8 }, personalMinutes: 90 }));
    expect(JSON.parse(requiredParam(body, 'problemScores'))).toEqual({ 3: 5, 4: 8 });
  });

  it('posts course chapter fields only for a course quiz', async () => {
    const api = await loadLegacyForms();
    const body = api.homeworkFormBody(homeworkState({ fromCourse: { courseId: COURSE_ID, chapterId: 2 } }));
    expect(body.get('fromCourse')).toBe(COURSE_ID);
    expect(body.get('chapter')).toBe('2');
  });

  it('posts every homework update field except tid, course links, and null scores', async () => {
    const api = await loadLegacyForms();
    const state = homeworkState();
    const body = api.homeworkFormBody(state);
    const names = postUpdateParamNames(sourceText('packages/hydrooj/src/handler/homework.ts'), 'HomeworkEditHandler').filter(
      (name) => name !== 'tid' && name !== 'fromCourse' && name !== 'chapter' && (name !== 'problemScores' || state.scores !== null),
    );
    expect(names).toContain('penaltyRules');
    expect(names).toContain('participantGroupIds');
    for (const name of names) {
      expect(body.has(name), name).toBe(true);
    }
    expect(body.get('beginAtDate')).toBe(state.beginDate);
    expect(body.get('beginAtTime')).toBe(state.beginTime);
    expect(body.get('penaltySinceDate')).toBe(state.deadlineDate);
    expect(body.get('penaltySinceTime')).toBe(state.deadlineTime);
    expect(body.get('extensionDays')).toBe('0');
    expect(body.get('title')).toBe(state.title);
    expect(body.get('content')).toBe(state.content);
    expect(body.get('pids')).toBe('3,4');
    expect(body.get('maintainer')).toBe('7,8');
    expect(body.get('assign')).toBe('class-a');
    expect(body.get('langs')).toBe('cc.cc14o2');
    expect(body.get('participantScopeMode')).toBe('groups');
    expect(body.get('participantGroupIds')).toBe('g1,g2');
    expect(body.getAll('rated')).toEqual(['true']);
  });
});

describe('practice form body', () => {
  it('serializes stage ids and prerequisite ids into dag', async () => {
    const api = await loadLegacyForms();
    const body = api.practiceFormBody({
      title: '入门练习',
      content: '正文',
      description: '简介',
      pin: true,
      audiencePublic: false,
      audienceGroupIds: ['g1', 'g2'],
      stages: [
        { id: 1, title: '入门', requireIds: [], pids: [11, 12] },
        { id: 4, title: '进阶', requireIds: [1], pids: [13] },
      ],
    });
    const parsed: unknown = JSON.parse(requiredParam(body, 'dag'));
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;
    expect(parsed[0]).toEqual({ _id: 1, title: '入门', requireNids: [], pids: [11, 12] });
    expect(parsed[1]).toEqual({ _id: 4, title: '进阶', requireNids: [1], pids: [13] });
    expect(body.get('pin')).toBe('1');
    expect(body.get('audiencePublic')).toBe('0');
    expect(body.get('audienceGroupIds')).toBe('g1,g2');
    expect(body.get('title')).toBe('入门练习');
    expect(body.get('description')).toBe('简介');
    expect(body.has('operation')).toBe(false);
  });

  it('starts a new practice on one stage with no problems', async () => {
    const api = await loadLegacyForms();
    const parsed = api.parsePracticeSnapshot({
      page_name: 'problem_set_create',
      groups: [],
    });
    expect(parsed.tid).toBeNull();
    expect(parsed.state.stages).toHaveLength(1);
    const stage = parsed.state.stages[0];
    if (!stage) throw new Error('create snapshot has no stage');
    expect(stage.id).toBe(1);
    expect(stage.requireIds).toEqual([]);
    expect(stage.pids).toEqual([]);
  });
});

describe('contest snapshot parser', () => {
  it('rejects an edit payload that omits participationRevision', async () => {
    const api = await loadLegacyForms();
    const raw = editPayload(4);
    const parsed = api.parseContestSnapshot(raw, 'acm');
    expect(parsed.tid).toBe(CONTEST_ID);
    expect(parsed.state.rule).toBe('exam');
    expect(parsed.state.participationRevision).toBe(4);
    expect(parsed.state.teamModeClearConfirmation).toBe('');
    expect(parsed.extras.teamModeClearToken).toBe('clear-token');
    expect(parsed.state.windowHours).toBe(3);
    expect(parsed.state.personalHours).toBe(1.5);
    const local = localDateAndTime(BEGIN_ISO);
    expect(parsed.state.beginDate).toBe(local.date);
    expect(parsed.state.beginTime).toBe(local.time);
    expect(parsed.state.vigil.liveEnabled).toBe(false);
    expect(parsed.state.vigil.cameraEnabled).toBe(false);
    expect(parsed.state.vigil.entryMode).toBe('client_required');
    expect(parsed.state.vigil.screenshotIntervalMs).toBe(15000);
    expect(parsed.state.vigil.networkWhitelistHosts.split(/[\s,;]+/).filter(Boolean)).toEqual(['judge.example', 'cdn.example']);
    expect(parsed.state.vigil.vigilProcessWhitelist.split(/[\s,;]+/).filter(Boolean)).toEqual(['Code.exe', 'python.exe']);
    expect(parsed.state.pids).toEqual([8, 9]);
    expect(parsed.state.scores).toEqual({ 8: 10, 9: 20 });
    expect(parsed.state.plannedTeamBatchId).toBeNull();
    expect(parsed.extras.teamBatchId).toBeNull();
    expect(parsed.extras.activeTeamCount).toBe(2);
    expect(parsed.extras.recordCount).toBe(6);
    expect(parsed.extras.canAutoHideProblems).toBe(true);
    expect(parsed.extras.canManageTeamBatches).toBe(true);
    expect(parsed.extras.canUpdatePlannedTeamBatch).toBe(false);
    expect(parsed.extras.teamBatches[0]).toEqual({
      batchId: '64b7c3a2e4b0f96d1a2c3d42',
      name: '第一批',
      status: 'open',
      teamCount: 2,
      memberCount: 5,
    });
    expect(parsed.catalogs.schools).toEqual([{ id: 'school-1', name: '一中' }]);
    expect(parsed.catalogs.groups).toEqual([
      { id: 'group-open', name: '一班', archived: false },
      { id: 'group-old', name: '旧班', archived: true },
    ]);
    const { participationRevision: _dropped, ...broken } = raw;
    expect(() => api.parseContestSnapshot(broken)).toThrow(TypeError);
  });

  it('accepts participation revision zero on an edit payload', async () => {
    const api = await loadLegacyForms();
    const parsed = api.parseContestSnapshot(editPayload(0));
    expect(parsed.state.participationRevision).toBe(0);
  });

  it('rejects a payload that is not an object', async () => {
    const api = await loadLegacyForms();
    expect(() => api.parseContestSnapshot(null)).toThrow(TypeError);
  });

  it('reads a string invite code when the document has no code fields', async () => {
    const api = await loadLegacyForms();
    const parsed = api.parseContestSnapshot(editPayload(4));
    expect(parsed.tid).not.toBeNull();
    expect(parsed.state.code).toBe('abc123');
    expect(api.contestFormBody(parsed.state).get('code')).toBe('abc123');
  });

  it('reads the top-level invite code and ignores document code fields', async () => {
    const api = await loadLegacyForms();
    const parsed = api.parseContestSnapshot(editPayload(4, { _code: 'from-private', code: 'from-public' }));
    expect(parsed.tid).toBe(CONTEST_ID);
    expect(parsed.state.code).toBe('abc123');
    expect(api.contestFormBody(parsed.state).get('code')).toBe('abc123');
  });

  it('rejects an edit snapshot without a string invite code', async () => {
    const api = await loadLegacyForms();
    const missing = editPayload(4);
    delete missing.inviteCode;
    expect(thrownMessage(() => api.parseContestSnapshot(missing))).toBe('teach_payload_invalid:inviteCode');
    expect(thrownMessage(() => api.parseContestSnapshot(editPayload(4, {}, 12)))).toBe('teach_payload_invalid:inviteCode');
    const blank = api.parseContestSnapshot(editPayload(4, {}, ''));
    expect(blank.state.code).toBe('');
    expect(api.contestFormBody(blank.state).get('code')).toBe('');
  });

  it('uses an empty invite code when a new contest omits it', async () => {
    const api = await loadLegacyForms();
    const parsed = api.parseContestSnapshot(createPayload(2, true), 'acm');
    expect(parsed.tid).toBeNull();
    expect(parsed.state.code).toBe('');
    const named = createPayload(2, true);
    named.inviteCode = 'fresh-code';
    expect(api.parseContestSnapshot(named, 'acm').state.code).toBe('fresh-code');
  });

  it('does not resubmit a finalized roster as a planned batch', async () => {
    const api = await loadLegacyForms();
    const finalized = api.parseContestSnapshot(
      editPayload(4, { participationMode: 'team', teamBatchId: FINAL_BATCH_ID }),
    );
    expect(finalized.state.plannedTeamBatchId).toBeNull();
    expect(finalized.extras.teamBatchId).toBe(FINAL_BATCH_ID);
    const finalizedBody = api.contestFormBody(finalized.state);
    expect(finalizedBody.has('plannedTeamBatchId')).toBe(false);

    const both = api.parseContestSnapshot(
      editPayload(4, {
        participationMode: 'team',
        teamBatchId: FINAL_BATCH_ID,
        plannedTeamBatchId: PLANNED_BATCH_ID,
      }),
    );
    expect(both.state.plannedTeamBatchId).toBe(PLANNED_BATCH_ID);
    expect(both.extras.teamBatchId).toBe(FINAL_BATCH_ID);
    expect(api.contestFormBody(both.state).get('plannedTeamBatchId')).toBe(PLANNED_BATCH_ID);
  });

  it('uses exam create defaults and the returned window', async () => {
    const api = await loadLegacyForms();
    const parsed = api.parseContestSnapshot(createPayload(5, true), 'exam');
    const local = localDateAndTime(BEGIN_ISO);
    expect(parsed.tid).toBeNull();
    expect(parsed.state.rule).toBe('exam');
    expect(parsed.state.windowHours).toBe(5);
    expect(parsed.state.personalHours).toBeNull();
    expect(parsed.state.beginDate).toBe(local.date);
    expect(parsed.state.beginTime).toBe(local.time);
    expect(parsed.state.rated).toBe(false);
    expect(parsed.state.autoHide).toBe(false);
    expect(parsed.state.allowViewCode).toBe(false);
    expect(parsed.state.allowVirtual).toBe(false);
    expect(parsed.state.keepScoreboardHidden).toBe(false);
    expect(parsed.state.allowPrint).toBe(false);
    expect(parsed.state.vigil.vigilEnabled).toBe(false);
    expect(parsed.state.vigil.entryMode).toBe('open');
    expect(parsed.state.participationMode).toBe('individual');
    expect(parsed.catalogs.groups).toEqual([]);
    expect(parsed.catalogs.schools).toEqual([]);
  });

  it('uses the old acm create defaults, including rated', async () => {
    const api = await loadLegacyForms();
    const parsed = api.parseContestSnapshot(createPayload(2, true), 'acm');
    expect(parsed.tid).toBeNull();
    expect(parsed.state.rule).toBe('acm');
    expect(parsed.state.windowHours).toBe(2);
    expect(parsed.state.rated).toBe(true);
    expect(parsed.state.autoHide).toBe(true);
    expect(parsed.state.allowViewCode).toBe(true);
    expect(parsed.state.allowVirtual).toBe(true);
    expect(parsed.state.allowPrint).toBe(false);
    expect(parsed.state.keepScoreboardHidden).toBe(false);
    expect(parsed.state.vigil.vigilEnabled).toBe(false);
    expect(parsed.state.vigil.entryMode).toBe('open');
    expect(parsed.state.participationMode).toBe('individual');
    expect(parsed.state.personalHours).toBeNull();
  });
});

describe('legacy edit paths', () => {
  it('points contest, homework, and practice at the old edit endpoints', async () => {
    const api = await loadLegacyForms();
    const rule = new URLSearchParams({ rule: 'oi' });
    expect(api.legacyEditPath('exam', null)).toBe('/contest/create');
    expect(api.legacyEditPath('acm', CONTEST_ID)).toBe(`/contest/${CONTEST_ID}/edit`);
    expect(api.legacyEditPath('oi', null, rule)).toBe('/contest/create?rule=oi');
    expect(api.legacyEditPath('homework', null)).toBe('/homework/create');
    expect(api.legacyEditPath('homework', CONTEST_ID)).toBe(`/homework/${CONTEST_ID}/edit`);
    expect(api.legacyEditPath('practice', null)).toBe('/problem-sets/create');
    expect(api.legacyEditPath('practice', CONTEST_ID)).toBe(`/problem-sets/${CONTEST_ID}/edit`);
  });
});

describe('homework penalty defaults', () => {
  it('copies the homework editor default penalty rows', async () => {
    const api = await loadLegacyForms();
    expect(api.DEFAULT_PENALTY_RULES).toEqual([
      { hours: 1, coefficient: 0.9 },
      { hours: 3, coefficient: 0.8 },
      { hours: 12, coefficient: 0.75 },
      { hours: 9999, coefficient: 0.5 },
    ]);
  });
});
