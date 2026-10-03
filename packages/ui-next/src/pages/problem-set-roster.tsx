/**
 * Problem-set roster page — template problem_set_roster.html.
 */

import { PracticeRosterCard, type PracticeRosterMember, type PracticeRosterProblem } from '@/components/practice-roster';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
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
    <Page width="wide" className="w-full min-w-0">
      <PageHeader
        breadcrumb={(
          <Breadcrumb
            items={[
              { label: tdoc.title || '题集', href: trainingUrl },
              { label: '参加名单' },
            ]}
          />
        )}
        title="参加名单"
        description={tdoc.title}
      />
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
        <EmptyState compact title="没有名单权限" />
      )}
    </Page>
  );
}
