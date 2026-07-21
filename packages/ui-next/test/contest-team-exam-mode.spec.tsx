import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { expect } from 'chai';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'node:test';
import { readTeamExamModeContext, TeamExamModeSummary } from '../src/components/team-exam-mode.tsx';
import { dispatchRecordSocketPayload, isTerminalRecordSocketClose } from '../src/hooks/use-record-socket.ts';
import { createLatestRequestGate } from '../src/lib/latest-request.ts';
import { READ_ONLY_CODE_EXTENSIONS, resolveReadOnlyCodeLanguage } from '../src/lib/readonly-code-policy.ts';

const workspace = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

function teamBootstrap(role: 'captain' | 'member' | 'admin_preview') {
  const writable = role === 'captain';
  return {
    enabled: true,
    rule: 'acm',
    teamId: role === 'admin_preview' ? null : '64a000000000000000000001',
    teamRole: role,
    teamInfo:
      role === 'admin_preview'
        ? null
        : {
            teamId: '64a000000000000000000001',
            name: 'Lambda',
            captainUid: 10,
            memberUids: [10, 11, 12],
            revision: 4,
          },
    canBrowseProblems: true,
    canViewTeamRecords: true,
    canEditCode: writable,
    canRun: writable,
    canSubmit: writable,
    canUseVirtualPrint: writable,
  };
}

describe('P1.14 team Exam Mode UI contracts', () => {
  it('keeps all three pre-existing response/DOM branches free of team UI', () => {
    const legacyFixtures = [
      { enabled: true, rule: 'exam', entryMode: 'client_required' },
      { enabled: true, rule: 'acm', entryMode: 'client_required' },
      { enabled: false, rule: 'acm', entryMode: 'open' },
    ];
    for (const fixture of legacyFixtures) {
      const context = readTeamExamModeContext(fixture);
      expect(context).to.equal(null);
      expect(renderToStaticMarkup(<TeamExamModeSummary context={context} />)).to.equal('');
    }
  });

  it('renders captain, member and administrator preview from server capabilities', () => {
    const captain = readTeamExamModeContext(teamBootstrap('captain'))!;
    expect(captain).to.include({ teamRole: 'captain', canEditCode: true, canRun: true, canSubmit: true });
    expect(renderToStaticMarkup(<TeamExamModeSummary context={captain} />)).to.include('Lambda · 队长');

    const member = readTeamExamModeContext(teamBootstrap('member'))!;
    expect(member).to.include({ teamRole: 'member', canEditCode: false, canRun: false, canSubmit: false });
    expect(renderToStaticMarkup(<TeamExamModeSummary context={member} />)).to.include('队员 · 只读工作台');

    const preview = readTeamExamModeContext(teamBootstrap('admin_preview'))!;
    expect(preview).to.include({ teamRole: 'admin_preview', canEditCode: false, canRun: false, canSubmit: false });
    expect(renderToStaticMarkup(<TeamExamModeSummary context={preview} />)).to.include('管理员预览模式');
  });

  it('fails malformed capability booleans closed once a team role is present', () => {
    const malformed = readTeamExamModeContext({ enabled: true, teamRole: 'captain', canBrowseProblems: true })!;
    expect(malformed).to.include({
      teamRole: 'captain',
      canBrowseProblems: true,
      canViewTeamRecords: false,
      canEditCode: false,
      canRun: false,
      canSubmit: false,
      canUseVirtualPrint: false,
    });

    const unknownRole = readTeamExamModeContext({
      enabled: true,
      teamId: '64a000000000000000000001',
      teamRole: 'future-role',
      canEditCode: true,
      canRun: true,
      canSubmit: true,
    })!;
    expect(unknownRole).to.include({
      teamRole: 'invalid',
      canEditCode: false,
      canRun: false,
      canSubmit: false,
    });
    expect(renderToStaticMarkup(<TeamExamModeSummary context={unknownRole} />)).to.include('团队身份异常 · 已锁定');
  });

  it('applies CodeMirror read-only facets and always takes highlighting from the record', () => {
    const state = EditorState.create({ doc: "print('team')", extensions: READ_ONLY_CODE_EXTENSIONS });
    expect(state.facet(EditorState.readOnly)).to.equal(true);
    expect(state.facet(EditorView.editable)).to.equal(false);
    expect(resolveReadOnlyCodeLanguage('py3', [])).to.equal('py3');
    expect(resolveReadOnlyCodeLanguage(undefined, ['java'])).to.equal('java');
    expect(resolveReadOnlyCodeLanguage(undefined, [])).to.equal('txt');
  });

  it('turns the existing record socket role event into an authoritative refresh signal', () => {
    const records: unknown[] = [];
    const revisions: Array<number | null> = [];
    const snapshots: string[] = [];
    dispatchRecordSocketPayload({ teamRoleChanged: true, teamRevision: 7 }, (rdoc) => records.push(rdoc), (revision) => revisions.push(revision));
    dispatchRecordSocketPayload(
      { teamCodeAvailable: true, snapshotId: '64a000000000000000000211' },
      (rdoc) => records.push(rdoc),
      (revision) => revisions.push(revision),
      (snapshotId) => snapshots.push(snapshotId),
    );
    dispatchRecordSocketPayload(
      { teamCodeAvailable: true, snapshotId: 'invalid' },
      (rdoc) => records.push(rdoc),
      (revision) => revisions.push(revision),
      (snapshotId) => snapshots.push(snapshotId),
    );
    dispatchRecordSocketPayload({ rdoc: { _id: 'record-1' } }, (rdoc) => records.push(rdoc), (revision) => revisions.push(revision));
    expect(revisions).to.deep.equal([7]);
    expect(snapshots).to.deep.equal(['64a000000000000000000211']);
    expect(records).to.deep.equal([{ _id: 'record-1' }]);
    expect(isTerminalRecordSocketClose('/exam-mode/team-role-conn', 4003)).to.equal(true);
    expect(isTerminalRecordSocketClose('/exam-mode/team-role-conn', 1006)).to.equal(false);
    expect(isTerminalRecordSocketClose('/record-conn', 4003)).to.equal(false);
  });

  it('keeps the latest snapshot selected when detail responses arrive out of order', async () => {
    const gate = createLatestRequestGate();
    let visibleSnapshot = '';
    let resolveFirst!: (value: string) => void;
    const firstResponse = new Promise<string>((resolvePromise) => {
      resolveFirst = resolvePromise;
    });

    const firstGeneration = gate.begin();
    const firstCommit = firstResponse.then((snapshotId) => {
      if (gate.isCurrent(firstGeneration)) visibleSnapshot = snapshotId;
    });
    const secondGeneration = gate.begin();
    await Promise.resolve('snapshot-b').then((snapshotId) => {
      if (gate.isCurrent(secondGeneration)) visibleSnapshot = snapshotId;
    });
    resolveFirst('snapshot-a');
    await firstCommit;

    expect(visibleSnapshot).to.equal('snapshot-b');
  });

  it('clears pending snapshot detail state on close, an empty list, and a list failure', () => {
    const drawer = source('packages/ui-next/src/components/team-code-snapshots.tsx');
    expect(drawer).to.match(/if \(!open\) \{[\s\S]*?setDetailLoading\(false\);[\s\S]*?return;/);
    expect(drawer).to.match(/setSelectedId\(null\);\s*setDetail\(null\);\s*setDetailLoading\(false\);/);
    expect(drawer).to.match(/caught\?\.name !== 'AbortError'[\s\S]*?setDetailLoading\(false\);[\s\S]*?无法读取代码快照列表/);
  });

  it('removes every member write affordance and preserves the same internal routes', () => {
    const paper = source('packages/hydrooj/src/handler/paper.ts');
    const problem = source('packages/ui-next/src/pages/problem-detail.tsx');
    const records = source('packages/ui-next/src/pages/records.tsx');
    const ide = source('packages/ui-next/src/components/krypton-ide.tsx');
    const examShell = source('packages/ui-next/src/components/layout/exam-shell.tsx');
    const objective = source('packages/ui-next/src/components/objective-answer-panel.tsx');
    const recordHandler = source('packages/hydrooj/src/handler/record.ts');

    expect(paper).to.include("contest.getParticipationMode(tdoc) !== 'team' || tdoc.rule !== 'acm'");
    expect(paper).to.include('...(teamContext || {})');
    expect(problem).to.include('mode="readonly"');
    expect(problem).to.include('teamReadOnlyView');
    expect(problem).to.include("teamCodeReadOnly ? '只读代码' : 'IDE 模式'");
    expect(problem).to.include('(!teamExamMode || teamExamMode.canSubmit)');
    expect(records).to.include('(!teamExamMode || teamExamMode.canEditCode)');
    expect(ide).to.match(/isReadOnly\s*\?\s*\[\.\.\.searchKeymap, \.\.\.foldKeymap\]/);
    expect(ide).to.include('READ_ONLY_CODE_EXTENSIONS');
    expect(ide).to.include('if (isReadOnly) return;');
    expect(ide).to.include('isReadOnly && teamReadOnlyView');
    expect(ide).to.include('data-readonly-code-toolbar');
    expect(ide).to.include('aria-label="缩小只读代码字号"');
    expect(ide).to.include('aria-label="放大只读代码字号"');
    expect(ide).to.include('{!isReadOnly || !teamReadOnlyView ? (');
    expect(ide).to.include('res.status === 409 && reloadOnConflict');
    expect(objective).to.include('res.status === 409 && reloadOnConflict');
    expect(recordHandler).to.include('currentRecordTeam.captainUid !== this.user._id');
    expect(recordHandler).to.include('currentRecordTeam = await getCurrentTeamForRecord');
    expect(recordHandler).to.include('teamRoleChanged: true');
    expect(paper).to.include("'/exam-mode/team-role-conn'");
    expect(paper).to.include("@param('teamId', Types.ObjectId)");
    expect(paper).to.include("@param('teamRevision', Types.UnsignedInt)");
    expect(paper).to.include('bootstrapTeamRevision !== teamContext.teamInfo?.revision');
    expect(examShell).to.include("path: '/exam-mode/team-role-conn'");
    expect(examShell).to.include('teamId: teamContext?.teamId || undefined');
    expect(examShell).to.include('teamRevision: Number.isSafeInteger(teamRoleRevision) ? teamRoleRevision : undefined');
    expect(examShell).to.include('onTeamRoleChange: teamContext ? () => window.location.reload() : undefined');
    expect(problem).to.include('const recordDetailRoute = examUrls.record || bs.urls.recordDetail');
    expect(problem).to.include('recordUrlTemplate={recordDetailRoute}');
  });
});
