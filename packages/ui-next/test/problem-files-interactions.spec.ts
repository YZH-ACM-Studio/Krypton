import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function read(relativePath: string) {
  return readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
}

describe('problem files interactions', () => {
  it('downloads selected files through the JSON link API without navigating the page', () => {
    const page = read('packages/ui-next/src/pages/problem-manage.tsx');
    const downloads = read('packages/ui-next/src/lib/problem-package.ts');

    expect(page).not.to.include('name="operation" value="get_links"');
    expect(page).to.include("import { downloadProblemFiles } from '@/lib/problem-package'");
    expect(page).to.include('await downloadProblemFiles({');
    expect(downloads).to.include("Accept: 'application/json'");
    expect(downloads).to.include('await downloadZip(filename, targets)');
  });

  it('uses the judge-config file dialog for every testdata row, including its large-file download path', () => {
    const dialogPath = 'packages/ui-next/src/components/problem-testdata-file-dialog.tsx';
    expect(existsSync(resolve(workspaceRoot, dialogPath))).to.equal(true);

    const dialog = read(dialogPath);
    const config = read('packages/ui-next/src/pages/problem-config-editor.tsx');
    const files = read('packages/ui-next/src/pages/problem-manage.tsx');

    expect(config).to.include("import { ProblemTestdataFileDialog } from '@/components/problem-testdata-file-dialog'");
    expect(files).to.include("import { ProblemTestdataFileDialog } from '@/components/problem-testdata-file-dialog'");
    expect(config).to.include('<ProblemTestdataFileDialog');
    expect(files).to.include('<ProblemTestdataFileDialog');
    expect(dialog).to.include('const MAX_FILE_PREVIEW_BYTES = 1 * 1024 * 1024');
    expect(dialog).to.include('文件过大');
    expect(dialog).to.include('previewUrl');
    expect(dialog).to.include('downloadUrl');
    expect(dialog).to.include('下载文件');
  });
});
