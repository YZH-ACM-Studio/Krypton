import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(path: string) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const handler = read('packages/hydrooj/src/handler/problem.ts');
const navigation = read('packages/ui-next/src/components/problem-bank-nav.tsx');
const problems = read('packages/ui-next/src/pages/problems.tsx');
const review = read('packages/ui-next/src/pages/problem-review.tsx');
const namespaceWorkspace = read('packages/ui-next/src/pages/problem-pid-namespaces.tsx');
const namespaceModel = read('packages/hydrooj/src/model/problem-pid-namespace.ts');
const problemModel = read('packages/hydrooj/src/model/problem.ts');
const problemEditor = read('packages/ui-next/src/pages/problem-edit.tsx');
const resolver = read('packages/ui-next/src/pages/resolver.tsx');
const sidebar = read('packages/ui-next/src/components/layout/sidebar.tsx');

test('review route is namespace-manager scoped and registered before dynamic problem routes', () => {
  const queueStart = handler.indexOf('export class ProblemReviewHandler');
  const queueEnd = handler.indexOf('export class ProblemRandomHandler', queueStart);
  const queue = handler.slice(queueStart, queueEnd);
  assert.notEqual(queueStart, -1);
  assert.notEqual(queueEnd, -1);
  assert.match(queue, /if \(!canReviewPidNamespaceProblems\(this\.user, domainId\)\) throw new PermissionError\(PERM\.PERM_EDIT_PROBLEM\)/);
  assert.match(queue, /problem\.refreshProblemAcl\(this\.user, domainId\)/);
  assert.match(queue, /problem\.assertProblemAclDomain\(this\.user, domainId\)/);
  assert.match(queue, /problem\.buildProblemBankScope\(this\.user\)/);
  assert.match(queue, /authoringMode: 'managed'/);
  assert.match(queue, /hidden: true/);
  assert.match(queue, /archivedAt: \{ \$exists: false \}/);
  assert.match(queue, /\$in: \['draft', 'confirmed'\]/);
  assert.match(queue, /buildProblemTextFilter\(normalizedQuery, false\)/);
  assert.match(queue, /this\.paginate\(/);
  assert.match(queue, /pendingProblemContributionReviewFacts/);
  assert.match(queue, /problemAuthorUsers/);
  assert.match(queue, /managedPidNamespaceIds\(this\.user, domainId\)/);
  assert.match(queue, /pidNamespaceId: \{ \$in:/);

  const reviewRoute = handler.indexOf("ctx.Route('problem_review'");
  const detailRoute = handler.indexOf("ctx.Route('problem_detail'");
  assert.ok(reviewRoute >= 0 && reviewRoute < detailRoute, 'static review route must be registered before /p/:pid');
});

test('problem bank exposes one local scoped navigation without adding another sidebar item', () => {
  assert.match(navigation, /全部题目/);
  assert.match(navigation, /审核队列/);
  assert.match(navigation, /if \(!canReview && !canManageNamespaces\) return null/);
  assert.match(navigation, /题号命名空间/);
  assert.match(problems, /<ProblemBankNav/);
  assert.match(problems, /reviewUrl=\{String\(data\.problemReviewUrl \|\| ''\)\}/);
  assert.match(resolver, /'problem_review\.html': ProblemReviewPage/);
  assert.match(sidebar, /'problem_review\.html'/);
  assert.equal((sidebar.match(/label: '题库'/g) || []).length, 1);
});

test('review workspace reuses publication protocol and keeps the queue deliberately narrow', () => {
  assert.match(review, /REVIEW_STATUS_OPTIONS/);
  assert.match(review, /全部待处理/);
  assert.match(review, /首次审核/);
  assert.match(review, /重新公开/);
  assert.match(review, /ManagedPublishProtocolFields/);
  assert.match(review, /action=\{bs\.urls\.problems\}/);
  assert.match(review, /pendingContributionsConfirmed/);
  assert.match(review, /pendingContributionFingerprint/);
  assert.match(review, /<Dialog/);
  assert.match(review, /<DialogBody/);
  assert.match(review, /role="dialog"/);
  assert.match(review, /aria-modal="true"/);
  assert.match(review, /aria-labelledby=\{PUBLISH_CONFIRM_TITLE_ID\}/);
  assert.match(review, /onKeyDown=\{trapDialogFocus\}/);
  assert.match(review, /publishReturnFocusRef/);
  assert.match(review, /autoFocus/);
  assert.match(review, /<Pagination/);
  assert.match(review, /工作标题/);
  assert.match(review, /正式标题/);
  assert.match(review, /查看/);
  assert.match(review, /编辑/);
  assert.doesNotMatch(review, /批量通过|驳回理由|审核历史|领取任务/);
});

test('problem bank projection carries the exact structure revision required by publication forms', () => {
  const projectionStart = problemModel.indexOf('static PROJECTION_MANAGED_BANK');
  const projectionEnd = problemModel.indexOf('static isProblemBankAdmin', projectionStart);
  const projection = problemModel.slice(projectionStart, projectionEnd);
  assert.notEqual(projectionStart, -1);
  assert.notEqual(projectionEnd, -1);
  assert.match(problems, /expectedStructureRevision=\{pdoc\.structureRevision\}/);
  assert.match(review, /expectedStructureRevision=\{pdoc\.structureRevision\}/);
  assert.match(projection, /'structureRevision'/);
});

test('namespace review exposes only the approved metadata, return, visibility and admin-correction operations', () => {
  assert.match(review, /name="operation" value="managedReview"/);
  assert.match(review, /name="returnNote"/);
  assert.match(review, /保存审核信息/);
  assert.match(review, /退回修改/);
  assert.match(review, /name="finalHidden" value="true"/);
  assert.match(review, /name="operation" value="managedNamespaceCorrect"/);
  assert.match(review, /canCorrectPidNamespaces/);
  assert.match(problemModel, /static async updateManagedProgrammingReview/);
  assert.match(problemModel, /static async correctManagedProgrammingPidNamespace/);
  assert.match(problemModel, /!ProblemModel\.isProblemBankAdmin\(input\.user\)/);
  assert.match(problemModel, /requiredPidNamespaceGrant: 'manager'/);
  const publishStart = problemModel.indexOf('static async publishManagedProgrammingProblem');
  const publishEnd = problemModel.indexOf('static createProblemByKind', publishStart);
  assert.doesNotMatch(problemModel.slice(publishStart, publishEnd), /!ProblemModel\.isProblemBankAdmin\(input\.user\)/);
});

test('managed creation keeps the source template inside the selected PID namespace', () => {
  assert.match(problemEditor, /const nextNamespace = pidNamespaces\.find\(\(namespace\) => namespace\.namespaceId === value\)/);
  assert.match(problemEditor, /!nextNamespace\.sourceTemplates\.includes\(sourceTemplate\)/);
  assert.match(problemEditor, /setSourceTemplate\(nextNamespace\.sourceTemplates\[0\] \|\| ''\)/);
});

test('namespace workspace keeps scoped roles orthogonal and uses custom dialogs for dangerous actions', () => {
  assert.match(namespaceWorkspace, /出题人/);
  assert.match(namespaceWorkspace, /负责人/);
  assert.match(namespaceWorkspace, /编辑全部题目/);
  assert.match(namespaceWorkspace, /最近操作/);
  assert.match(namespaceWorkspace, /最多展示当前可管理范围最近 30 条/);
  assert.match(namespaceWorkspace, /'incomplete'/);
  assert.match(namespaceWorkspace, /已提交但收尾异常/);
  assert.match(namespaceWorkspace, /<Dialog/);
  assert.doesNotMatch(namespaceWorkspace, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.match(namespaceModel, /if \(!admin && actorMember\?\.role !== 'manager'\)/);
  assert.match(namespaceModel, /const writesOrdinaryAuthor/);
  assert.match(namespaceModel, /命名空间已分配过题号，只能停用，不能删除/);
});
