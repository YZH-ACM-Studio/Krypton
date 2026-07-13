import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const packageRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(packageRoot, '../..');
const problemUrlExpression = ['$', '{problemUrl}'].join('');
const createdProblemUrlExpression = ['$', '{createdProblemUrl}'].join('');

function read(relative: string) {
  return readFileSync(resolve(workspaceRoot, relative), 'utf8');
}

describe('P3.15 programming editor workspace correction', () => {
  it('uses real routes for one ordered five-part workspace', () => {
    const shell = read('packages/ui-next/src/components/problem-editor-workspace.tsx');
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const config = read('packages/ui-next/src/pages/problem-config-page-wrapper.tsx');
    const files = read('packages/ui-next/src/pages/problem-manage.tsx');
    const labels = ['题目内容', '评测配置', '测试数据', '附加文件', '权限与协作'];
    let previous = -1;
    for (const label of labels) {
      const index = shell.indexOf(`label: '${label}'`);
      expect(index, label).to.be.greaterThan(previous);
      previous = index;
    }
    expect(edit).to.include('<ProblemEditorWorkspace');
    expect(edit).to.include("page={showCollaboration ? 'collaboration' : 'edit'}");
    expect(config).to.include('page="config"');
    expect(files).to.include('page="files"');
    expect(shell).to.include(`href: \`${problemUrlExpression}/config\``);
    expect(shell).to.include(`href: \`${problemUrlExpression}/files?section=testdata\``);
    expect(shell).to.include(`href: \`${problemUrlExpression}/files?section=additional\``);
    expect(shell).to.include(`href: \`${['$', '{editUrl}'].join('')}?section=collaboration\``);
    expect(shell).not.to.include('#basic');
    expect(shell).not.to.include('#statement');
    expect(shell).not.to.include('#permissions');
    expect(shell).not.to.include('#programming');
    expect(shell).to.include('lg:grid-cols-[15rem_minmax(0,1fr)]');
    expect(shell).to.include('lg:hidden');
  });

  it('keeps creation under the hub, disables unavailable destinations, and enters the real edit workspace', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const shell = read('packages/ui-next/src/components/problem-editor-workspace.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    expect(edit).not.to.include('TypePicker');
    expect(edit).not.to.include("from '@/pages/problem-type-editor'");
    expect(edit).not.to.include('buildConfigYaml');
    expect(edit).not.to.include("cfgForm.append('filename', 'config.yaml')");
    expect(handler).to.include("ctx.Route('problem_create', '/problem/create', ProblemCreateHubHandler");
    expect(handler).to.include("problemKindToSlug('programming')");
    expect(handler).to.include('ProblemCreateProgrammingHandler');
    expect(handler).to.match(/problem\.createProblemByKind\(\s*'programming'/);
    expect(shell).to.include("const createDisabledReason = '创建题目后可用'");
    expect(shell).to.include('disabled: isCreate || !collaborationEnabled');
    expect(shell).to.include('取得真实题号后，评测配置、文件与协作功能会在完整工作区开放');
    expect(edit).to.include('if (isCreate) {');
    expect(edit).to.include("throw new Error('创建响应缺少真实题号')");
    expect(edit).to.include('const createdProblemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(body.pid) })');
    expect(edit).to.include(`window.location.assign(\`${createdProblemUrlExpression}/edit\`)`);
  });

  it('merges metadata, managed source, visibility, and statement into one content form without sticky overlay', () => {
    const shell = read('packages/ui-next/src/components/problem-editor-workspace.tsx');
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    expect(edit).to.include('aria-labelledby="problem-content-heading"');
    expect(edit).to.include('标题、题号、标签、来源、可见性与题面由同一表单一次保存');
    expect(edit).to.include('题面正文');
    expect(edit).not.to.include('id="basic"');
    expect(edit).not.to.include('id="statement"');
    expect(edit).not.to.include('id="permissions"');
    expect(shell).not.to.include('sticky top-12');
    expect(shell).not.to.include('backdrop-blur');
    expect(shell).not.to.include('supports-[backdrop-filter]');
    expect(shell).to.include('sticky top-20');
    expect(edit).to.include('创建并进入工作区');
  });

  it('restores a capability-gated collaboration view and the existing managed review service', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    expect(edit).to.include("new URLSearchParams(window.location.search).get('section')");
    expect(edit).to.include("requestedSection === 'collaboration' && collaborationEnabled");
    expect(edit).to.include('<PermitsPanel');
    expect(edit).to.include('/permits/inbox');
    for (const role of ['出题人', '验题人', '维护者']) expect(edit).to.include(role);
    expect(edit).to.include('<ManagedReviewPanel');
    expect(edit).to.include('name="operation" value="managedPublish"');
    expect(edit).to.include('action={problemsUrl}');
    expect(edit).to.include("responseErrorMessage(response, '审核发布失败')");
  });

  it('keeps testdata and additional files on refresh-stable views of the existing files route', () => {
    const shell = read('packages/ui-next/src/components/problem-editor-workspace.tsx');
    const files = read('packages/ui-next/src/pages/problem-manage.tsx');
    expect(shell).to.include("export type ProblemEditorFileSection = 'testdata' | 'additional'");
    expect(files).to.include("new URLSearchParams(window.location.search).get('section') === 'additional'");
    expect(files).to.include("fileSection === 'testdata'");
    expect(files).to.include('fileSection={fileSection}');
  });

  it('preserves existing form fields and file/config APIs', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const config = read('packages/ui-next/src/pages/problem-config-editor.tsx');
    const files = read('packages/ui-next/src/pages/problem-manage.tsx');
    for (const name of ['difficulty', 'content', 'hidden', 'lockHidden']) {
      expect(edit).to.include(`name="${name}"`);
    }
    expect(edit).to.include("name={!managed || canSubmitManagedWorkingTitle ? 'title' : undefined}");
    expect(edit).to.include("const managedMetadataDraft = pdoc.managedAuthoring?.metadataStatus === 'draft'");
    expect(edit).to.match(/managedMetadataDraft\s*\? pdoc\.managedAuthoring\?\.workingTitle \|\| ''\s*: pdoc\.title \|\| ''/);
    expect(edit).to.include("name={managed ? undefined : 'pid'}");
    expect(edit).to.include("name={managed ? undefined : 'tag'}");
    expect(config).to.include("formData.append('operation', 'upload_file')");
    expect(config).to.include("formData.append('type', 'testdata')");
    expect(config).to.include("formData.append('filename', 'config.yaml')");
    expect(config).to.include(`fetch(\`${problemUrlExpression}/files\``);
    expect(files).to.include(`endpoint={\`${problemUrlExpression}/files\`}`);
    expect(files).to.include('meta={{ type }}');
    for (const operation of ['rename_files', 'delete_files', 'generate_testdata']) {
      expect(files).to.include(`value="${operation}"`);
    }
    expect(files).not.to.include('value="get_links"');
    expect(files).to.include('await downloadProblemFiles({');
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
