// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  countMatches,
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/admin-collect/index.tsx',
  'src/pages/announcement/index.tsx',
] as const;

const COLLECT = 'src/pages/admin-collect/index.tsx';
const ANNOUNCE = 'src/pages/announcement/index.tsx';
const MODULE_WORKSPACE = 'src/components/management/module-workspace.tsx';

const ADMIN_ANNOUNCE_PAGES = [
  'AdminAnnounceListPage',
  'AdminAnnounceEditorPage',
  'AdminAnnounceCategoriesPage',
] as const;

const SAVE_FORM_OPERATIONS = ['delete', 'archive', 'close', 'reopen'] as const;

// max-w-[16rem] 触发 DS004。16rem 的阶梯类是 max-w-64，上限宽度不变。
const FILE_COLUMN_CAP = ['max-w-64', 'min-w-0'] as const;
const FILE_NAME_CAP = ['max-w-64', 'min-w-0', 'break-all'] as const;

function classTokens(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function hasClassList(source: string, tokens: readonly string[]): boolean {
  return [...source.matchAll(/className="([^"]*)"/g)].some((match) => {
    const list = classTokens(match[1] ?? '');
    return tokens.every((token) => list.includes(token));
  });
}

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function formBlocks(source: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf('<form', from);
    if (start < 0) {
      break;
    }
    const end = source.indexOf('</form>', start);
    if (end < 0) {
      break;
    }
    blocks.push(source.slice(start, end));
    from = end + '</form>'.length;
  }
  return blocks;
}

function saveForm(source: string): string {
  return formBlocks(source).find((block) => block.includes('name="fileNameTemplate"')) ?? '';
}

function openTagAt(source: string, marker: string): string {
  const index = source.indexOf(marker);
  if (index < 0) {
    return '';
  }
  const start = source.lastIndexOf('<', index);
  const end = source.indexOf('>', index);
  if (start < 0 || end < 0) {
    return '';
  }
  return source.slice(start, end + 1);
}

function quotedClass(tag: string): string {
  return /className="([^"]*)"/.exec(tag)?.[1] ?? '';
}

function classHas(value: string, tokens: readonly string[]): boolean {
  const list = classTokens(value);
  return tokens.every((token) => list.includes(token));
}

function nearbyHasClass(source: string, needle: string, tokens: readonly string[], radius: number): boolean {
  const index = source.indexOf(needle);
  if (index < 0) {
    return false;
  }
  const before = source.slice(Math.max(0, index - radius), index);
  return [...before.matchAll(/className="([^"]*)"/g)].some((match) => classHas(match[1] ?? '', tokens));
}

function lastTableOpen(source: string, before: number): string {
  let found = '';
  for (const match of source.slice(0, before).matchAll(/<Table(?=[\s>])/g)) {
    const start = match.index ?? 0;
    const end = source.indexOf('>', start);
    if (end < 0) {
      continue;
    }
    found = source.slice(start, end + 1);
  }
  return found;
}

function adminAnnounceSource(source: string): string {
  const start = source.indexOf('export function AdminAnnounceListPage');
  return start < 0 ? '' : source.slice(start);
}

/** 只认控件自己的 className。contentClassName 里的 min-h-10 只抬高选项，不算触发器。 */
function ownClassName(tag: string): string {
  return /(?:^|\s)className="([^"]*)"/.exec(tag)?.[1] ?? '';
}

function hasOwnMinH10(tag: string): boolean {
  return /(?<![\w-])min-h-10(?![\w-])/.test(ownClassName(tag));
}

describe('m04 collection administration and announcements', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 admin-collect/index.tsx', () => {
    expectPageStructure(COLLECT, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('页面结构 announcement/index.tsx', () => {
    expectPageStructure(ANNOUNCE, {
      widths: ['wide', 'prose'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it.each(SAVE_FORM_OPERATIONS)('管理端保存表单不提交 value="%s"', (operation) => {
    const form = saveForm(readSource(COLLECT));
    expect(form.length).toBeGreaterThan(0);
    expect(form).not.toContain(`value="${operation}"`);
  });

  it('管理端文件名卡片标题带 text-sm', () => {
    // collect-pages.spec.ts 仍用 CardTitle 锚定「文件名」，标题不能改成 Panel title。
    expect(readSource(COLLECT)).toMatch(/<CardTitle\b[^>]+text-sm(?![\w-])[^>]*>\s*文件名\s*</);
  });

  it('管理端收集页页签在窄屏下横向滚动', () => {
    expect(hasClassList(readSource(COLLECT), ['max-w-full', 'overflow-x-auto'])).toBe(true);
  });

  it('管理端收集文件表不用 56rem 最小宽度撑开视口', () => {
    expect(readSource(COLLECT)).not.toMatch(/min-w-\[56rem\]/);
  });

  it('管理端收集页侧栏不用固定 w-80', () => {
    expect(readSource(COLLECT)).not.toMatch(/(?<![\w-])w-80(?![\w-])/);
  });

  it('管理端收集文件表可以收缩到容器宽度以内', () => {
    const src = readSource(COLLECT);
    const head = src.search(/<TableHead\b[^>]*>\s*文件\s*<\/TableHead>/);
    expect(head).toBeGreaterThanOrEqual(0);
    expect(lastTableOpen(src, head)).toMatch(/\bmin-w-0\b/);
  });

  it('管理端收集文件名列有上限并允许收缩', () => {
    const src = readSource(COLLECT);
    expect(src).not.toMatch(/max-w-\[16rem\]/);
    const head = /<TableHead\b[^>]*>\s*文件\s*<\/TableHead>/.exec(src)?.[0] ?? '';
    expect(classHas(quotedClass(head), FILE_COLUMN_CAP)).toBe(true);
  });

  it('管理端收集文件名在列宽内断行', () => {
    expect(hasClassList(readSource(COLLECT), FILE_NAME_CAP)).toBe(true);
  });

  it('管理端收集文件名辅助信息断行', () => {
    expect(nearbyHasClass(readSource(COLLECT), '原名', ['break-all'], 200)).toBe(true);
  });

  it('管理端收集行内操作在窄屏下换行', () => {
    expect(readSource(COLLECT)).toMatch(/<TableActions\b[^>]+flex-wrap(?![\w-])/);
  });

  it('管理端收集统计打包条钉在内容区顶部', () => {
    const tag = openTagAt(readSource(COLLECT), 'aria-label="打包"');
    expect(classHas(quotedClass(tag), ['sticky', 'top-0'])).toBe(true);
  });

  it('管理端收集统计打包条在窄屏下换行', () => {
    const tag = openTagAt(readSource(COLLECT), 'aria-label="打包"');
    expect(classHas(quotedClass(tag), ['max-w-full', 'flex-wrap'])).toBe(true);
  });

  it('删除局部 StatusBadge 并改用 Badge', () => {
    const src = readSource(COLLECT);
    expect(src).not.toMatch(/function StatusBadge\b/);
    expect(src).not.toMatch(/<StatusBadge\b/);
    const blocks = [...src.matchAll(/<Badge\b[^>]*>[\s\S]*?<\/Badge>/g)].map((match) => match[0] ?? '');
    for (const label of ['已发布', '草稿', '已关闭', '已归档']) {
      expect(blocks.some((block) => block.includes(label)), label).toBe(true);
    }
  });

  it('学生列表 AnnounceListPage 使用 Page width="wide" 与 PageHeader', () => {
    const body = functionBody(readSource(ANNOUNCE), 'AnnounceListPage');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/<Page\b[^>]+width="wide"/);
    expect(body).toMatch(/<PageHeader\b/);
    expect(body).toContain('公告');
    expect(body).not.toMatch(/<h1\b/);
    expect(body).not.toMatch(/<ModuleWorkspace\b/);
  });

  it('学生详情 AnnounceDetailPage 使用 Page width="prose" 与 PageHeader', () => {
    const body = functionBody(readSource(ANNOUNCE), 'AnnounceDetailPage');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/<Page\b[^>]+width="prose"/);
    expect(body).toMatch(/<PageHeader\b/);
    expect(body).toContain('data.doc.title');
    expect(body).not.toMatch(/<h1\b/);
    expect(body).not.toMatch(/<ModuleWorkspace\b/);
  });

  it('三个管理页保持 AdminPage', () => {
    // 既有契约要求恰好三个 ModuleWorkspace；ModuleWorkspace 内部渲染 AdminPage。
    expect(readSource(MODULE_WORKSPACE)).toMatch(/<AdminPage\b/);
    const src = readSource(ANNOUNCE);
    for (const name of ADMIN_ANNOUNCE_PAGES) {
      const body = functionBody(src, name);
      expect(body.length, name).toBeGreaterThan(0);
      expect(body, name).toMatch(/<ModuleWorkspace\b/);
      expect(body, name).not.toMatch(/<Page(?=[\s>])/);
      expect(body, name).not.toMatch(/<PageHeader\b/);
    }
  });

  it('公告管理的三个下拉选项至少 40px 高', () => {
    const admin = adminAnnounceSource(readSource(ANNOUNCE));
    expect(admin.length).toBeGreaterThan(0);
    expect(countMatches(admin, /contentClassName="\[&_\[role=option\]\]:min-h-10"/g)).toBe(3);
  });

  it('公告管理控件至少 40px 高', () => {
    const admin = adminAnnounceSource(readSource(ANNOUNCE));
    expect(admin.length).toBeGreaterThan(0);
    // 编辑 / 置顶 / 删除是 TableAction（默认约 28px），输入框和下拉触发器同样要到 40px。
    // 每类必须全部带上，不能各页只留一处 min-h-10。
    for (const tag of ['TableAction', 'Input', 'SimpleSelect'] as const) {
      const opens = findOpenTags(admin, tag);
      expect(opens.length, tag).toBeGreaterThan(1);
      for (const open of opens) {
        expect(hasOwnMinH10(open.text), open.text).toBe(true);
      }
    }
  });
});
