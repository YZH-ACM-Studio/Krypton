import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const packageRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(packageRoot, '../..');

function read(relative: string) {
  return readFileSync(resolve(workspaceRoot, relative), 'utf8');
}

describe('P3.12 programming editor workspace', () => {
  it('uses one ordered six-step workspace across edit, config, and files', () => {
    const shell = read('packages/ui-next/src/components/problem-editor-workspace.tsx');
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const config = read('packages/ui-next/src/pages/problem-config-page-wrapper.tsx');
    const files = read('packages/ui-next/src/pages/problem-manage.tsx');
    const labels = ['基本信息', '题面', '评测配置', '测试数据', '附加文件', '权限与维护者'];
    let previous = -1;
    for (const label of labels) {
      const index = shell.indexOf(`label: '${label}'`);
      expect(index, label).to.be.greaterThan(previous);
      previous = index;
    }
    expect(edit).to.include('<ProblemEditorWorkspace');
    expect(edit).to.include('page="edit"');
    expect(config).to.include('page="config"');
    expect(files).to.include('page="files"');
    expect(shell).to.include('lg:grid-cols-[15rem_minmax(0,1fr)]');
    expect(shell).to.include('lg:hidden');
  });

  it('moves programming creation under the shared hub without adding a conversion picker', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    expect(edit).not.to.include('TypePicker');
    expect(edit).not.to.include("from '@/pages/problem-type-editor'");
    expect(edit).not.to.include('buildConfigYaml');
    expect(edit).not.to.include("cfgForm.append('filename', 'config.yaml')");
    expect(handler).to.include("ctx.Route('problem_create', '/problem/create', ProblemCreateHubHandler");
    expect(handler).to.include("problemKindToSlug('programming')");
    expect(handler).to.include('ProblemCreateProgrammingHandler');
    expect(handler).to.match(/problem\.createProblemByKind\(\s*'programming'/);
  });

  it('preserves existing form fields and file/config APIs', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const config = read('packages/ui-next/src/pages/problem-config-editor.tsx');
    const files = read('packages/ui-next/src/pages/problem-manage.tsx');
    for (const name of ['difficulty', 'content', 'hidden', 'lockHidden']) {
      expect(edit).to.include(`name="${name}"`);
    }
    expect(edit).to.include("name={!managed || isCreate || canEditDraftMetadata ? 'title' : undefined}");
    expect(edit).to.include("name={managed ? undefined : 'pid'}");
    expect(edit).to.include("name={managed ? undefined : 'tag'}");
    expect(config).to.include("formData.append('operation', 'upload_file')");
    expect(config).to.include("formData.append('type', 'testdata')");
    expect(config).to.include("formData.append('filename', 'config.yaml')");
    const problemUrlExpression = ['$', '{problemUrl}'].join('');
    expect(config).to.include(`fetch(\`${problemUrlExpression}/files\``);
    expect(files).to.include(`endpoint={\`${problemUrlExpression}/files\`}`);
    expect(files).to.include('meta={{ type }}');
    for (const operation of ['get_links', 'rename_files', 'delete_files', 'generate_testdata']) {
      expect(files).to.include(`value="${operation}"`);
    }
  });

  it('serializes both checkbox states explicitly so administrators can clear them', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    expect(edit).to.include("name=\"hidden\" value={hiddenValue ? 'true' : 'false'}");
    expect(edit).to.include("name=\"lockHidden\" value={lockHiddenValue ? 'true' : 'false'}");
    expect(edit).to.include('checked={hiddenValue}');
    expect(edit).to.include('onCheckedChange={setHiddenValue}');
    expect(edit).to.include('checked={lockHiddenValue}');
    expect(edit).to.include('onCheckedChange={setLockHiddenValue}');
  });

  it('makes save errors, unsaved changes, and upload progress observable', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const config = read('packages/ui-next/src/pages/problem-config-editor.tsx');
    const files = read('packages/ui-next/src/pages/problem-manage.tsx');
    const uploader = read('packages/ui-next/src/components/uploader.tsx');
    expect(edit).to.include("'idle' | 'dirty' | 'saving' | 'saved' | 'error'");
    expect(edit).to.include("window.addEventListener('beforeunload'");
    expect(edit).to.include('const editVersion = useRef(0)');
    expect(edit).to.include('const allowNavigation = useRef(false)');
    expect(edit).to.include("['dirty', 'saving', 'error'].includes(saveState)");
    expect(edit).to.include('if (editVersion.current === savedVersion)');
    expect(edit).to.include("current === 'saving' ? current : 'dirty'");
    expect(edit).to.include('body?.error?.message || body?.message || body?.error');
    expect(edit).to.include('role="alert"');
    expect(edit).not.to.include('alert(');
    expect(config).to.include('const [dirty, setDirty] = useState(false)');
    expect(config).to.include("window.addEventListener('beforeunload'");
    expect(config).to.include('const editVersion = useRef(0)');
    expect(config).to.include('if (editVersion.current === savedVersion) setDirty(false)');
    expect(config).to.include('data?.error?.message || data?.message || data?.error');
    expect(config).to.include('role="alert"');
    expect(config).to.include('flex shrink-0 flex-col gap-3 sm:flex-row');
    expect(config).to.include('flex flex-wrap items-center gap-2 sm:ml-auto');
    expect(uploader).to.include('role="progressbar"');
    expect(uploader).to.include('aria-valuenow={it.progress}');
    expect(uploader).to.include("console.error('File upload batch failed'");
    expect(uploader).to.include('文件大小与数量以服务器限制为准');
    expect(uploader).to.include('onAfterResponse: (xhr) =>');
    expect(uploader).to.include('shouldRetry: retryOnFailure ? undefined : () => false');
    expect(uploader).to.include('for (const file of result.failed) uppy.removeFile(file.id)');
    expect(uploader).to.include('body?.error?.message || body?.message || body?.error');
    expect(uploader).to.include('<button\n        type="button"\n        onDragOver=');
    expect(files).to.include('maxFileSize={null}');
    expect(files).to.include('maxFiles={null}');
    expect(files).to.include('uploadConcurrency={1}');
    expect(files).to.include('retryOnFailure={false}');
    expect(files).not.to.include('256 * 1024 * 1024');
    expect(config).to.include('maxFileSize={null}');
    expect(config).to.include('maxFiles={null}');
    expect(config).to.include('uploadConcurrency={1}');
    expect(config).to.include('retryOnFailure={false}');
    expect(config).not.to.include('256 * 1024 * 1024');
  });
});
