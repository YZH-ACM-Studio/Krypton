import { Plus, Upload } from 'lucide-react';
import { Button } from './ui/button';

export function ProblemCreationActions({ canCreateAny, canImport }: { canCreateAny: boolean; canImport: boolean }) {
  if (!canCreateAny && !canImport) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canImport ? (
        <Button asChild variant="outline" className="h-auto min-h-11">
          <a href="/problem/import/hydro">
            <Upload className="size-4" />
            导入
          </a>
        </Button>
      ) : null}
      {canCreateAny ? (
        <Button asChild className="h-auto min-h-11">
          <a href="/problem/create">
            <Plus className="size-4" />
            新建题目
          </a>
        </Button>
      ) : null}
    </div>
  );
}
