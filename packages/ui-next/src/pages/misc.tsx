import { ExternalLink, FolderOpen, Globe, HelpCircle, LogOut, Settings, Star, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { formatPlainTextSummary } from '@/lib/format';

interface DomainSummary {
  _id?: string | number;
  name?: string;
  bulletin?: string;
  owner?: string | number;
}

interface DomainsPageData {
  ddocs?: DomainSummary[];
  domains?: DomainSummary[];
  canManage?: Record<string, boolean>;
  role?: Record<string, string>;
}

interface ManagedFile {
  _id?: string | number;
  name?: string;
  filename?: string;
  size?: number;
}

export function DomainsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as DomainsPageData;
  const domains = data.ddocs || data.domains || [];
  const canManage = data.canManage || {};
  const roles = data.role || {};
  const pinnedDomains = new Set((bs.user.pinnedDomains || []).map(String));

  return (
    <Page width="wide">
      <PageHeader
        title="我的域"
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <a href="/wiki/help#domain">
                <HelpCircle />
                域帮助
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href="/domain/join">
                <UserPlus />
                加入域
              </a>
            </Button>
            <Button asChild variant="primary" size="sm">
              <a href="/home/domain/create">创建新域</a>
            </Button>
          </>
        }
      />

      {domains.length === 0 ? (
        <EmptyState
          icon={<Globe />}
          title="你还没有加入任何域"
          action={
            <Button asChild variant="secondary">
              <a href="/domain/join">加入域</a>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((domain) => {
            const id = String(domain._id);
            const pinned = pinnedDomains.has(id);
            const pinLabel = pinned ? '取消置顶' : '置顶';
            return (
              <Panel
                key={id}
                className="h-full"
                title={<span className="block min-w-0 truncate">{domain.name || id}</span>}
                actions={
                  <form method="post">
                    <input type="hidden" name="operation" value="star" />
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="star" value={pinned ? 'false' : 'true'} />
                    <Button type="submit" variant="ghost" size="sm" iconOnly className="shrink-0" title={pinLabel} aria-label={pinLabel}>
                      <Star className={pinned ? 'fill-current text-fg' : 'text-fg-subtle'} />
                    </Button>
                  </form>
                }
                footer={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="secondary" size="sm">
                      <a href={`/d/${id}`}>
                        <ExternalLink />
                        访问
                      </a>
                    </Button>
                    {canManage[id] ? (
                      <Button asChild variant="secondary" size="sm">
                        <a href={`/d/${id}/domain/dashboard`}>
                          <Settings />
                          管理
                        </a>
                      </Button>
                    ) : null}
                    {id !== 'system' && domain.owner !== bs.user.id ? (
                      <form
                        method="post"
                        onSubmit={(event) => {
                          void confirmFormSubmit(event, `确定离开域 ${id}？`, { destructive: true });
                        }}
                      >
                        <input type="hidden" name="operation" value="leave" />
                        <input type="hidden" name="id" value={id} />
                        <Button type="submit" variant="danger-soft" size="sm">
                          <LogOut />
                          退出
                        </Button>
                      </form>
                    ) : null}
                  </div>
                }
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" size="sm" className="font-mono">
                      {id}
                    </Badge>
                    <Badge variant="soft" size="sm">
                      {roles[id] || 'default'}
                    </Badge>
                  </div>
                  {domain.bulletin ? (
                    <p className="line-clamp-3 text-xs text-fg-subtle">{formatPlainTextSummary(domain.bulletin)}</p>
                  ) : (
                    <p className="text-xs text-fg-subtle">暂无描述</p>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </Page>
  );
}

export function FilesPage() {
  const bs = useBootstrap();
  const { files = [] } = bs.page.data as { files?: ManagedFile[] };

  return (
    <Page width="wide">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen className="size-5 text-fg-subtle" />
            文件管理
          </span>
        }
      />

      <Panel title="上传文件">
        <form method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" className="text-sm" />
          <Button type="submit" variant="primary" size="sm">
            上传
          </Button>
        </form>
      </Panel>

      <Panel flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>文件名</TableHead>
              <TableHead className="w-24 text-right">大小</TableHead>
              <TableHead className="w-20 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-fg-muted">
                  暂无文件
                </TableCell>
              </TableRow>
            ) : (
              files.map((file) => (
                <TableRow key={String(file.name || file._id)}>
                  <TableCell className="font-medium">{file.name || file.filename}</TableCell>
                  <TableCell className="text-right text-sm tabular text-fg-subtle">
                    {file.size ? `${Math.round(file.size / 1024)} KB` : '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/file/${bs.user.id}/${file.name || file.filename}`}>下载</a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>
    </Page>
  );
}
