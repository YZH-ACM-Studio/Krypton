import { Plus, Upload } from 'lucide-react';
import { Button } from './ui/button';

export function ProblemCreationActions({ canCreateAny, canImport }: { canCreateAny: boolean; canImport: boolean }) {
  return (
    <>
      {canImport ? (
        <Button asChild variant="outline">
          <a href="/problem/import/hydro">
            <Upload className="size-4" />
            导入
          </a>
        </Button>
      ) : null}
      {canCreateAny ? (
        <Button asChild>
          <a href="/problem/create">
            <Plus className="size-4" />
            新建题目
          </a>
        </Button>
      ) : null}
    </>
  );
}
