import type { ProblemKind, TeachTab, TeachType } from '@hydrooj/common';
import { parseTeachType, teachComposePath } from '@hydrooj/common';
import { FileDown, PenLine } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import type { MenuItem } from '@/components/ui/menu';
import { Toolbar } from '@/components/ui/page';
import { buildDocx } from '@/lib/docx';
import { downloadBlob } from '@/lib/download-zip';
import type { TeachWorkbenchPayload } from '../model';
import { paperFromPayload, paperSummary } from '../paper';
import { paperDocxBlocks, parseTeachPaperExport } from '../paper-export-model';
import { PaperView } from '../paper-view';
import { getJson } from '../api';

interface TeachTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

const EXPORT_FAILED = '导出试卷失败。';

function exportFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return EXPORT_FAILED;
}

function paperExportPath(type: TeachType, id: string, answers: boolean): string {
  const path = `/teach/${parseTeachType(type)}/${id}/paper`;
  if (!answers) return path;
  return `${path}?answers=1`;
}

export function ProblemsTab({ payload }: TeachTabProps) {
  const paper = paperFromPayload(payload.paper, payload.container);
  const [activeKind, setActiveKind] = useState<ProblemKind | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportingRef = useRef(false);
  const { type, id } = payload.container;

  const openPrint = (answers: boolean) => {
    window.open(paperExportPath(type, id, answers), '_blank');
  };

  const exportWord = (answers: boolean) => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(null);
    void (async () => {
      try {
        const raw = await getJson(paperExportPath(type, id, answers), EXPORT_FAILED);
        const exported = parseTeachPaperExport(raw);
        const blocks = await paperDocxBlocks(exported, new Map());
        const blob = await buildDocx(blocks);
        const suffix = answers ? '答案卷' : '空白卷';
        downloadBlob(`${exported.title}-${suffix}.docx`, blob);
      } catch (error: unknown) {
        console.error('teach paper export failed', { type, id, error });
        setExportError(exportFailure(error));
      } finally {
        exportingRef.current = false;
        setExporting(false);
      }
    })();
  };

  const menuItems: MenuItem[] = [
    { label: 'Word 空白卷', onSelect: () => { exportWord(false); } },
    { label: 'Word 答案卷', onSelect: () => { exportWord(true); } },
    { label: '打印空白卷', onSelect: () => { openPrint(false); } },
    { label: '打印答案卷', onSelect: () => { openPrint(true); } },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {exportError !== null ? <Alert tone="danger">{exportError}</Alert> : null}
      <Toolbar
        end={<span className="text-sm text-fg-muted tabular">{paperSummary(paper)}</span>}
      >
        <Button variant="primary" asChild>
          <a href={teachComposePath(type, id)}>
            <PenLine />
            编辑题目
          </a>
        </Button>
        <Menu
          label="导出试卷"
          trigger={(props) => (
            <Button variant="secondary" type="button" loading={exporting} {...props}>
              <FileDown />
              导出试卷
            </Button>
          )}
          items={menuItems}
        />
      </Toolbar>
      <PaperView state={paper} activeKind={activeKind} onActiveKindChange={setActiveKind} />
    </div>
  );
}
