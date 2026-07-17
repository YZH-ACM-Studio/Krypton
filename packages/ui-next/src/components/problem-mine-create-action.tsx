import { Plus } from 'lucide-react';
import { Button } from './ui/button';

export function ProblemMineCreateAction({ allowed }: { allowed: boolean }) {
  if (!allowed) return null;
  return (
    <Button asChild size="sm" className="ml-auto gap-1">
      <a href="/problem/create">
        <Plus className="size-3.5" />
        新建题目
      </a>
    </Button>
  );
}
