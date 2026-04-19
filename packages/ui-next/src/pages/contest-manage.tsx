/**
 * Contest management pages — edit, manage, problem list, users, balloon,
 * clarification, print.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  FileText,
  FolderOpen,
  HelpCircle,
  MessageSquare,
  Palette,
  Printer,
  Save,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatDateTime, formatRelativeTime, makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ---------- Contest Edit ---------- */

export function ContestEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const rules: Record<string, string> = data.rules || {};
  const isEdit = data.page_name === 'contest_edit';
  const contestUrl = isEdit
    ? replaceRouteTokens(bs.urls.contestDetail, { TID: String(tdoc.docId || tdoc._id) })
    : bs.urls.contests;

  return (
    <motion.div
      className="mx-auto max-w-2xl space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <h1 className="text-xl font-semibold">{isEdit ? '编辑比赛' : '创建比赛'}</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <input type="hidden" name="operation" value="update" />

            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">比赛标题</label>
              <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rule" className="text-sm font-medium">赛制</label>
              <select id="rule" name="rule" defaultValue={tdoc.rule || ''} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {Object.entries(rules).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="beginAtDate" className="text-sm font-medium">开始日期</label>
                <Input id="beginAtDate" name="beginAtDate" type="date" defaultValue={data.beginAt ? String(data.beginAt).split('T')[0] : ''} required />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="beginAtTime" className="text-sm font-medium">开始时间</label>
                <Input id="beginAtTime" name="beginAtTime" type="time" defaultValue={data.beginAt ? String(data.beginAt).slice(11, 16) : ''} required />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="duration" className="text-sm font-medium">时长 (小时)</label>
              <Input id="duration" name="duration" type="number" step="0.5" min="0" defaultValue={data.duration || 2} required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pids" className="text-sm font-medium">题目列表 (逗号分隔)</label>
              <Input id="pids" name="pids" defaultValue={data.pids || ''} placeholder="P1001,P1002,P1003" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="content" className="text-sm font-medium">比赛说明 (Markdown)</label>
              <textarea
                id="content"
                name="content"
                rows={6}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                defaultValue={tdoc.content || ''}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="code" className="text-sm font-medium">邀请码 (可选)</label>
              <Input id="code" name="code" defaultValue={tdoc.code || ''} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="langs" className="text-sm font-medium">允许语言 (逗号分隔，留空为全部)</label>
              <Input id="langs" name="langs" defaultValue={Array.isArray(tdoc.langs) ? tdoc.langs.join(',') : ''} />
            </div>

            <Separator />

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="rated" value="true" defaultChecked={tdoc.rated} className="size-4 rounded border" />
                计入 Rating
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="autoHide" value="true" defaultChecked={tdoc.autoHide} className="size-4 rounded border" />
                赛后自动隐藏题目
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowViewCode" value="true" defaultChecked={tdoc.allowViewCode} className="size-4 rounded border" />
                允许查看代码
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowPrint" value="true" defaultChecked={tdoc.allowPrint} className="size-4 rounded border" />
                允许打印
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="keepScoreboardHidden" value="true" defaultChecked={tdoc.keepScoreboardHidden} className="size-4 rounded border" />
                赛后保持榜单隐藏
              </label>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit">
                <Save className="mr-1 size-4" />{isEdit ? '保存修改' : '创建比赛'}
              </Button>
              {isEdit && (
                <form method="post" className="inline" onSubmit={(e) => { if (!confirm('确定要删除此比赛吗？')) e.preventDefault(); }}>
                  <input type="hidden" name="operation" value="delete" />
                  <Button type="submit" variant="destructive" size="sm">
                    <Trash2 className="mr-1 size-3" />删除比赛
                  </Button>
                </form>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest Manage (files) ---------- */

export function ContestManagePage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const files: R[] = data.files || [];
  const privateFiles: R[] = data.privateFiles || [];
  const pdict: Record<string, R> = data.pdict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });

  const FileSection = ({ title, fileList, type }: { title: string; fileList: R[]; type: string }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="size-4" />{title} ({fileList.length})
        </CardTitle>
        <form method="post" encType="multipart/form-data" className="flex items-center gap-2">
          <input type="hidden" name="type" value={type} />
          <input type="file" name="file" className="text-xs" />
          <Button type="submit" name="operation" value="upload_file" size="sm" variant="outline">
            <Upload className="mr-1 size-3" />上传
          </Button>
        </form>
      </CardHeader>
      <CardContent className="p-0">
        {fileList.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-20 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fileList.map((f) => (
                <TableRow key={f.name}>
                  <TableCell className="font-mono text-sm">{f.name}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{formatSize(f.size || 0)}</TableCell>
                  <TableCell className="text-center">
                    <form method="post" className="inline">
                      <input type="hidden" name="files" value={f.name} />
                      <input type="hidden" name="type" value={type} />
                      <Button type="submit" name="operation" value="delete_files" variant="ghost" size="icon" className="size-7">
                        <Trash2 className="size-3 text-destructive" />
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">暂无文件</p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">比赛管理</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      {/* Problem scores */}
      {Object.keys(pdict).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">题目分值</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>题号</TableHead>
                  <TableHead>题目</TableHead>
                  <TableHead className="w-32 text-right">分值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(pdict).map(([pid, p]) => (
                  <TableRow key={pid}>
                    <TableCell className="font-mono text-sm">{p.pid || pid}</TableCell>
                    <TableCell className="text-sm">{p.title || '-'}</TableCell>
                    <TableCell className="text-right">
                      <form method="post" className="flex items-center justify-end gap-1">
                        <input type="hidden" name="operation" value="set_score" />
                        <input type="hidden" name="pid" value={pid} />
                        <Input name="score" type="number" min="1" defaultValue={tdoc.score?.[pid] || 100} className="w-20 text-right" />
                        <Button type="submit" size="icon" variant="ghost" className="size-7">
                          <Save className="size-3" />
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <FileSection title="公开文件" fileList={files} type="public" />
      <FileSection title="私有文件" fileList={privateFiles} type="private" />
    </motion.div>
  );
}

/* ---------- Contest Problem List ---------- */

export function ContestProblemListPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const pdict: Record<string, R> = data.pdict || {};
  const tcdocs: R[] = data.tcdocs || [];
  const pids: number[] = tdoc.pids || [];
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const showScore = data.showScore;

  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">比赛题目</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-center">#</TableHead>
                <TableHead>题目</TableHead>
                {showScore && <TableHead className="w-20 text-right">分值</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pids.map((pid, idx) => {
                const p = pdict[String(pid)] || {};
                return (
                  <TableRow key={String(pid)}>
                    <TableCell className="text-center font-mono font-semibold">{ALPHA[idx] || idx + 1}</TableCell>
                    <TableCell>
                      <a href={`${contestUrl}/p/${p.pid || pid}`} className="text-sm text-primary hover:underline">
                        {p.title || `P${pid}`}
                      </a>
                    </TableCell>
                    {showScore && (
                      <TableCell className="text-right font-mono text-sm">{tdoc.score?.[pid] || 100}</TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Clarifications */}
      {tcdocs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="size-4" />答疑 ({tcdocs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tcdocs.map((tc) => (
              <div key={String(tc._id)} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  {tc.subject != null && <Badge variant="outline">{ALPHA[tc.subject] || tc.subject}</Badge>}
                  <span className="text-xs text-muted-foreground">{tc.updateAt ? formatRelativeTime(tc.updateAt, bs.locale) : ''}</span>
                </div>
                <p className="mt-1 text-sm">{tc.content}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Submit clarification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">提交答疑</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="flex items-end gap-3">
            <input type="hidden" name="operation" value="clarification" />
            <div className="flex-1 space-y-1.5">
              <select name="subject" className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="-1">通用</option>
                {pids.map((pid, idx) => {
                  const p = pdict[String(pid)] || {};
                  return <option key={String(pid)} value={idx}>{ALPHA[idx]} — {p.title || `P${pid}`}</option>;
                })}
              </select>
            </div>
            <div className="flex-[2] space-y-1.5">
              <Input name="content" placeholder="输入你的问题..." required />
            </div>
            <Button type="submit">发送</Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest User ---------- */

export function ContestUserPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const tsdocs: R[] = data.tsdocs || [];
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">参赛选手</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title} — 共 {tsdocs.length} 人</p>
        </div>
      </div>

      {/* Add user */}
      <Card>
        <CardContent className="p-4">
          <form method="post" className="flex items-end gap-3">
            <input type="hidden" name="operation" value="add_user" />
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">用户 UID (逗号分隔)</label>
              <Input name="uids" placeholder="1001,1002" required />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="unrank" value="true" className="size-4 rounded border" />不计入排名
            </label>
            <Button type="submit"><UserPlus className="mr-1 size-4" />添加</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead className="w-20 text-center">状态</TableHead>
                <TableHead className="w-36 text-right">开始时间</TableHead>
                <TableHead className="w-36 text-right">结束时间</TableHead>
                <TableHead className="w-20 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tsdocs.map((ts) => {
                const u = getUser(udict, ts.uid);
                return (
                  <TableRow key={String(ts.uid)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[10px]">{makeInitials(u?.uname || '?')}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{u?.uname || `UID ${ts.uid}`}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {ts.attend ? (
                        <Badge variant={ts.unrank ? 'outline' : 'default'} className="text-xs">
                          {ts.unrank ? '不计排名' : '参赛中'}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">未参赛</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {ts.startAt ? formatDateTime(ts.startAt, bs.locale) : '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {ts.endAt ? formatDateTime(ts.endAt, bs.locale) : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <form method="post" className="inline">
                        <input type="hidden" name="operation" value="rank" />
                        <input type="hidden" name="uid" value={String(ts.uid)} />
                        <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
                          {ts.unrank ? '恢复排名' : '取消排名'}
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
              {tsdocs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">暂无选手</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest Balloon ---------- */

export function ContestBalloonPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const bdocs: R[] = data.bdocs || [];
  const pdict: Record<string, R> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">🎈 气球分发</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
        <div className="ml-auto">
          <form method="post" className="flex items-center gap-2">
            <input type="hidden" name="operation" value="set_color" />
            <Input name="color" placeholder="颜色配置..." className="w-48" />
            <Button type="submit" size="sm"><Palette className="mr-1 size-3" />设置</Button>
          </form>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>题目</TableHead>
                <TableHead className="w-28 text-center">时间</TableHead>
                <TableHead className="w-20 text-center">状态</TableHead>
                <TableHead className="w-20 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bdocs.map((b) => {
                const u = getUser(udict, b.uid);
                const p = pdict[String(b.pid)] || {};
                return (
                  <TableRow key={String(b._id)}>
                    <TableCell className="text-sm">{u?.uname || `UID ${b.uid}`}</TableCell>
                    <TableCell className="text-sm">{p.title || `P${b.pid}`}</TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {b.time ? formatDateTime(b.time, bs.locale) : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={b.done ? 'default' : 'outline'} className="text-xs">
                        {b.done ? '已送达' : '待处理'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {!b.done && (
                        <form method="post" className="inline">
                          <input type="hidden" name="operation" value="done" />
                          <input type="hidden" name="balloon" value={String(b._id)} />
                          <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">完成</Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {bdocs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">暂无气球任务</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest Clarification ---------- */

export function ContestClarificationPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const tcdocs: R[] = data.tcdocs || [];
  const pdict: Record<string, R> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pids: number[] = tdoc.pids || [];

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">答疑管理</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      {/* Reply form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">发布通知/回复</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="clarification" />
            <div className="grid grid-cols-3 gap-3">
              <select name="subject" className="rounded-md border bg-background px-3 py-2 text-sm">
                <option value="-1">通用通知</option>
                {pids.map((pid, idx) => {
                  const p = pdict[String(pid)] || {};
                  return <option key={String(pid)} value={idx}>{ALPHA[idx]} — {p.title || `P${pid}`}</option>;
                })}
              </select>
              <div className="col-span-2">
                <Input name="content" placeholder="输入答疑内容..." required />
              </div>
            </div>
            <Button type="submit"><MessageSquare className="mr-1 size-4" />发送</Button>
          </form>
        </CardContent>
      </Card>

      {/* Clarification list */}
      {tcdocs.length > 0 ? (
        <div className="space-y-3">
          {tcdocs.map((tc) => {
            const u = getUser(udict, tc.owner);
            return (
              <Card key={String(tc._id)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[9px]">{makeInitials(u?.uname || '?')}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{u?.uname || '管理员'}</span>
                    {tc.subject != null && tc.subject >= 0 && (
                      <Badge variant="outline" className="text-xs">{ALPHA[tc.subject] || tc.subject}</Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {tc.updateAt ? formatRelativeTime(tc.updateAt, bs.locale) : ''}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{tc.content}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">暂无答疑</CardContent>
        </Card>
      )}
    </motion.div>
  );
}

/* ---------- Contest Print ---------- */

export function ContestPrintPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });

  return (
    <motion.div
      className="mx-auto max-w-lg space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">打印服务</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Printer className="size-4" />提交打印
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <input type="hidden" name="operation" value="print" />
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">标题</label>
              <Input id="title" name="title" placeholder="文件标题" required />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">内容</label>
              <textarea
                name="content"
                rows={12}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                placeholder="粘贴要打印的代码或文本..."
                required
              />
            </div>
            <Button type="submit"><Printer className="mr-1 size-4" />提交打印</Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
