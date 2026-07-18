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
  const capabilities: R = data.problemAuthoringCapabilities || {};
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
      editEnabled={capabilities.canEditContent === true || capabilities.canEditTags === true}
      dataEnabled={capabilities.canEditData === true}
      collaborationEnabled={
        capabilities.canManageCollaborators === true || capabilities.canManageContributions === true || capabilities.canPublish === true
      }
    >
      <ProblemConfigEditor problemUrl={problemUrl} pdoc={pdoc} files={testdata} initialYaml={config} dataWriteGuard={data.dataWriteGuard} embedded />
    </ProblemEditorWorkspace>
  );
}
