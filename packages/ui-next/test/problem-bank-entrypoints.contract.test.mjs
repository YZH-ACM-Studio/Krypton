import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(path) {
    return readFileSync(resolve(ROOT, path), 'utf8');
}

const uiServer = read('packages/ui-next/index.ts');
const bootstrap = read('packages/ui-next/src/lib/bootstrap.tsx');
const sidebar = read('packages/ui-next/src/components/layout/sidebar.tsx');
const problemHandler = read('packages/hydrooj/src/handler/problem.ts');
const problemResolver = read('packages/ui-next/src/pages/resolver.tsx');
const problemCreateHub = read('packages/ui-next/src/pages/problem-create-hub.tsx');
const problemConfigEditor = read('packages/ui-next/src/pages/problem-config-editor.tsx');
const manualGrading = read('packages/hydrooj/src/handler/manual-grading.ts');
const contest = read('packages/hydrooj/src/handler/contest.ts');
const homework = read('packages/hydrooj/src/handler/homework.ts');
const training = read('packages/hydrooj/src/handler/training.ts');
const course = read('packages/hydrooj/src/handler/course.ts');
const tasks = read('packages/krypton-tasks/src/handler.ts');
const problemPicker = read('packages/ui-next/src/lib/multi-select-presets.ts');

function methodBody(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
    assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
    return source.slice(start, end);
}

function assertBefore(source, first, second, label) {
    const firstIndex = source.indexOf(first);
    const secondIndex = source.indexOf(second);
    assert.notEqual(firstIndex, -1, `${label}: missing ${first}`);
    assert.notEqual(secondIndex, -1, `${label}: missing ${second}`);
    assert.ok(firstIndex < secondIndex, `${label}: ${first} must run before ${second}`);
}

test('bootstrap exposes one fail-closed observable problem-bank capability', () => {
    assert.match(bootstrap, /canBrowseProblemBank:\s*boolean/);
    assert.doesNotMatch(bootstrap, /canViewProblemBank|canCreateProblem/);

    assert.match(uiServer, /ProblemModel\.canBrowseProblemBank/);
    assert.match(uiServer, /canBrowseProblemBank:\s*problemBankCapability/);
    assert.match(uiServer, /problem bank capability resolution failed/);
    assert.match(uiServer, /catch[\s\S]*?return false/);
    assert.doesNotMatch(uiServer, /canViewProblemBank|canCreateProblem/);
});

test('sidebar consumes only canBrowseProblemBank for all enumeration entries', () => {
    assert.doesNotMatch(sidebar, /canViewProblemBank|canCreateProblem/);
    assert.match(sidebar, /bs\.user\.canBrowseProblemBank/);
    assert.equal((sidebar.match(/label: '题库'/g) || []).length, 1);
    assert.equal((sidebar.match(/label: '我的题目'/g) || []).length, 0);
    assert.equal((sidebar.match(/label: '出卷中心'/g) || []).length, 0);
    const bankGate = methodBody(sidebar, '...(bs.user.canBrowseProblemBank', "{ label: '导图'");
    assert.ok(bankGate.includes("label: '题库'"), '题库 must be inside the bank capability gate');
    assert.match(bankGate, /problem_mine\.html/);
    assert.match(bankGate, /problem_create_hub\.html/);
    assert.match(sidebar, /label: '比赛'/);
    assert.match(sidebar, /label: '荣誉榜'[\s\S]*?href: '\/rankboard'/);
});

test('unified problem bank pushes filters into the canonical author scope', () => {
    const list = methodBody(problemHandler, 'export class ProblemMainHandler', 'export class ProblemRandomHandler');
    assertBefore(list, 'refreshProblemAcl', 'buildProblemBankScope', 'problem bank ACL refresh');
    assert.match(list, /parseProblemKindSlug\(kindSlug\)/);
    assert.match(list, /problemKind:\s*\{\s*\$exists:\s*false\s*\}/);
    assert.match(list, /filterParts\.push\(\{ tag: normalizedTag \}\)/);
    assert.match(list, /if \(owner && !isBankAdmin\) throw new PermissionError/);
    assert.match(list, /archivedAt:\s*\{\s*\$exists:/);
    assert.match(list, /hidden:\s*\{\s*\$ne:\s*true\s*\}/);
    assertBefore(list, 'buildProblemTextFilter(text)', 'this.paginate(', 'problem bank scoped search');
    assert.match(list, /problem\.canMaintainProblem\(this\.user, pdoc\)/);
    assert.match(list, /async postClone/);
    assert.match(list, /async postArchive/);
});

test('creation hub and all eight routes consume the shared kind mapping', () => {
    assert.match(problemHandler, /problem_create_hub\.html/);
    assert.match(problemHandler, /problemKindToSlug\('programming'\)/);
    assert.equal((problemHandler.match(/problemKindToSlug\(/g) || []).length >= 9, true);
    assert.match(problemResolver, /'problem_create_hub\.html': ProblemCreateHubPage/);
    assert.match(problemCreateHub, /PROBLEM_KINDS/);
    assert.match(problemCreateHub, /PROBLEM_KIND_TO_SLUG\[kind\]/);
    for (const kind of ['programming', 'single', 'multi', 'true_false', 'blank', 'subjective', 'program_fill', 'function']) {
        assert.match(problemCreateHub, new RegExp(`(?:^|\\s)${kind}: \\{`));
    }
});

test('legacy composite authoring runtime files are deleted without an alias', () => {
    const legacy = 'paper' + '-center';
    assert.equal(existsSync(resolve(ROOT, `packages/hydrooj/src/handler/${legacy}.ts`)), false);
    assert.equal(existsSync(resolve(ROOT, `packages/ui-next/src/pages/${legacy}.tsx`)), false);
    assert.equal(existsSync(resolve(ROOT, `packages/ui-next/src/pages/${legacy}-edit.tsx`)), false);
    assert.equal(existsSync(resolve(ROOT, 'packages/ui-next/src/pages/problem-type-editor.tsx')), false);
    assert.equal(problemHandler.includes(`/${legacy}`), false);
    assert.equal(sidebar.includes(`/${legacy}`), false);
    assert.equal(problemResolver.includes('paper_center'), false);
    assert.doesNotMatch(problemConfigEditor, /\{ value: 'objective', label:/);
    assert.doesNotMatch(problemConfigEditor, /\{ value: 'fill_function', label:/);
    const model = read('packages/hydrooj/src/model/problem.ts');
    assert.equal((model.match(/normalizeProblemTestdataUpload\(name, f\)/g) || []).length, 2);
});

test('manual grading derives the authoritative domain before every domain-sensitive operation', () => {
    const grading = methodBody(manualGrading, 'export class ManualGradingHandler', 'export async function apply');
    assertBefore(grading, 'const domainId = String(this.domain?._id)', 'contest.get(', 'manual grading prepare');
    for (const call of [
        'contest.get(domainId',
        'problem.get(domainId',
        'record.getMulti(domainId',
        'user.getListForRender(domainId',
        'gradeLatestManualRecord({',
    ]) assert.ok(grading.includes(call), `manual grading must use authoritative domain at ${call}`);
    assert.match(grading, /this\.tdoc\.owner !== this\.user\._id/);
    assert.match(grading, /this\.user\.hasPriv\(PRIV\.PRIV_EDIT_SYSTEM\)/);
    assert.match(grading, /domainId:\s*String\(this\.domain\?\._id\)/);
    assert.doesNotMatch(grading, /(?:contest|problem|record|user)\.[A-Za-z]+\(_domainId/);
});

test('tasks problem search is capability-gated and pushes the canonical scope into Mongo', () => {
    const search = methodBody(tasks, 'class AdminTasksProblemSearchHandler', '// ─── Admin: scores');
    assert.match(search, /ProblemModel\.canBrowseProblemBank\(this\.user/);
    assert.match(search, /ForbiddenError/);
    assert.match(search, /ProblemModel\.buildProblemBankScope\(this\.user/);
    assertBefore(search, 'ProblemModel.assertProblemAclDomain', 'ProblemModel.getMulti', 'tasks search');
    assert.match(search, /ProblemModel\.getMulti\(authoritativeDomainId/);
    assert.match(search, /\$and/);
    assert.doesNotMatch(search, /hidden:\s*\{\s*\$ne:\s*true/);
});

test('task graph writes validate new problem refs before every audit or task write and grandfather old refs', () => {
    const edit = methodBody(tasks, 'class AdminTasksEditHandler', 'class AdminTasksAssignHandler');
    assert.match(edit, /collectTaskParamRefs\(existing\.graph\)\.problemIds/);
    assertBefore(edit, 'ProblemModel.assertProblemAclDomain', 'taskModel.getTask', 'task edit domain');
    assert.match(edit, /taskModel\.getTask\(authoritativeDomainId/);
    assert.match(edit, /taskModel\.createTask\(authoritativeDomainId/);
    assert.match(edit, /taskModel\.updateTask\(authoritativeDomainId/);
    assert.match(edit, /ProblemModel\.assertProblemBankSelection\([\s\S]*?existingProblemIds/);
    assertBefore(edit, 'ProblemModel.assertProblemBankSelection', 'taskModel.writeAudit', 'task edit');
    assertBefore(edit, 'ProblemModel.assertProblemBankSelection', 'taskModel.updateTask', 'task edit');
    assertBefore(edit, 'ProblemModel.assertProblemBankSelection', 'taskModel.createTask', 'task create');
});

test('task clone validates every copied problem ref as a new container reference', () => {
    const list = methodBody(tasks, 'class AdminTasksListHandler', 'export class AdminTasksEditHandler');
    assert.match(list, /collectTaskParamRefs\(src\.graph\)\.problemIds/);
    assertBefore(list, 'ProblemModel.assertProblemAclDomain', 'taskModel.getTask', 'task clone domain');
    assert.match(list, /ProblemModel\.assertProblemBankSelection\(authoritativeDomainId, problemIds, this\.user/);
    assert.match(list, /taskModel\.cloneTask\(authoritativeDomainId/);
    assertBefore(list, 'ProblemModel.assertProblemBankSelection', 'taskModel.cloneTask', 'task clone');
});

test('contest writes validate selection before create/edit and retain existing references', () => {
    const edit = methodBody(contest, 'export class ContestEditHandler', 'export class ContestManagementBaseHandler');
    assert.match(edit, /assertProblemBankSelection\(authoritativeDomainId, pids, this\.user, this\.tdoc\?\.pids\)/);
    assertBefore(edit, 'assertProblemBankSelection', 'contest.edit(authoritativeDomainId, tid', 'contest edit');
    assertBefore(edit, 'assertProblemBankSelection', 'contest.add(authoritativeDomainId', 'contest create');
});

test('homework writes validate selection before create/edit and retain existing references', () => {
    const edit = methodBody(homework, 'class HomeworkEditHandler', 'export class HomeworkFilesHandler');
    assertBefore(edit, 'problem.assertProblemAclDomain', 'contest.get(', 'homework edit read');
    assert.match(edit, /assertProblemBankSelection\(authoritativeDomainId, pids, this\.user, tdoc\?\.pids\)/);
    assertBefore(edit, 'assertProblemBankSelection', 'contest.add(authoritativeDomainId', 'homework create');
    assertBefore(edit, 'assertProblemBankSelection', 'contest.edit(authoritativeDomainId, tid', 'homework edit');
});

test('training DAG writes validate selection before create/edit and grandfather the old DAG union', () => {
    const edit = methodBody(training, 'class TrainingEditHandler', 'export class TrainingFilesHandler');
    assert.match(edit, /training\.getPids\(this\.tdoc\?\.dag\s*\|\|\s*\[\]\)/);
    assertBefore(edit, 'problem.assertProblemAclDomain', '_parseDagJson(', 'training DAG read');
    assert.match(edit, /assertProblemBankSelection\(authoritativeDomainId, pids, this\.user, existingPids\)/);
    assertBefore(edit, 'assertProblemBankSelection', 'training.add(authoritativeDomainId', 'training create');
    assertBefore(edit, 'assertProblemBankSelection', 'training.edit(authoritativeDomainId, tid', 'training edit');
});

test('course DAG writes validate selection before create/edit and grandfather the old DAG union', () => {
    const edit = methodBody(course, 'class CourseEditHandler', 'export async function apply');
    assert.match(edit, /training\.getPids\(this\.tdoc\?\.dag\s*\|\|\s*\[\]\)/);
    assertBefore(edit, 'problem.assertProblemAclDomain', 'parseChaptersJson(', 'course DAG read');
    assert.match(edit, /assertProblemBankSelection\(authoritativeDomainId, pids, this\.user, existingPids\)/);
    assertBefore(edit, 'assertProblemBankSelection', 'training.add(authoritativeDomainId', 'course create');
    assertBefore(edit, 'assertProblemBankSelection', 'training.edit(authoritativeDomainId, tid', 'course edit');
});

test('contest detail base ignores forged method domains before contest and status reads', () => {
    const detailBase = methodBody(contest, 'export class ContestDetailBaseHandler', 'tsdocAsPublic()');
    assert.match(detailBase, /const authoritativeDomainId = String\(this\.domain\?\._id\)/);
    assert.match(detailBase, /contest\.get\(authoritativeDomainId, tid\)/);
    assert.match(detailBase, /contest\.getStatus\(authoritativeDomainId, tid/);
    assert.match(detailBase, /user\.listGroup\(authoritativeDomainId/);
    assert.doesNotMatch(detailBase, /contest\.get\(domainId|contest\.getStatus\(domainId|user\.listGroup\(domainId/);
});

test('shared training/course picker stays on the core-scoped /p?quick endpoint', () => {
    assert.match(problemPicker, /new URL\('\/p'/);
    assert.match(problemPicker, /url\.searchParams\.set\('quick', 'true'\)/);
    assert.doesNotMatch(problemPicker, /filter\([^\n]*owner|filter\([^\n]*maintainer/);
});
