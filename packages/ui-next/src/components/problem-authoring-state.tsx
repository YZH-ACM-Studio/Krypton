import type { ReactNode } from 'react';

export interface ProblemAuthorView {
  _id?: number;
  uname?: string;
}

export function ProblemAuthorText({ authors }: { authors: ProblemAuthorView[] }) {
  const label = authors.length ? authors.map((author) => author.uname || `UID ${author._id || '?'}`).join('、') : '未设置';
  return <>{label}</>;
}

export function ProblemEditGate({
  canEditProblem,
  inContest,
  children,
}: {
  canEditProblem: boolean;
  inContest: boolean;
  children: ReactNode;
}) {
  return canEditProblem && !inContest ? children : null;
}

export interface ManagedTrainingOptionView {
  id: string;
  title: string;
  templates: string[];
  chapters: Array<{ id: number; title: string }>;
}

export interface ManagedTrainingPlacementView {
  trainingId: string;
  trainingTitle: string;
  chapterId: number;
  chapterTitle: string;
}

export function ManagedProblemTrainingStatus({
  metadataStatus,
  pendingPlacement,
  trainingOptions,
  placements,
}: {
  metadataStatus?: string;
  pendingPlacement?: { trainingId?: unknown; chapterId?: unknown };
  trainingOptions: ManagedTrainingOptionView[];
  placements: ManagedTrainingPlacementView[];
}) {
  const draft = metadataStatus === 'draft';
  const pendingTraining = trainingOptions.find((training) => training.id === String(pendingPlacement?.trainingId || ''));
  const pendingChapter = pendingTraining?.chapters.find((chapter) => String(chapter.id) === String(pendingPlacement?.chapterId ?? ''));

  return (
    <div className="rounded-xl bg-muted/45 px-4 py-3">
      <p className="text-xs text-muted-foreground">{draft ? '待挂训练' : '所属训练'}</p>
      {draft ? (
        <p className="mt-1 text-sm font-medium">
          {pendingPlacement
            ? `${pendingTraining?.title || '训练已失效'} / ${pendingChapter?.title || `章节 ${String(pendingPlacement.chapterId ?? '已失效')}`}`
            : '未选择'}
        </p>
      ) : placements.length ? (
        <ul className="mt-1 space-y-1 text-sm font-medium">
          {placements.map((placement) => (
            <li key={`${placement.trainingId}:${placement.chapterId}`}>
              {placement.trainingTitle} / {placement.chapterTitle}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm font-medium">未加入训练</p>
      )}
    </div>
  );
}
