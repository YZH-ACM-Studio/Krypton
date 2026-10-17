import type { ProblemKind, TeachTab } from '@hydrooj/common';
import { teachComposePath } from '@hydrooj/common';
import { PenLine } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toolbar } from '@/components/ui/page';
import type { TeachWorkbenchPayload } from '../model';
import { paperFromPayload, paperSummary } from '../paper';
import { PaperView } from '../paper-view';

interface TeachTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

export function ProblemsTab({ payload }: TeachTabProps) {
  const paper = paperFromPayload(payload.paper, payload.container);
  const [activeKind, setActiveKind] = useState<ProblemKind | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Toolbar
        end={<span className="text-sm text-fg-muted tabular">{paperSummary(paper)}</span>}
      >
        <Button variant="primary" asChild>
          <a href={teachComposePath(payload.container.type, payload.container.id)}>
            <PenLine />
            编辑题目
          </a>
        </Button>
      </Toolbar>
      <PaperView state={paper} activeKind={activeKind} onActiveKindChange={setActiveKind} />
    </div>
  );
}
