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
const resolver = read('packages/ui-next/src/pages/resolver.tsx');
const sidebar = read('packages/ui-next/src/components/layout/sidebar.tsx');

test('review route is administrator-gated and registered before dynamic problem routes', () => {
  const queueStart = handler.indexOf('export class ProblemReviewHandler');
  const queueEnd = handler.indexOf('export class ProblemRandomHandler', queueStart);
  const queue = handler.slice(queueStart, queueEnd);
  assert.notEqual(queueStart, -1);
  assert.notEqual(queueEnd, -1);
  assert.match(queue, /if \(!problem\.isProblemBankAdmin\(this\.user\)\) throw new PermissionError\(PERM\.PERM_EDIT_PROBLEM\)/);
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

  const reviewRoute = handler.indexOf("ctx.Route('problem_review'");
  const detailRoute = handler.indexOf("ctx.Route('problem_detail'");
  assert.ok(reviewRoute >= 0 && reviewRoute < detailRoute, 'static review route must be registered before /p/:pid');
});

test('problem bank exposes one local admin navigation without adding another sidebar item', () => {
  assert.match(navigation, /全部题目/);
  assert.match(navigation, /审核队列/);
  assert.match(navigation, /if \(!canReview\) return null/);
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
