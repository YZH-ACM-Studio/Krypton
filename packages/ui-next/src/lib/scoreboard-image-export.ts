export type ScoreboardSnapshotMode = 'frozen' | 'realtime';

export interface ScoreboardImageColumn {
  type: string;
  label: string;
}

export interface ScoreboardImageCell {
  text: string;
  color?: string;
  firstBlood?: boolean;
}

export interface ScoreboardImageRow {
  cells: ScoreboardImageCell[];
}

export interface ScoreboardImageModel {
  title: string;
  generatedAt: string;
  snapshotMode: ScoreboardSnapshotMode;
  columns: ScoreboardImageColumn[];
  rows: ScoreboardImageRow[];
}

interface BuildScoreboardImageModelInput extends ScoreboardImageModel {
  canIncludePrivateIdentity: boolean;
  includePrivateIdentity: boolean;
}

const PRIVATE_COLUMN_TYPES = new Set(['studentId', 'realName']);
const MAX_CANVAS_DIMENSION = 32_767;
const MAX_CANVAS_PIXELS = 120_000_000;
const MIN_EXPORT_SCALE = 0.5;

export function canShowScoreboardImageExport(canExport: boolean, inExamMode: boolean): boolean {
  return canExport && !inExamMode;
}

export function scoreboardExportPlainText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value)
    .replace(/<span class="icon icon-check"><\/span>/g, '✓')
    .replace(/<span style="color:orange">([^<]*)<\/span>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function buildScoreboardImageModel(input: BuildScoreboardImageModelInput): ScoreboardImageModel {
  const includePrivateIdentity = input.canIncludePrivateIdentity && input.includePrivateIdentity;
  const includedColumnIndexes = input.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => includePrivateIdentity || !PRIVATE_COLUMN_TYPES.has(column.type));
  if (includedColumnIndexes.length === 0) throw new Error('排行榜没有可导出的列');

  return {
    title: input.title,
    generatedAt: input.generatedAt,
    snapshotMode: input.snapshotMode,
    columns: includedColumnIndexes.map(({ column }) => column),
    rows: input.rows.map((row) => ({
      cells: includedColumnIndexes.map(({ index }) => row.cells[index] || { text: '—' }),
    })),
  };
}

export function scoreboardImageFilename(title: string, generatedAt = new Date()): string {
  const safeTitle =
    title
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'contest';
  const two = (value: number) => String(value).padStart(2, '0');
  const stamp = [
    generatedAt.getFullYear(),
    two(generatedAt.getMonth() + 1),
    two(generatedAt.getDate()),
    '-',
    two(generatedAt.getHours()),
    two(generatedAt.getMinutes()),
    two(generatedAt.getSeconds()),
  ].join('');
  return `${safeTitle}-排行榜-${stamp}.png`;
}

function columnMinimumWidth(type: string): number {
  if (type === 'rank') return 72;
  if (type === 'user' || type === 'team') return 240;
  if (type === 'studentId') return 136;
  if (type === 'realName') return 112;
  if (type === 'problem' || type === 'record' || type === 'records') return 88;
  return 112;
}

function columnMaximumWidth(type: string): number {
  if (type === 'user' || type === 'team') return 360;
  if (type === 'studentId') return 176;
  if (type === 'realName') return 160;
  if (type === 'problem' || type === 'record' || type === 'records') return 136;
  return 220;
}

function columnTextAlign(type: string): CanvasTextAlign {
  if (type === 'user' || type === 'team' || type === 'studentId' || type === 'realName') return 'left';
  if (type === 'time' || type === 'total_score' || type === 'solved') return 'right';
  return 'center';
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const sourceLines = (text || '—').split('\n');
  const result: string[] = [];
  for (const sourceLine of sourceLines) {
    if (!sourceLine) {
      result.push('');
      continue;
    }
    let line = '';
    for (const character of Array.from(sourceLine)) {
      const candidate = `${line}${character}`;
      if (line && context.measureText(candidate).width > maxWidth) {
        result.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    result.push(line || '—');
  }
  return result;
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建排行榜图片');
  return context;
}

export async function renderScoreboardImage(model: ScoreboardImageModel): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('排行榜图片只能在浏览器中生成');
  if (model.columns.length === 0) throw new Error('排行榜没有可导出的列');

  const measuringCanvas = document.createElement('canvas');
  const measuringContext = canvasContext(measuringCanvas);
  measuringContext.font = '500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  const columnWidths = model.columns.map((column, columnIndex) => {
    let contentWidth = measuringContext.measureText(column.label).width;
    for (const row of model.rows) {
      const cell = row.cells[columnIndex];
      for (const line of (cell?.text || '—').split('\n')) {
        contentWidth = Math.max(contentWidth, measuringContext.measureText(line).width);
      }
    }
    return Math.min(columnMaximumWidth(column.type), Math.max(columnMinimumWidth(column.type), Math.ceil(contentWidth + 28)));
  });

  const lineHeight = 19;
  const rowLayouts = model.rows.map((row) => {
    const lines = model.columns.map((_, columnIndex) =>
      wrapCanvasText(measuringContext, row.cells[columnIndex]?.text || '—', columnWidths[columnIndex] - 24),
    );
    const height = Math.max(46, Math.max(...lines.map((cellLines) => cellLines.length)) * lineHeight + 20);
    return { lines, height };
  });

  const margin = 40;
  const titleAreaHeight = 116;
  const headerHeight = 48;
  measuringContext.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const titleWidth = Math.ceil(measuringContext.measureText(model.title || '比赛排行榜').width);
  const logicalWidth = Math.max(margin * 2 + columnWidths.reduce((sum, width) => sum + width, 0), margin * 2 + titleWidth);
  const logicalHeight = margin + titleAreaHeight + headerHeight + rowLayouts.reduce((sum, row) => sum + row.height, 0) + margin;
  const exportScale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / logicalWidth,
    MAX_CANVAS_DIMENSION / logicalHeight,
    Math.sqrt(MAX_CANVAS_PIXELS / (logicalWidth * logicalHeight)),
  );
  if (!Number.isFinite(exportScale) || exportScale < MIN_EXPORT_SCALE) {
    throw new Error('排行榜内容过大，当前浏览器无法生成不丢失内容的单张图片');
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(logicalWidth * exportScale));
  canvas.height = Math.max(1, Math.floor(logicalHeight * exportScale));
  const context = canvasContext(canvas);
  context.scale(exportScale, exportScale);
  context.fillStyle = '#f8fafc';
  context.fillRect(0, 0, logicalWidth, logicalHeight);

  context.fillStyle = '#0f172a';
  context.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText(model.title || '比赛排行榜', margin, margin);
  context.font = '500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillStyle = '#475569';
  context.fillText(`生成时间：${model.generatedAt}`, margin, margin + 45);
  context.fillStyle = model.snapshotMode === 'frozen' ? '#b45309' : '#047857';
  context.fillText(model.snapshotMode === 'frozen' ? '封榜快照 · 未包含封榜后的真实结果' : '实时排行榜', margin, margin + 70);
  context.fillStyle = '#64748b';
  context.textAlign = 'right';
  context.fillText(`共 ${model.rows.length} 行`, logicalWidth - margin, margin + 70);

  let tableY = margin + titleAreaHeight;
  let tableX = margin;
  context.textBaseline = 'middle';
  model.columns.forEach((column, columnIndex) => {
    const width = columnWidths[columnIndex];
    context.fillStyle = '#172033';
    context.fillRect(tableX, tableY, width, headerHeight);
    context.strokeStyle = '#334155';
    context.strokeRect(tableX, tableY, width, headerHeight);
    context.fillStyle = '#f8fafc';
    context.font = '700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.textAlign = columnTextAlign(column.type);
    const textX = context.textAlign === 'left' ? tableX + 12 : context.textAlign === 'right' ? tableX + width - 12 : tableX + width / 2;
    context.fillText(column.label, textX, tableY + headerHeight / 2, width - 24);
    tableX += width;
  });
  tableY += headerHeight;

  rowLayouts.forEach((layout, rowIndex) => {
    tableX = margin;
    model.columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];
      const cell = model.rows[rowIndex].cells[columnIndex] || { text: '—' };
      context.fillStyle = cell.firstBlood ? '#dcfce7' : rowIndex % 2 === 0 ? '#ffffff' : '#f1f5f9';
      context.fillRect(tableX, tableY, width, layout.height);
      context.strokeStyle = '#cbd5e1';
      context.strokeRect(tableX, tableY, width, layout.height);

      const align = columnTextAlign(column.type);
      context.textAlign = align;
      context.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      context.fillStyle = cell.color || '#0f172a';
      const textX = align === 'left' ? tableX + 12 : align === 'right' ? tableX + width - 12 : tableX + width / 2;
      const lines = layout.lines[columnIndex];
      const textTop = tableY + (layout.height - lines.length * lineHeight) / 2 + lineHeight / 2;
      lines.forEach((line, lineIndex) => {
        context.fillText(line || ' ', textX, textTop + lineIndex * lineHeight, width - 24);
      });
      tableX += width;
    });
    tableY += layout.height;
  });

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('浏览器未能生成排行榜 PNG'));
    }, 'image/png');
  });
}
