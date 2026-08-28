import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  practiceDraftIdentity,
  practiceProblemEntryUrl,
  readPracticeEnforcement,
  readPracticeIntegrityPageContext,
  type PracticeIntegrityPageContext,
} from '../src/lib/practice-integrity';

const containerId = '66b800000000000000000021';
const workspaceRoot = resolve(import.meta.dirname, '../..');

describe('practice integrity client boundary', () => {
  it('builds a context request URL without treating query data as a trusted policy', () => {
    expect(
      practiceProblemEntryUrl('/p/1001', {
        containerKind: 'course',
        containerId,
        scopeKind: 'chapter',
        scopeId: 2,
      }),
    ).toBe(`/p/1001?practiceContainerKind=course&practiceContainerId=${containerId}&practiceScopeKind=chapter&practiceScopeId=2`);
  });

  it('binds a refresh-stable draft identity to every participating target and policy revision', () => {
    const context = readPracticeIntegrityPageContext({
      controlled: true,
      bypassed: false,
      previewAvailable: false,
      entry: { containerKind: 'course', containerId, scopeKind: 'chapter', scopeId: 2 },
      contextId: '66b800000000000000000020',
      expiresAt: '2026-08-09T12:00:00.000Z',
      mode: 'student',
      policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true, antiAiCopyInjection: false },
      revisions: [
        { containerKind: 'course', containerId, scopeKind: 'chapter', scopeId: 2, revision: 3 },
        { containerKind: 'problemSet', containerId: '66b800000000000000000022', scopeKind: 'stage', scopeId: 4, revision: 7 },
      ],
    });
    expect(practiceDraftIdentity(context!)).toBe(`student|course:${containerId}:chapter:2:3|problemSet:66b800000000000000000022:stage:4:7`);
  });

  it('reads inherited enforcement as a sibling payload and never as uncontrolled policy', () => {
    expect(readPracticeEnforcement(undefined)).to.deep.equal({
      prohibitExternalCodeInjection: false,
      removeIndependentSubmitForm: false,
    });
    expect(readPracticeEnforcement({ prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true })).to.deep.equal({
      prohibitExternalCodeInjection: true,
      removeIndependentSubmitForm: true,
    });
    expect(() =>
      readPracticeEnforcement({
        prohibitExternalCodeInjection: true,
        removeIndependentSubmitForm: false,
        antiAiCopyInjection: true,
      }),
    ).toThrow('exactly two boolean fields');
  });

  it('does not allow an uncontrolled payload to smuggle policy or context fields', () => {
    expect(() =>
      readPracticeIntegrityPageContext({
        controlled: false,
        bypassed: false,
        previewAvailable: false,
        entry: { containerKind: 'course', containerId, scopeKind: 'chapter', scopeId: 2 },
        policy: { prohibitExternalCodeInjection: true },
      }),
    ).toThrow('uncontrolled practiceIntegrity must not contain a trusted context');
  });

  it('fails closed when a controlled payload also claims an unrestricted bypass', () => {
    expect(() =>
      readPracticeIntegrityPageContext({
        controlled: true,
        bypassed: true,
        previewAvailable: true,
        entry: { containerKind: 'course', containerId, scopeKind: 'chapter', scopeId: 2 },
        contextId: '66b800000000000000000020',
        expiresAt: '2026-08-09T12:00:00.000Z',
        mode: 'preview',
        policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true, antiAiCopyInjection: false },
        revisions: [{ containerKind: 'course', containerId, scopeKind: 'chapter', scopeId: 2, revision: 3 }],
      }),
    ).toThrow('controlled practiceIntegrity cannot bypass its policy');
  });

  it('changes draft identity across scope or revision but not across renewed ephemeral context ids', () => {
    const base: PracticeIntegrityPageContext = {
      controlled: true,
      bypassed: false,
      previewAvailable: false,
      entry: { containerKind: 'problemSet', containerId, scopeKind: 'stage', scopeId: 2 },
      contextId: '66b800000000000000000020',
      expiresAt: '2026-08-09T12:00:00.000Z',
      mode: 'student',
      policy: { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true, antiAiCopyInjection: false },
      revisions: [{ containerKind: 'problemSet', containerId, scopeKind: 'stage', scopeId: 2, revision: 3 }],
    };
    expect(practiceDraftIdentity({ ...base, contextId: '66b800000000000000000099' })).toBe(practiceDraftIdentity(base));
    expect(practiceDraftIdentity({ ...base, revisions: [{ ...base.revisions![0], scopeId: 3 }] })).not.toBe(practiceDraftIdentity(base));
    expect(practiceDraftIdentity({ ...base, revisions: [{ ...base.revisions![0], revision: 4 }] })).not.toBe(practiceDraftIdentity(base));
    expect(practiceDraftIdentity({ ...base, mode: 'preview' })).not.toBe(practiceDraftIdentity(base));
  });

  it('keeps the ui-default scratchpad inside the same controlled boundary', () => {
    const detail = readFileSync(resolve(workspaceRoot, 'ui-default/templates/problem_detail.html'), 'utf8');
    const sidebar = readFileSync(resolve(workspaceRoot, 'ui-default/templates/partials/problem_sidebar_normal.html'), 'utf8');
    const submitFallback = readFileSync(resolve(workspaceRoot, 'ui-default/templates/problem_submit.html'), 'utf8');
    const toolbar = readFileSync(resolve(workspaceRoot, 'ui-default/components/scratchpad/ScratchpadToolbarContainer.jsx'), 'utf8');
    const editor = readFileSync(resolve(workspaceRoot, 'ui-default/components/scratchpad/ScratchpadEditorContainer.tsx'), 'utf8');
    const draft = readFileSync(resolve(workspaceRoot, 'ui-default/components/scratchpad/reducers/editor.ts'), 'utf8');
    expect(detail).to.include('practiceContextId: practiceIntegrity.contextId');
    expect(detail).to.include('practiceIntegrity and practiceIntegrity.entry');
    expect(detail).to.include('practiceControlled and practiceIntegrity.policy.antiAiCopyInjection');
    expect(detail).to.include('This interface cannot verify anti-AI copy markers');
    expect(detail).to.include('query={lang:k, practiceContainerKind:practiceIntegrity.entry.containerKind');
    expect(sidebar).to.include(
      'not inheritIdeOnly and (not practiceControlled or not practiceIntegrity.policy.removeIndependentSubmitForm or practiceStructuredIde)',
    );
    expect(sidebar).to.include('{% set practiceEntryActive = practiceIntegrity and practiceIntegrity.entry %}');
    expect(sidebar).to.include('{% set practiceLegacyBlocked = practiceControlled and practiceIntegrity.policy.antiAiCopyInjection %}');
    expect(sidebar).to.include('if practiceLegacyBlocked');
    expect(sidebar).to.include('query={practiceContainerKind:practiceIntegrity.entry.containerKind');
    expect(sidebar).to.include('practiceIntegrity.previewAvailable');
    expect(sidebar).to.include("practicePreview:practiceIntegrity.mode != 'preview'");
    expect(sidebar).to.include("_('Exit student preview') if practiceIntegrity.mode == 'preview' else _('Enter student preview')");
    expect(submitFallback).to.include('practiceIntegrity.policy.prohibitExternalCodeInjection');
    expect(submitFallback).to.include('{% if controlledStructured or controlledExternalInjection or inheritedExternalInjection %}');
    expect(submitFallback).to.include('the fallback form is disabled');
    expect(toolbar.match(/practiceContextId: UiContext\.practiceContextId/g)).to.have.length(2);
    expect(editor).to.include('onPasteCapture={this.rejectExternalCode}');
    expect(editor).to.include('UiContext.practiceEnforcement?.prohibitExternalCodeInjection === true');
    expect(editor).to.include('onDropCapture={this.rejectExternalCode}');
    expect(editor).to.include("inputType === 'insertFromPaste' || inputType === 'insertFromDrop'");
    expect(draft).to.include('cacheKey += `@practice:');
    expect(draft).to.include('context.mode');
    expect(draft).to.include('revisions');
    expect(draft).to.include('#code:');
    expect(draft).to.include('encodeURIComponent(lang)');
    expect(draft).to.include('localStorage.getItem(codeKey(initialLang)) ?? UiContext.codeTemplate');
    expect(draft).to.include('controlled ? { code: localStorage.getItem(codeKey(action.payload)) ?? UiContext.codeTemplate } : {}');
  });

  it('only activates marker rendering from a verified controlled context and blocks malformed initialization', () => {
    const detail = readFileSync(resolve(workspaceRoot, 'ui-next/src/pages/problem-detail.tsx'), 'utf8');
    const model = readFileSync(resolve(workspaceRoot, 'hydrooj/src/model/problem.ts'), 'utf8');
    expect(detail).to.include('practiceControlled || practicePolicy?.antiAiCopyInjection !== true');
    expect(detail).to.include('readAntiAiMarkerClientView(data.antiAiMarkerView)');
    expect(detail).to.include('Controlled statement initialization failed');
    expect(detail).to.include('ControlledStatementErrorBoundary');
    expect(detail).to.include('setAntiAiRenderFailed(true)');
    expect(detail).to.include('const antiAiCopyFailed = antiAiCopyInitialization.failed || antiAiRenderFailed');
    expect(detail).to.include('data.canSubmitProblem === true && !antiAiCopyFailed');
    expect(detail).to.include('当前题面无法验证复制保护数据，已阻止进入和提交');
    expect(detail).to.include('<AntiAiCopyBoundary markers={antiAiCopyMarkers} contextId={practiceContextId}>');
    expect(detail).to.include("observableStatementError(error, 'safe-view-parse', practiceContextId)");
    expect(detail).to.include("observableStatementError(error, 'statement-render', this.props.contextId)");
    expect(detail).to.include('readPracticeEnforcement(data.practiceEnforcement)');
    expect(detail).to.include('practicePolicy?.prohibitExternalCodeInjection === true || practiceEnforcement.prohibitExternalCodeInjection');
    expect(detail).to.include('practicePolicy?.removeIndependentSubmitForm === true || practiceEnforcement.removeIndependentSubmitForm');
    expect(model).to.include('if (pdoc.antiAiMarkers === undefined) return { schemaVersion: 1 as const, markers: [] }');
  });

  it('mounts the teacher policy panel on course and problem-set editors', () => {
    const courseEditor = readFileSync(resolve(workspaceRoot, 'ui-next/src/pages/course/editor.tsx'), 'utf8');
    const setEditor = readFileSync(resolve(workspaceRoot, 'ui-next/src/pages/training-manage.tsx'), 'utf8');
    const panel = readFileSync(resolve(workspaceRoot, 'ui-next/src/components/practice-integrity-policy-panel.tsx'), 'utf8');
    expect(courseEditor).to.include('PracticeIntegrityPolicyPanel');
    expect(courseEditor).to.include('containerKind="course"');
    expect(setEditor).to.include('PracticeIntegrityPolicyPanel');
    expect(setEditor).to.include('containerKind="problemSet"');
    expect(panel).to.include("operation === 'publish' ? '发布真实性策略失败' : '保存真实性策略失败'");
    expect(panel).to.include('expectedDraftVersion');
  });

  it('flushes dedicated submit-page drafts and preserves an intentional empty cache value', () => {
    const submit = readFileSync(resolve(workspaceRoot, 'ui-next/src/pages/problem-submit.tsx'), 'utf8');
    expect(submit).to.include('if (saved !== null)');
    expect(submit).to.include('if (saved === null)');
    expect(submit).to.include("window.addEventListener('pagehide', flushDraft)");
    expect(submit).to.include('if (practiceControlled) save()');
  });
});
