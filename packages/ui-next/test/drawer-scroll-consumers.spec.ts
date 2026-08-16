import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = resolve(import.meta.dirname, '..');

function source(relativePath: string): string {
  return readFileSync(resolve(pkg, relativePath), 'utf8');
}

const SHEET_CONSUMERS = [
  'src/pages/problems.tsx',
  'src/pages/course/detail.tsx',
  'src/pages/course/editor.tsx',
  'src/pages/vigil/student-detail-sheet.tsx',
  'src/components/team-code-snapshots.tsx',
  'src/pages/admin-tasks/index.tsx',
] as const;

const SHEET_IMPORT = /import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*'@\/components\/ui\/sheet'/;

function sheetContentOpenTags(text: string): string[] {
  return text.match(/<SheetContent\b[^>]*>/g) ?? [];
}

describe('unified drawer and scroll consumers', () => {
  it('keeps every previous sheet title and routes bodies through SheetBody or ScrollArea', () => {
    const problems = source('src/pages/problems.tsx');
    const courseDetail = source('src/pages/course/detail.tsx');
    const courseEditor = source('src/pages/course/editor.tsx');
    const vigil = source('src/pages/vigil/student-detail-sheet.tsx');
    const snapshots = source('src/components/team-code-snapshots.tsx');
    const adminTasks = source('src/pages/admin-tasks/index.tsx');
    const shipped = {
      'src/pages/problems.tsx': problems,
      'src/pages/course/detail.tsx': courseDetail,
      'src/pages/course/editor.tsx': courseEditor,
      'src/pages/vigil/student-detail-sheet.tsx': vigil,
      'src/components/team-code-snapshots.tsx': snapshots,
      'src/pages/admin-tasks/index.tsx': adminTasks,
    };

    for (const path of SHEET_CONSUMERS) {
      const text = shipped[path];
      expect(text, path).to.match(SHEET_IMPORT);
      const tags = sheetContentOpenTags(text);
      expect(tags.length, `${path} should render SheetContent`).to.be.greaterThan(0);
      for (const tag of tags) {
        expect(tag, `${path} SheetContent must not own overflow-y-auto`).not.to.include('overflow-y-auto');
      }
      expect(
        text.includes('<SheetBody') || text.includes('<ScrollArea'),
        `${path} should scroll through SheetBody or ScrollArea`,
      ).to.equal(true);
    }

    expect(problems).to.include('筛选题库');
    expect(problems).to.include('<FilterForm');
    expect(problems).to.include('<SheetBody');

    expect(courseDetail).to.include('课程目录');
    expect(courseDetail).to.include('<ChapterOutline');
    expect(courseDetail).to.include('<SheetBody');

    expect(courseEditor).to.include('章节目录');
    expect(courseEditor).to.include('添加');
    expect(courseEditor).to.include('onMove={moveChapter}');
    expect(courseEditor).to.include('onRemove={removeChapter}');
    expect(courseEditor).to.include('<SheetBody');

    expect(vigil).to.include('实时截屏');
    expect(vigil).to.include('查看实时画面');
    expect(vigil).to.include('发消息');
    expect(vigil).to.include('导出日志');
    expect(vigil).to.include('录屏回放');
    expect(vigil).to.include('打包下载录像');
    expect(vigil).to.include('行为日志');
    expect(vigil).to.include('<SheetBody');

    expect(snapshots).to.include('队伍代码快照');
    expect(snapshots).to.include('<ScrollArea');

    expect(adminTasks).to.include('<SheetBody');
    expect(adminTasks).to.include('录取此人');
    expect(adminTasks).to.include('确认录取并生效');
  });

  it('preserves DialogBody and TeamDialogBody native overflow contracts', () => {
    const dialog = source('src/components/ui/dialog.tsx');
    const team = source('src/components/team-dialog.tsx');
    expect(dialog).to.include('export function DialogBody');
    expect(dialog).to.include('min-h-0 flex-1 overflow-y-auto overscroll-contain');
    expect(team).to.include('export function TeamDialogBody');
    expect(team).to.include('overflow-y-auto overscroll-contain');
    expect(team).to.include('role="dialog"');
    expect(team).to.include('aria-modal="true"');
  });

  it('keeps both-axis scroll on wide native tables and lets Table own horizontal overflow', () => {
    const problemDetail = source('src/pages/problem-detail.tsx');
    const training = source('src/pages/training.tsx');
    const records = source('src/pages/records.tsx');
    const realpass = source('src/pages/realpass-manage.tsx');

    expect(problemDetail).to.include('min-w-[620px]');
    expect(problemDetail).to.match(/<ScrollArea className="min-h-0 flex-1" orientation="both">/);
    expect(training).to.include('参加名单');
    expect(training).to.match(/<ScrollArea className="max-h-\[28rem\]" orientation="both">/);
    expect(records).to.match(/<ScrollArea className="max-h-\[min\(65vh,680px\)\]" viewportLayout="block">/);
    expect(records).to.include('<Table density="compact">');
    expect(realpass).to.match(/<ScrollArea className="max-h-80" viewportLayout="block">/);
    expect(realpass).to.include('<Table>');
  });

  it('exports a shared SheetBody scroll owner from the existing Sheet primitive', () => {
    const sheet = source('src/components/ui/sheet.tsx');
    expect(sheet).to.include('export function SheetBody');
    expect(sheet).to.include('role="dialog"');
    expect(sheet).to.include('aria-modal="true"');
    expect(sheet).to.include('aria-label="关闭"');
    expect(sheet).to.include('data-scroll-owner="sheet"');
    expect(sheet).not.to.include('overflow-y-auto');
  });
});
