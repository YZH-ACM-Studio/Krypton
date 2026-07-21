import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Shared fail-closed CodeMirror policy for submitted-source viewers. */
export const READ_ONLY_CODE_EXTENSIONS: Extension[] = [EditorState.readOnly.of(true), EditorView.editable.of(false)];

/** Record language is authoritative; local writable-IDE preferences are irrelevant. */
export function resolveReadOnlyCodeLanguage(defaultLang?: string, langs: string[] = []): string {
  return defaultLang || langs[0] || 'txt';
}
