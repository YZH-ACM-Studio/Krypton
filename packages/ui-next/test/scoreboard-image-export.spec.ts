// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildScoreboardImageModel,
  canShowScoreboardImageExport,
  renderScoreboardImage,
  scoreboardExportPlainText,
  scoreboardImageFilename,
  type ScoreboardImageColumn,
  type ScoreboardImageRow,
} from '../src/lib/scoreboard-image-export.ts';

interface FakeCanvasContext {
  fillTextCalls: string[];
}

interface FakeCanvas {
  width: number;
  height: number;
  context: FakeCanvasContext;
}

const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
  else Reflect.deleteProperty(globalThis, 'document');
});

function installFakeCanvas(blobResult: Blob | null = new Blob(['png'], { type: 'image/png' })): FakeCanvas[] {
  const canvases: FakeCanvas[] = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      createElement(tagName: string) {
        if (tagName !== 'canvas') throw new Error(`Unexpected element: ${tagName}`);
        const context = {
          fillTextCalls: [] as string[],
          font: '',
          fillStyle: '',
          strokeStyle: '',
          textAlign: 'left' as CanvasTextAlign,
          textBaseline: 'alphabetic' as CanvasTextBaseline,
          measureText(text: string) {
            return { width: Array.from(text).length * 10 } as TextMetrics;
          },
          scale() {},
          fillRect() {},
          strokeRect() {},
          fillText(text: string) {
            this.fillTextCalls.push(text);
          },
        };
        const canvas = {
          width: 0,
          height: 0,
          context,
          getContext(kind: string) {
            return kind === '2d' ? context : null;
          },
          toBlob(callback: BlobCallback) {
            callback(blobResult);
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    } as unknown as Document,
  });
  return canvases;
}

const columns: ScoreboardImageColumn[] = [
  { type: 'rank', label: '排名' },
  { type: 'user', label: '用户' },
  { type: 'studentId', label: '学号' },
  { type: 'realName', label: '姓名' },
  { type: 'problem', label: 'A' },
];

const rowFor = (index: number): ScoreboardImageRow => ({
  cells: [
    { text: String(index + 1) },
    { text: `用户 ${index + 1}` },
    { text: `2026${String(index).padStart(4, '0')}` },
    { text: `姓名 ${index + 1}` },
    { text: index % 2 ? '-2' : '+', firstBlood: index === 0 },
  ],
});

describe('scoreboard image export capability', () => {
  it('is available only to authorized viewers outside Exam Mode', () => {
    expect(canShowScoreboardImageExport(true, false)).to.equal(true);
    expect(canShowScoreboardImageExport(false, false)).to.equal(false);
    expect(canShowScoreboardImageExport(true, true)).to.equal(false);
  });
});

describe('buildScoreboardImageModel', () => {
  it('excludes private identity columns by default without dropping rows or public columns', () => {
    const rows = Array.from({ length: 500 }, (_, index) => rowFor(index));
    const model = buildScoreboardImageModel({
      title: '长排行榜',
      generatedAt: '2026-07-27 17:00:00',
      snapshotMode: 'frozen',
      columns,
      rows,
      canIncludePrivateIdentity: true,
      includePrivateIdentity: false,
    });

    expect(model.columns.map((column) => column.type)).to.deep.equal(['rank', 'user', 'problem']);
    expect(model.rows).to.have.length(500);
    expect(model.rows[0].cells.map((cell) => cell.text)).to.deep.equal(['1', '用户 1', '+']);
    expect(model.rows[499].cells).to.have.length(3);
    expect(model.snapshotMode).to.equal('frozen');
  });

  it('includes private identity only when both server capability and explicit choice are present', () => {
    const base = {
      title: '排行榜',
      generatedAt: '2026-07-27 17:00:00',
      snapshotMode: 'realtime' as const,
      columns,
      rows: [rowFor(0)],
      includePrivateIdentity: true,
    };

    const denied = buildScoreboardImageModel({ ...base, canIncludePrivateIdentity: false });
    expect(denied.columns.some((column) => column.type === 'studentId')).to.equal(false);

    const allowed = buildScoreboardImageModel({ ...base, canIncludePrivateIdentity: true });
    expect(allowed.columns.map((column) => column.type)).to.deep.equal(['rank', 'user', 'studentId', 'realName', 'problem']);
    expect(allowed.rows[0].cells).to.have.length(5);
  });

  it('pads malformed short rows instead of shifting later columns', () => {
    const model = buildScoreboardImageModel({
      title: '排行榜',
      generatedAt: '2026-07-27 17:00:00',
      snapshotMode: 'realtime',
      columns,
      rows: [{ cells: [{ text: '1' }] }],
      canIncludePrivateIdentity: false,
      includePrivateIdentity: false,
    });
    expect(model.rows[0].cells.map((cell) => cell.text)).to.deep.equal(['1', '—', '—']);
  });
});

describe('scoreboard image export text and filename', () => {
  it('converts known scoreboard markup into readable plain text', () => {
    expect(scoreboardExportPlainText('<span class="icon icon-check"></span>\n<span style="color:orange">-2</span>')).to.equal('✓\n-2');
    expect(scoreboardExportPlainText('A<br>B &amp; C')).to.equal('A\nB & C');
    expect(scoreboardExportPlainText(undefined)).to.equal('—');
  });

  it('sanitizes filesystem separators and appends a PNG suffix', () => {
    const filename = scoreboardImageFilename('暑期赛 / A:B?*', new Date(2026, 6, 27, 17, 8, 9));
    expect(filename).to.equal('暑期赛 - A-B---排行榜-20260727-170809.png');
    expect(filename).not.to.match(/[\\/:*?"<>|]/);
  });
});

describe('renderScoreboardImage', () => {
  it('sizes the canvas for the complete title and draws the final row of a 500-row, multi-problem board', async () => {
    const canvases = installFakeCanvas();
    const title = '一场标题很长并且不能被画布裁切的比赛'.repeat(4);
    const problemColumns = Array.from({ length: 16 }, (unusedColumn, index) => ({
      type: 'problem',
      label: String.fromCharCode(65 + index),
    }));
    const rows = Array.from({ length: 500 }, (unusedRow, rowIndex) => ({
      cells: [
        { text: String(rowIndex + 1) },
        { text: rowIndex === 499 ? 'row-500' : `row-${rowIndex + 1}` },
        ...problemColumns.map((unusedProblem, problemIndex) => ({ text: `${rowIndex}-${problemIndex}` })),
      ],
    }));

    await renderScoreboardImage({
      title,
      generatedAt: '2026-07-27 17:00:00',
      snapshotMode: 'realtime',
      columns: [{ type: 'rank', label: '排名' }, { type: 'user', label: '用户' }, ...problemColumns],
      rows,
    });

    expect(canvases).to.have.length(2);
    const rendered = canvases[1];
    expect(rendered.width).to.be.greaterThan(1_000);
    expect(rendered.context.fillTextCalls).to.include(title);
    expect(rendered.context.fillTextCalls).to.include('row-500');
  });

  it('surfaces a browser toBlob failure instead of pretending the export succeeded', async () => {
    installFakeCanvas(null);
    await expect(
      renderScoreboardImage({
        title: '排行榜',
        generatedAt: '2026-07-27 17:00:00',
        snapshotMode: 'frozen',
        columns: [{ type: 'rank', label: '排名' }],
        rows: [{ cells: [{ text: '1' }] }],
      }),
    ).rejects.toThrow('浏览器未能生成排行榜 PNG');
  });
});
