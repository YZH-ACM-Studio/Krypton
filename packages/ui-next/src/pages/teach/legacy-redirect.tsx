import { teachPath, teachTypeOfContestRule } from '@hydrooj/common';
import { useEffect } from 'react';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Page } from '@/components/ui/page';
import { useBootstrap } from '@/lib/bootstrap';

const OPENING = '正在打开新的编辑页…';
const OPEN_FAILED = '无法打开新的编辑页';

const TEMPLATE_BY_PAGE = {
  contest_create: 'contest_edit.html',
  contest_edit: 'contest_edit.html',
  homework_create: 'homework_edit.html',
  homework_edit: 'homework_edit.html',
  problem_set_create: 'problem_set_edit.html',
  problem_set_edit: 'problem_set_edit.html',
} as const;

type LegacyPageName = keyof typeof TEMPLATE_BY_PAGE;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacyPageName(value: string): value is LegacyPageName {
  return Object.hasOwn(TEMPLATE_BY_PAGE, value);
}

function docIdOf(tdoc: Record<string, unknown>): string | null {
  const id = tdoc.docId;
  if (typeof id !== 'string' || id.length === 0) return null;
  return id;
}

function keptQuery(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  const next = new URLSearchParams();
  next.set('type', 'homework');
  const fromCourse = params.get('fromCourse');
  const chapter = params.get('chapter');
  if (fromCourse !== null) next.set('fromCourse', fromCourse);
  if (chapter !== null) next.set('chapter', chapter);
  return next;
}

function redirectTarget(templateName: string, data: unknown, search: string): string | null {
  if (!isRecord(data)) return null;
  const pageName = data.page_name;
  if (typeof pageName !== 'string' || !isLegacyPageName(pageName)) return null;
  if (TEMPLATE_BY_PAGE[pageName] !== templateName) return null;
  if (pageName === 'contest_create') {
    const rule = new URLSearchParams(search).get('rule');
    return `/teach/new?type=${rule === 'exam' ? 'exam' : 'acm'}`;
  }
  if (pageName === 'homework_create') return `/teach/new?${keptQuery(search).toString()}`;
  if (pageName === 'problem_set_create') return '/teach/new?type=practice';
  if (!isRecord(data.tdoc)) return null;
  const id = docIdOf(data.tdoc);
  if (id === null) return null;
  if (pageName === 'homework_edit') return teachPath('homework', id, 'settings');
  if (pageName === 'problem_set_edit') return teachPath('practice', id, 'settings');
  try {
    return teachPath(teachTypeOfContestRule(data.tdoc.rule), id, 'settings');
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function LegacyEditRedirectPage() {
  const bootstrap = useBootstrap();
  const templateName = bootstrap.page.templateName;
  const data = bootstrap.page.data;
  const target = redirectTarget(templateName, data, window.location.search);
  const pageName = isRecord(data) && typeof data.page_name === 'string' ? data.page_name : null;

  useEffect(() => {
    if (target !== null) {
      window.location.replace(target);
      return;
    }
    console.error('teach legacy edit redirect missing target', { templateName, pageName });
  }, [target, templateName, pageName]);

  return (
    <Page width="form">
      {target === null ? (
        <Alert tone="danger" title={OPEN_FAILED}>
          <a
            href="/teach"
            className="font-medium text-fg underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            返回题目集
          </a>
        </Alert>
      ) : (
        <EmptyState icon={<Spinner />} title={OPENING} />
      )}
    </Page>
  );
}
