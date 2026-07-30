import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = resolve(import.meta.dirname, '../../..');

function source(path: string): string {
  return readFileSync(resolve(workspace, path), 'utf8');
}

function sourceFiles(path: string): string[] {
  return readdirSync(resolve(workspace, path), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[jt]sx?$/.test(entry.name))
    .map((entry) => resolve(entry.parentPath, entry.name));
}

describe('p2.45 first-party error presentation contracts', () => {
  it('routes every Exam Mode paper HTTP failure through the shared presenter without changing exam behavior', () => {
    const exam = source('packages/ui-next/src/pages/exam-mode/paper.tsx');

    expect(exam).to.include("from '@/lib/error-presenter'");
    expect(exam.match(/readHydroResponseError\(/g)).to.have.length(5);
    expect(exam).not.to.include('statusText');
    expect(exam).to.match(/fetchHydroResponse\(`\/paper\/\$\{tid\}\/draft`/);
    expect(exam).to.match(/fetchHydroResponse\(\s*`\/paper\/\$\{tid\}\/draft\/\$\{pid\}`/);
    expect(exam).to.match(/fetchHydroResponse\(\s*`\/paper\/\$\{tid\}\/lock-kind`/);
    expect(exam).to.match(/fetchHydroResponse\(\s*`\/paper\/\$\{tid\}\/submit-code\/\$\{pid\}`/);
    expect(exam).to.match(/fetchHydroResponse\(\s*`\/paper\/\$\{tid\}\/finalize`/);
    expect(exam).to.include('草稿加载失败：{draftLoadError} 已阻止作答、保存和交卷，请刷新重试。');
    expect(exam).to.match(/window\.location\.href = `\/c\/\$\{tid\}\/scoreboard`/);
  });

  it('removes the ui-default message-plus-params display paths', () => {
    const paths = [
      'packages/ui-default/utils/base.ts',
      'packages/ui-default/pages/contest_user.page.ts',
      'packages/ui-default/pages/contest_balloon.page.tsx',
      'packages/ui-default/pages/problem_files.page.tsx',
      'packages/ui-default/components/zipDownloader/index.ts',
    ];
    const combined = paths.map(source).join('\n');

    expect(combined).not.to.match(/params\.join/);
    expect(combined).not.to.match(/\[\s*error\.message\s*,\s*\.\.\.error\.params\s*\]/);
    expect(combined).not.to.match(/message\}\s+\$\{[^}]*params/);
  });

  it('routes the remaining first-party HTTP error surfaces through the common presenter', () => {
    const expectedCalls = new Map<string, number>([
      ['packages/ui-next/src/components/krypton-ide.tsx', 3],
      ['packages/ui-next/src/components/markdown-renderer.tsx', 1],
      ['packages/ui-next/src/components/problem-testdata-file-dialog.tsx', 2],
      ['packages/ui-next/src/components/uploader.tsx', 1],
      ['packages/ui-next/src/pages/admin-tasks/index.tsx', 1],
      ['packages/ui-next/src/pages/contest-manage.tsx', 2],
    ]);

    for (const [path, count] of expectedCalls) {
      const contents = source(path);
      expect(contents.match(/readHydroResponseError\(/g), path).to.have.length(count);
      expect(contents, path).not.to.match(/throw new Error\((?:`[^`]*HTTP|response\.statusText|res\.statusText)/);
    }

    const markdown = source('packages/ui-next/src/components/markdown-renderer.tsx');
    expect(markdown).to.include("Accept: 'application/json'");
    expect(markdown).to.include("replaceInsertedText(placeholder, '图片上传失败')");
    expect(markdown).not.to.include('图片上传失败，请稍后重试。');
  });

  it('routes every ui-next fetch through the no-response error boundary', () => {
    const presenter = resolve(workspace, 'packages/ui-next/src/lib/error-presenter.ts');
    const violations = sourceFiles('packages/ui-next/src')
      .filter((path) => path !== presenter && /\b(?:window\.)?fetch\s*\(/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(workspace.length + 1));

    expect(violations).to.deep.equal([]);
  });

  it('does not parse non-canonical contribution failures or expose third-party Uppy messages', () => {
    const contributionSources = ['packages/ui-next/src/pages/problems.tsx', 'packages/ui-next/src/pages/problem-edit.tsx'].map(source).join('\n');
    const uploader = source('packages/ui-next/src/components/uploader.tsx');

    expect(contributionSources).not.to.include('ContributionBatchFailure');
    expect(contributionSources).not.to.match(/\bbody\?*\.failed\b/);
    expect(uploader).to.include('HydroUploadResponseError');
    expect(uploader).not.to.match(/error\?\.message\s*\|\|\s*'上传失败'/);
    expect(uploader).not.to.match(/f\.error\s*\|\|\s*'上传失败'/);
  });

  it('routes OJ-side Vigil and ZIP HTTP failures through the shared presenter', () => {
    const vigilPage = source('packages/ui-next/src/pages/vigil/index.tsx');
    const vigilApi = source('packages/ui-next/src/lib/vigil-api.ts');
    const downloadZip = source('packages/ui-next/src/lib/download-zip.ts');

    expect(vigilPage).to.include("readHydroResponseError(response, '加载比赛列表失败')");
    expect(vigilPage).not.to.match(/throw new Error\(`HTTP \$\{response\.status\}`\)/);
    expect(vigilApi).to.include("readHydroResponseError(response, '录像删除预检失败')");
    expect(vigilApi).to.include("readHydroResponseError(response, '录像删除失败')");
    expect(vigilApi).not.to.include('recordingRequestError');
    expect(downloadZip).to.match(/readHydroResponseError\(res, `下载 \$\{target\.name\} 失败`\)/);
    expect(downloadZip).not.to.match(/HTTP \$\{res\.status\}/);
  });

  it('keeps save-success parsing separate from the shared error presenter', () => {
    const success = source('packages/ui-next/src/lib/problem-save-response.ts');
    const presenter = source('packages/ui-next/src/lib/error-presenter.ts');

    expect(success).not.to.include('formatHydroErrorResponse');
    expect(success).not.to.include('readHydroResponseError');
    expect(presenter).to.include('presentHydroErrorEnvelope');
    expect(presenter).not.to.match(/error\?\.message\s*\|\|\s*body\?\.message/);
  });

  it('keeps the generic SPA crash boundary outside this migration', () => {
    const resolver = source('packages/ui-next/src/pages/resolver.tsx');
    expect(resolver).not.to.include('presentHydroErrorPayload');
    expect(resolver).not.to.include('readHydroResponseError');
  });

  it('does not re-parse judge placeholders in the record page', () => {
    const records = source('packages/ui-next/src/pages/records.tsx');

    expect(records).not.to.include('replaceAll(');
    expect(records).not.to.match(/params\.join/);
    expect(records).not.to.include('/\\{\\d+\\}/');
  });
});
