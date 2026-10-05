// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/problem-manage.tsx',
  'src/components/problem-testdata-file-dialog.tsx',
  'src/components/uploader.tsx',
  'src/components/problem-rejudge-dialog.tsx',
] as const;

const MANAGE = 'src/pages/problem-manage.tsx';
const TESTDATA_DIALOG = 'src/components/problem-testdata-file-dialog.tsx';
const UPLOADER = 'src/components/uploader.tsx';
const REJUDGE = 'src/components/problem-rejudge-dialog.tsx';

/** 拼出源码里的 ${...}，避免被 no-template-curly-in-string 当成模板表达式。 */
function expr(body: string): string {
  return ['$', '{', body, '}'].join('');
}

/** PLAN M13：删除自挂的 ToastProvider 后，成功提示仍是这一句。 */
const TOAST_SUCCESS = [
  'toast.success(rejudged ? `已提交 ',
  expr('rejudged'),
  " 条记录重新评测` : '没有符合整题重测条件的记录');",
].join('');

const DELETE_SUBMIT = [
  'guardedSubmit(event, `删除 ',
  expr('selected.size'),
  " 个文件`, 'files-delete')",
].join('');

const RENAME_SUBMIT = [
  'guardedSubmit(event, `重命名 ',
  expr('renameKeys.length'),
  " 个文件`, 'files-rename')",
].join('');

const UPLOAD_CONFIRM = [
  'await dataGuard.confirm(`上传',
  expr("type === 'testdata' ? '测试数据' : '附加文件'"),
  "`, 'files-upload')",
].join('');

const FILES_ENDPOINT_ATTR = ['endpoint={`', expr('problemUrl'), '/files`}'].join('');

const DOWNLOAD_URL = [
  '`',
  expr('problemUrl'),
  '/file/',
  expr('encodeURIComponent(filename)'),
  '?type=testdata`',
].join('');

const PREVIEW_URL = ['`', expr('downloadUrl'), '&noDisposition=1`'].join('');

const SAVE_ENDPOINT = ['`', expr('problemUrl'), '/files`'].join('');

function expectLines(file: string, lines: readonly string[]): void {
  const src = readSource(file);
  const missing = lines.filter((line) => !src.includes(line));
  expect(missing).toEqual([]);
}

describe('m13 problem files, solutions, statistics and uploads', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 problem-manage.tsx', () => {
    expectPageStructure(MANAGE, {
      widths: ['wide'],
      workspace: 'allowed',
      minPageHeaders: 3,
    });
  });

  it('重测对话框不挂 ToastProvider，toast.success 文案不变', () => {
    const src = readSource(REJUDGE);
    expect(src.includes('ToastProvider')).toBe(false);
    expect(src.includes(TOAST_SUCCESS)).toBe(true);
  });

  it('testdata 三层写入字段保持原样', () => {
    expectLines(MANAGE, [
      'name="operation" value="delete_files"',
      'name="operation" value="rename_files"',
      'name="operation" value="generate_testdata"',
      DELETE_SUBMIT,
      RENAME_SUBMIT,
      "guardedSubmit(event, '生成测试数据', 'generate-testdata-request')",
      UPLOAD_CONFIRM,
      "marker.name = 'activeContainerConfirmation';",
      'HTMLFormElement.prototype.submit.call(form);',
      FILES_ENDPOINT_ATTR,
      'fieldName="file"',
      'meta={{ type, ...(uploadConfirmationRequestId ? { activeContainerConfirmation: uploadConfirmationRequestId } : {}) }}',
      'uploadConcurrency={1}',
      'await downloadProblemFiles({ pdoc, problemUrl, files: Array.from(selected), type });',
    ]);
    expectLines(TESTDATA_DIALOG, [
      DOWNLOAD_URL,
      PREVIEW_URL,
      "form.append('operation', 'upload_file');",
      "form.append('type', 'testdata');",
      "form.append('filename', filename);",
      "form.append('activeContainerConfirmation', confirmation);",
      "form.append('file', new Blob([content], { type: 'text/plain' }), filename);",
      SAVE_ENDPOINT,
      "method: 'POST',",
      "credentials: 'same-origin',",
    ]);
    expectLines(UPLOADER, [
      "operation: 'upload_file',",
      'filename: f.name,',
      'uppy.setFileMeta(id, {',
      'allowedMetaFields: fileUploaderAllowedMetaFields(meta),',
    ]);
  });

  it('预览对话框在小于 sm 时编辑区高度不为 0', async () => {
    const source = readSource(TESTDATA_DIALOG);
    expect(source.includes('max-sm:')).toBe(false);
    const tokens = await renderedDialogContentTokens();
    expect(tokens).toContain('h-dvh');
    expect(tokens.some((token) => token.startsWith('max-sm:'))).toBe(false);
  });
});

/** 本文件必须保持 node，helpers 才能加载 design-gate。渲染只在这一条断言里临时挂 DOM。 */
async function renderedDialogContentTokens(): Promise<string[]> {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const { window } = dom;
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'MutationObserver', 'getComputedStyle'] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of globals) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  const define = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('HTMLElement', window.HTMLElement);
  define('Element', window.Element);
  define('Node', window.Node);
  define('DocumentFragment', window.DocumentFragment);
  define('MutationObserver', window.MutationObserver);
  define('getComputedStyle', window.getComputedStyle.bind(window));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true, writable: true });
  try {
    const react = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { ProblemTestdataFileDialog } = await import('../../../src/components/problem-testdata-file-dialog');
    const host = window.document.createElement('div');
    window.document.body.append(host);
    const root = createRoot(host);
    await react.act(async () => {
      root.render(react.createElement(ProblemTestdataFileDialog, {
        file: { name: 'huge.in', size: 1024 * 1024 + 1 },
        problemUrl: '/p/P1000',
        onClose: () => undefined,
      }));
    });
    const dialog = window.document.querySelector('[role="dialog"]');
    if (!dialog) {
      throw new Error('预览 DialogContent 没有渲染');
    }
    const tokens = (dialog.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
    await react.act(async () => {
      root.unmount();
    });
    return tokens;
  } finally {
    dom.window.close();
    for (const key of globals) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  }
}
