/**
 * Problem-set roster page — template problem_set_roster.html.
 */

import { ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { PracticeRosterCard, type PracticeRosterMember, type PracticeRosterProblem } from '@/components/practice-roster';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

interface ProblemSetRosterDocument {
  title?: string;
  docId?: string | number;
  _id?: string | number;
}

interface ProblemSetRosterPageData {
  tdoc?: ProblemSetRosterDocument;
  canViewRoster?: boolean;
  members?: PracticeRosterMember[];
  membersTruncated?: boolean;
  rosterProblems?: PracticeRosterProblem[];
  rosterGroupIds?: string[];
}

export function ProblemSetRosterPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ProblemSetRosterPageData;
  const tdoc = data.tdoc || {};
  const tid = tdoc.docId || tdoc._id;
  const trainingUrl = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tid) });

  return (
    <motion.div className="w-full min-w-0 space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={trainingUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">参加名单</h1>
          <p className="truncate text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      {data.canViewRoster === true ? (
        <PracticeRosterCard
          className="mt-0 w-full min-w-0"
          members={Array.isArray(data.members) ? data.members : []}
          problems={Array.isArray(data.rosterProblems) ? data.rosterProblems : []}
          title={tdoc.title || '题集'}
          truncated={!!data.membersTruncated}
          visibleGroupIds={Array.isArray(data.rosterGroupIds) ? data.rosterGroupIds : undefined}
        />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">没有名单权限</CardContent>
        </Card>
      )}
    </motion.div>
  );
}
