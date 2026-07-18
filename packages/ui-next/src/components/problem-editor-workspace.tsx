import { ArrowLeft, FileArchive, FileText, FolderInput, Settings2, ShieldCheck } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { cn } from '@/lib/cn';

export type ProblemEditorWorkspacePage = 'edit' | 'collaboration' | 'config' | 'files';
export type ProblemEditorFileSection = 'testdata' | 'additional';

interface WorkspaceItem {
  key: string;
  label: string;
  description: string;
  href: string;
  icon: typeof FileText;
  disabled?: boolean;
  disabledReason?: string;
}

export function ProblemEditorWorkspace({
  page,
  problemUrl,
  title,
  pid,
  isCreate = false,
  fileSection = 'testdata',
  editEnabled = true,
  dataEnabled = true,
  collaborationEnabled = true,
  status,
  actions,
  children,
}: {
  page: ProblemEditorWorkspacePage;
  problemUrl: string;
  title: string;
  pid: string;
  isCreate?: boolean;
  fileSection?: ProblemEditorFileSection;
  editEnabled?: boolean;
  dataEnabled?: boolean;
  collaborationEnabled?: boolean;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const items = useMemo<WorkspaceItem[]>(() => {
    const editUrl = isCreate ? (typeof window === 'undefined' ? '/problem/create/programming' : window.location.pathname) : `${problemUrl}/edit`;
    const createDisabledReason = '创建题目后可用';
    return [
      {
        key: 'edit',
        label: '题目内容',
        description: '标题、题号、标签、来源与题面',
        href: editUrl,
        icon: FileText,
        disabled: !editEnabled,
        disabledReason: '当前角色没有题面或标签权限',
      },
      {
        key: 'config',
        label: '评测配置',
        description: '语言、时空限制、用例与子任务',
        href: `${problemUrl}/config`,
        icon: Settings2,
        disabled: isCreate || !dataEnabled,
        disabledReason: isCreate ? createDisabledReason : '当前角色没有评测数据权限',
      },
      {
        key: 'testdata',
        label: '测试数据',
        description: '输入、输出、生成器与标程',
        href: `${problemUrl}/files?section=testdata`,
        icon: FolderInput,
        disabled: isCreate || !dataEnabled,
        disabledReason: isCreate ? createDisabledReason : '当前角色没有评测数据权限',
      },
      {
        key: 'additional',
        label: '附加文件',
        description: '题面图片与选手可下载文件',
        href: `${problemUrl}/files?section=additional`,
        icon: FileArchive,
        disabled: isCreate || !dataEnabled,
        disabledReason: isCreate ? createDisabledReason : '当前角色没有评测数据权限',
      },
      {
        key: 'collaboration',
        label: '权限与协作',
        description: '出题人、贡献者、验题人、维护者与审核发布',
        href: `${editUrl}?section=collaboration`,
        icon: ShieldCheck,
        disabled: isCreate || !collaborationEnabled,
        disabledReason: isCreate ? createDisabledReason : '当前角色无协作管理权限',
      },
    ];
  }, [collaborationEnabled, dataEnabled, editEnabled, isCreate, problemUrl]);

  const activeKey = page === 'config' ? 'config' : page === 'files' ? fileSection : page;

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
      <span
        key={item.key}
        aria-disabled="true"
        aria-label={`${item.label}，${item.disabledReason}`}
        title={item.disabledReason}
        className={className}
      >
        {content}
      </span>
    ) : (
      <a key={item.key} href={item.href} aria-current={active ? 'step' : undefined} className={className}>
        {content}
      </a>
    );
  };

  return (
    <section className="w-full min-w-0 space-y-5 overflow-x-clip pb-10">
      <header className="border-b border-border/70 pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            {isCreate ? (
              <a href="/problem/create" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-3.5" />
                选择其他题型
              </a>
            ) : null}
            <p className="text-xs font-medium tracking-wide text-muted-foreground">编程题工作区 · {pid || '新题'}</p>
            <h1 className="truncate text-2xl font-semibold tracking-tight text-balance">{title || '新建编程题'}</h1>
            <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">题目内容、评测、文件与协作分别使用现有功能页面；题型固定为编程题。</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {status}
            {actions}
          </div>
        </div>
      </header>

      <nav aria-label="编程题编辑步骤" className="-mx-1 overflow-x-auto px-1 pb-1 lg:hidden">
        <div className="inline-flex min-w-max items-center gap-1 rounded-2xl bg-muted/70 p-1">{items.map((item) => renderItem(item, true))}</div>
      </nav>

      {isCreate ? (
        <p role="status" className="rounded-xl bg-muted/55 px-4 py-3 text-sm text-muted-foreground">
          先创建题目；取得真实题号后，评测配置、文件与协作功能会在完整工作区开放。
        </p>
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="编程题编辑步骤" className="sticky top-20 space-y-1 rounded-2xl bg-muted/55 p-2">
            {items.map((item) => renderItem(item, false))}
          </nav>
        </aside>
        <main id="problem-editor-content" className="min-w-0">
          {children}
        </main>
      </div>
    </section>
  );
}
