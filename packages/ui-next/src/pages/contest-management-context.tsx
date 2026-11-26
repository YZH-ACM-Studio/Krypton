import { createContext, useContext, type ComponentProps, type PropsWithChildren } from 'react';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';

export type ContestTool = 'users' | 'unrank' | 'clarification' | 'files' | 'code' | 'teams' | 'balloon' | 'print';

export interface ContestManagementView {
  tool: ContestTool;
  endpoint: string;
  data: Record<string, unknown>;
  users: Record<string, GenericUserDoc>;
  submit: (form: HTMLFormElement, submitter?: HTMLElement | null) => Promise<void>;
}

export const ContestManagementContext = createContext<ContestManagementView | null>(null);

export function useContestManagement() {
  return useContext(ContestManagementContext);
}

/** The same management content receives its own response when mounted in the teaching workbench. */
export function useContestBootstrap() {
  const bootstrap = useBootstrap();
  const view = useContestManagement();
  return view ? { ...bootstrap, udict: view.users, page: { ...bootstrap.page, data: view.data } } : bootstrap;
}

export function ContestPage({ width, children }: PropsWithChildren<{ width: ComponentProps<typeof Page>['width'] }>) {
  const view = useContestManagement();
  return view ? <div className="min-w-0 space-y-4">{children}</div> : <Page width={width}>{children}</Page>;
}

export function ContestPageHeader(props: ComponentProps<typeof PageHeader>) {
  const view = useContestManagement();
  if (!view) return <PageHeader {...props} />;
  if (!props.description && !props.meta && !props.actions) return null;
  return <Toolbar end={props.actions}>
    <div className="min-w-0 space-y-1 text-sm text-fg-muted">{props.description}{props.meta}</div>
  </Toolbar>;
}
