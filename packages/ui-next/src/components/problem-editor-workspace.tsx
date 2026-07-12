import {
  FileArchive, FileText, FolderInput, Settings2, ShieldCheck, SlidersHorizontal,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

export type ProblemEditorWorkspacePage = 'edit' | 'config' | 'files';

interface WorkspaceItem {
  key: string;
  label: string;
  description: string;
  href: string;
  icon: typeof FileText;
  disabled?: boolean;
}

export function ProblemEditorWorkspace({
  page,
  problemUrl,
  title,
  pid,
  isCreate = false,
  status,
  actions,
  children,
}: {
  page: ProblemEditorWorkspacePage;
  problemUrl: string;
  title: string;
  pid: string;
  isCreate?: boolean;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [hash, setHash] = useState(() => typeof window === 'undefined' ? '' : window.location.hash.slice(1));

  useEffect(() => {
    const update = () => setHash(window.location.hash.slice(1));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  const items = useMemo<WorkspaceItem[]>(() => {
    const editUrl = isCreate
      ? typeof window === 'undefined' ? '/problem/create' : window.location.pathname
      : `${problemUrl}/edit`;
    return [
      { key: 'basic', label: '基本信息', description: '标题、题号、标签与可见性', href: `${editUrl}#basic`, icon: SlidersHorizontal },
      { key: 'statement', label: '题面', description: 'Markdown 题目说明与附件引用', href: `${editUrl}#statement`, icon: FileText },
      { key: 'config', label: '评测配置', description: '语言、时空限制、用例与子任务', href: `${problemUrl}/config`, icon: Settings2, disabled: isCreate },
      { key: 'testdata', label: '测试数据', description: '输入、输出、生成器与标程', href: `${problemUrl}/files#testdata`, icon: FolderInput, disabled: isCreate },
      {
        key: 'additional', label: '附加文件', description: '题面图片与选手可下载文件',
        href: `${problemUrl}/files#additional-files`, icon: FileArchive, disabled: isCreate,
      },
      {
        key: 'permissions', label: '权限与维护者', description: '隐藏状态、验题人与危险操作',
        href: `${editUrl}#permissions`, icon: ShieldCheck,
      },
    ];
  }, [isCreate, problemUrl]);

  const activeKey = page === 'config'
    ? 'config'
    : page === 'files'
      ? hash === 'additional-files' ? 'additional' : 'testdata'
      : ['statement', 'permissions'].includes(hash) ? hash : 'basic';

  const renderItem = (item: WorkspaceItem, compact: boolean) => {
    const active = item.key === activeKey;
    const className = cn(
      'group flex min-h-11 items-center gap-3 rounded-xl text-sm transition-[color,background-color,box-shadow,transform] duration-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none',
      compact ? 'shrink-0 px-3' : 'px-3 py-2.5',
      active
        ? 'bg-background text-foreground shadow-sm ring-1 ring-border/70'
        : 'text-muted-foreground hover:bg-background/70 hover:text-foreground active:scale-[0.99]',
      item.disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted-foreground',
    );
    const content = (
      <>
        <item.icon className="size-4 shrink-0" aria-hidden="true" />
        <span className={compact ? 'font-medium' : 'min-w-0'}>
          <span className="block font-medium">{item.label}</span>
          {!compact ? <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{item.description}</span> : null}
        </span>
      </>
    );
    return item.disabled ? (
      <span key={item.key} aria-disabled="true" className={className}>{content}</span>
    ) : (
      <a key={item.key} href={item.href} aria-current={active ? 'step' : undefined} className={className}>{content}</a>
    );
  };

  return (
    <section className="mx-auto min-w-0 max-w-[1440px] space-y-5 overflow-x-clip">
      <header
        className={cn(
          'sticky top-12 z-20 -mx-1 border-b border-border/70 bg-background/95 px-1 pb-4 pt-1 backdrop-blur-xl',
          'supports-[backdrop-filter]:bg-background/85',
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">编程题工作区 · {pid || '新题'}</p>
            <h1 className="truncate text-2xl font-semibold tracking-tight text-balance">{title || '新建编程题'}</h1>
            <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
              按出题顺序完成题面、评测与文件配置；题型固定为编程题。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {status}
            {actions}
          </div>
        </div>
      </header>

      <nav aria-label="编程题编辑步骤" className="-mx-1 overflow-x-auto px-1 pb-1 lg:hidden">
        <div className="inline-flex min-w-max items-center gap-1 rounded-2xl bg-muted/70 p-1">
          {items.map((item) => renderItem(item, true))}
        </div>
      </nav>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="编程题编辑步骤" className="sticky top-44 space-y-1 rounded-2xl bg-muted/55 p-2">
            {items.map((item) => renderItem(item, false))}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </section>
  );
}
