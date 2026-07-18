import { readFileSync } from 'node:fs';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

describe('P2.25 contribution assignment and task UI', () => {
  it('uses explicit current-page selection and one bounded batch request', () => {
    const source = read('packages/ui-next/src/pages/problems.tsx');
    expect(source).to.include('selectedContributionPids');
    expect(source).to.include("form.set('pids', selectedPdocs.map((pdoc) => pdoc.docId).join(','))");
    expect(source).to.include("'expectedRevisions'");
    expect(source).to.include("fetch('/problem-contributions/bulk'");
    expect(source).not.to.include('当前筛选结果全部');
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
});
