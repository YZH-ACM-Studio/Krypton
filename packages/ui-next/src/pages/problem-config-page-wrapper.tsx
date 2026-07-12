/** Shared programming-problem workspace wrapper for judge configuration. */

import { ProblemEditorWorkspace } from '@/components/problem-editor-workspace';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { ProblemConfigEditor } from './problem-config-editor';

type R = Record<string, any>;

export function ProblemConfigPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const testdata: R[] = Array.isArray(data.testdata) ? data.testdata : [];
  const config: string = data.config || '';
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  return (
    <ProblemEditorWorkspace
      page="config"
      problemUrl={problemUrl}
      title={pdoc.title || String(pid)}
      pid={String(pid)}
    >
      <ProblemConfigEditor
        problemUrl={problemUrl}
        pdoc={pdoc}
        files={testdata}
        initialYaml={config}
        embedded
      />
    </ProblemEditorWorkspace>
  );
}
