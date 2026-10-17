/**
 * Homework file management.
 */

import { ArrowLeft, FolderOpen, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens } from '@/lib/format';

interface HomeworkDocument {
  _id?: string | number;
  docId?: string | number;
  title?: string;
}

interface HomeworkFile {
  name: string;
  size?: number;
  lastModified?: string | Date;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function BackButton({ href }: { href: string }) {
  return (
    <Button asChild variant="ghost" size="sm" iconOnly>
      <a href={href} aria-label="返回">
        <ArrowLeft />
      </a>
    </Button>
  );
}

export function HomeworkFilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as { tdoc?: HomeworkDocument; files?: HomeworkFile[] };
  const tdoc = data.tdoc || {};
  const files = data.files || [];
  const tid = tdoc.docId || tdoc._id;
  const hwUrl = replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(tid) });

  return (
    <Page width="wide">
      <PageHeader title="作业文件" description={tdoc.title || undefined} actions={<BackButton href={hwUrl} />} />

      <Panel
        flush
        title={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <FolderOpen className="size-4 shrink-0 text-fg-subtle" />
            <span className="min-w-0 truncate">
              文件 (<span className="tabular">{files.length}</span>)
            </span>
          </span>
        }
        actions={
          <form method="post" encType="multipart/form-data" className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">
            <input type="file" name="file" className="max-w-full text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="primary">
              <Upload />
              上传
            </Button>
          </form>
        }
      >
        {files.length > 0 ? (
          <>
            <ul className="divide-y divide-line-subtle sm:hidden">
              {files.map((f) => (
                <li key={f.name} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm text-fg">{f.name}</p>
                    <p className="mt-1 text-xs text-fg-subtle tabular">
                      {formatSize(f.size || 0)}
                      {f.lastModified ? ` · ${formatDateTime(f.lastModified, bs.locale)}` : ''}
                    </p>
                  </div>
                  <form
                    method="post"
                    className="shrink-0"
                    onSubmit={(event) => {
                      void confirmFormSubmit(event, '删除后不能恢复。', {
                        destructive: true,
                        title: `删除文件「${f.name}」？`,
                        confirmLabel: '删除',
                      });
                    }}
                  >
                    <input type="hidden" name="operation" value="delete_files" />
                    <input type="hidden" name="files" value={f.name} />
                    <Button type="submit" variant="danger-soft" size="sm" iconOnly aria-label={`删除 ${f.name}`}>
                      <Trash2 />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>文件名</TableHead>
                    <TableHead className="w-28 text-right">大小</TableHead>
                    <TableHead className="w-40 text-right">修改时间</TableHead>
                    <TableHead className="w-20 text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((f) => (
                    <TableRow key={f.name}>
                      <TableCell className="min-w-0 break-all font-mono text-sm">{f.name}</TableCell>
                      <TableCell className="text-right text-sm text-fg-subtle tabular">{formatSize(f.size || 0)}</TableCell>
                      <TableCell className="text-right text-sm text-fg-subtle tabular">
                        {f.lastModified ? formatDateTime(f.lastModified, bs.locale) : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <form
                          method="post"
                          className="inline"
                          onSubmit={(event) => {
                            void confirmFormSubmit(event, '删除后不能恢复。', {
                              destructive: true,
                              title: `删除文件「${f.name}」？`,
                              confirmLabel: '删除',
                            });
                          }}
                        >
                          <input type="hidden" name="operation" value="delete_files" />
                          <input type="hidden" name="files" value={f.name} />
                          <Button type="submit" variant="danger-soft" size="sm" iconOnly aria-label={`删除 ${f.name}`}>
                            <Trash2 />
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <EmptyState compact icon={<FolderOpen />} title="暂无文件" />
        )}
      </Panel>
    </Page>
  );
}
