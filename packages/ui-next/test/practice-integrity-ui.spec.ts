import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  practiceDraftIdentity,
  practiceProblemEntryUrl,
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
    expect(detail).to.include('query={lang:k, practiceContainerKind:practiceIntegrity.entry.containerKind');
    expect(sidebar).to.include('not practiceIntegrity.policy.removeIndependentSubmitForm or practiceStructuredIde');
    expect(sidebar).to.include('{% set practiceEntryActive = practiceIntegrity and practiceIntegrity.entry %}');
    expect(sidebar).to.include('query={practiceContainerKind:practiceIntegrity.entry.containerKind');
    expect(sidebar).to.include('practiceIntegrity.previewAvailable');
    expect(sidebar).to.include("practicePreview:practiceIntegrity.mode != 'preview'");
    expect(sidebar).to.include("_('Exit student preview') if practiceIntegrity.mode == 'preview' else _('Enter student preview')");
    expect(submitFallback).to.include('practiceIntegrity.policy.prohibitExternalCodeInjection');
    expect(submitFallback).to.include('{% if controlledStructured or controlledExternalInjection %}');
    expect(submitFallback).to.include('the fallback form is disabled');
    expect(toolbar.match(/practiceContextId: UiContext\.practiceContextId/g)).to.have.length(2);
    expect(editor).to.include('onPasteCapture={this.rejectExternalCode}');
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

  it('flushes dedicated submit-page drafts and preserves an intentional empty cache value', () => {
    const submit = readFileSync(resolve(workspaceRoot, 'ui-next/src/pages/problem-submit.tsx'), 'utf8');
    expect(submit).to.include('if (saved !== null)');
    expect(submit).to.include('if (saved === null)');
    expect(submit).to.include("window.addEventListener('pagehide', flushDraft)");
    expect(submit).to.include('if (practiceControlled) save()');
  });
});
