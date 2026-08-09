import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

const read = (path: string) => readFileSync(resolve(workspaceRoot, path), 'utf8');

describe('p2.25 contribution assignment and task UI', () => {
  it('uses HTTP-compatible request IDs inside each mutation cleanup boundary', () => {
    const problems = read('packages/ui-next/src/pages/problems.tsx');
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const inbox = read('packages/ui-next/src/pages/permits/inbox.tsx');
    const finallyGuardedSections = [
      problems.slice(problems.indexOf('async function submitContributionBatch'), problems.indexOf('function requestManagedPublish')),
      edit.slice(edit.indexOf('async function assign'), edit.indexOf('async function mutate')),
      edit.slice(edit.indexOf('async function mutate'), edit.indexOf('\n\n  return (', edit.indexOf('async function mutate'))),
    ];
    const reloadGuardedSection = inbox.slice(
      inbox.indexOf('async function complete'),
      inbox.indexOf('\n\n  return (', inbox.indexOf('async function complete')),
    );

    for (const section of finallyGuardedSections) {
      expect(section).not.to.equal('');
      expect(section).not.to.include('crypto.randomUUID');
      expect(section).to.include('createRequestId()');
      expect(section.indexOf('try {')).to.be.lessThan(section.indexOf('createRequestId()'));
      expect(section.indexOf('finally {')).to.be.greaterThan(section.indexOf('createRequestId()'));
    }

    expect(reloadGuardedSection).not.to.include('crypto.randomUUID');
    expect(reloadGuardedSection.indexOf('try {')).to.be.lessThan(reloadGuardedSection.indexOf('createRequestId()'));
    expect(reloadGuardedSection.indexOf('catch (cause)')).to.be.greaterThan(reloadGuardedSection.indexOf('createRequestId()'));
    const failureBranch = reloadGuardedSection.slice(reloadGuardedSection.indexOf('catch (cause)'));
    expect(failureBranch).to.include("setCompleting('')");
    expect(failureBranch).not.to.include('finally {');
  });

  it('surfaces contribution mutation errors inside active dialogs', () => {
    const problems = read('packages/ui-next/src/pages/problems.tsx');
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const batchDialog = problems.slice(problems.indexOf('<Dialog open={batchOpen}'), problems.indexOf('<Dialog open={publishConfirm'));
    const assignDialog = edit.slice(edit.indexOf('<Dialog open={assignOpen}'), edit.indexOf('<Dialog open={revokeTarget'));
    const revokeDialog = edit.slice(
      edit.indexOf('<Dialog open={revokeTarget'),
      edit.indexOf('</section>', edit.indexOf('<Dialog open={revokeTarget')),
    );

    expect(batchDialog).to.include('role="alert"');
    expect(batchDialog).to.include('{batchError}');
    expect(assignDialog).to.include('role="alert"');
    expect(assignDialog).to.include('{error}');
    expect(revokeDialog).to.include('role="alert"');
    expect(revokeDialog).to.include('{error}');
  });

  it('uses explicit current-page selection and one bounded batch request', () => {
    const source = read('packages/ui-next/src/pages/problems.tsx');
    expect(source).to.include('selectedContributionPids');
    expect(source).to.include("form.set('pids', selectedPdocs.map((pdoc) => pdoc.docId).join(','))");
    expect(source).to.include("'expectedRevisions'");
    expect(source).to.include("fetchHydroResponse('/problem-contributions/bulk'");
    expect(source).not.to.include('当前筛选结果全部');
  });

  it('offers canonical read-only verifier assignment and renders every server result state', () => {
    const source = read('packages/ui-next/src/pages/problems.tsx');
    expect(source).to.include("form.set('role', 'verifier')");
    expect(source).to.include("form.delete('scopes')");
    expect(source).to.include('const result = parseBulkVerifierResponse(');
    expect(source).to.include("['applied', '已新增']");
    expect(source).to.include("['already-present', '已是只读验题人']");
    expect(source).to.include("['conflict-higher-role', '已有更高角色，未降级']");
    expect(source).to.include("['failed', '失败，可重试']");
    expect(source).to.include('setSelectedContributionPids(new Set(result.retryPids))');
    expect(source).to.include('record.requestId !== expectedRequestId');
    expect(source).to.include("batchVerifierRole && batchVerifierResults?.retryPids.length ? '重试失败项'");
    expect(source.match(/setBatchVerifierResults\(null\);/g)).to.have.length.greaterThanOrEqual(6);
    expect(source).to.match(/onChange=\{\(next\) => \{\s+setBatchVerifierResults\(null\);\s+setBatchError\(''\);\s+setBatchMessage\(''\);/);
  });

  it('keeps per-problem contribution management separate from legacy roles', () => {
    const source = read('packages/ui-next/src/pages/problem-edit.tsx');
    expect(source).to.include('capabilities.canManageContributions === true');
    expect(source).to.include('<ContributionsPanel');
    expect(source).to.include('/problem-contributions/bulk');
    expect(source).to.include("operation === 'reopen'");
    expect(source).to.include('/contributions/revoke');
  });

  it('adds pending-first data and tag groups while keeping completed tasks collapsible', () => {
    const source = read('packages/ui-next/src/pages/permits/inbox.tsx');
    expect(source).to.include('const direct = (data.permits || []).filter');
    expect(source).to.include('const byContest = new Map<string, PermitRow[]>()');
    expect(source).to.include("(['data', 'tag'] as const).map");
    expect(source).to.include("row.status === 'pending'");
    expect(source).to.include('<details');
    expect(source).to.include("fd.set('status', 'completed')");
  });

  it('shows pending assignees and submits an explicit snapshot-bound publish confirmation', () => {
    const source = read('packages/ui-next/src/pages/problems.tsx');
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const authority = read('packages/ui-next/src/components/managed-programming-authority.tsx');
    expect(source).to.include('pendingContributionsByDocId');
    expect(source).to.include('pendingContributionFingerprintByDocId');
    expect(source).to.include('name="pendingContributionsConfirmed" value="false"');
    expect(source).to.include('<Dialog open={publishConfirm !== null}');
    expect(edit).to.include('pendingContributions={data.managedPendingContributions}');
    expect(edit).to.include('pendingContributionFingerprint={data.managedPendingContributionFingerprint}');
    expect(authority).to.include("payload.set('pendingContributionsConfirmed', String(pendingConfirmed))");
    expect(authority).to.include('<Dialog open={pendingConfirmOpen}');
  });

  it('renders edit and archive from separate canonical capabilities', () => {
    const source = read('packages/ui-next/src/pages/problems.tsx');
    expect(source).to.include('const canManageByDocId');
    expect(source).to.include('const canArchiveByDocId');
    expect(source).to.include('const canArchive = !!canArchiveByDocId[docId]');
    expect(source).to.include('{canArchive && !pdoc.archivedAt ? (');
  });
});
