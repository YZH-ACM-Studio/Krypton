/**
 * User detail page — redesigned (Q2):
 *   - Hero with large avatar + identity + KPI strip
 *   - Bio card directly under hero, rendered as full Markdown
 *   - 65 : 35 split — left = tag histogram + solved problems + attended contests,
 *     right = identity meta + contacts (with copy) + solution previews.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  Calendar,
  Clipboard,
  Hash,
  ListChecks,
  Mail,
  MessageSquare,
  Settings as SettingsIcon,
  Tag,
  Trophy,
  User as UserIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SimpleSelect } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

export function UserDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const udoc: R = data.udoc || {};
  const sdoc: R = data.sdoc || {};
  const pdocs: R[] = data.pdocs || [];
  const tags: Array<[string, number]> = data.tags || [];
  const tdocs: R[] = data.tdocs || [];
  const psdocs: R[] = data.psdocs || [];
  const pdict: Record<string, R> = data.pdict || {};
  const isSelfProfile = !!data.isSelfProfile || Number(udoc._id) === Number(bs.user.id);

  const name = udoc.uname || 'User';
  const rp = Math.round(Number(udoc.rp || 0));
  const bio = udoc.bio || '';
  const acCount = Number(udoc.nAccept ?? pdocs.length ?? 0);
  const submitCount = Number(udoc.nSubmit ?? 0);
  const lastActive = sdoc?.updateAt || udoc.loginat;

  const contactItems = [
    { label: '邮箱', value: udoc.mail, icon: Mail },
    { label: 'QQ', value: udoc.qq, icon: MessageSquare },
    { label: '微信', value: udoc.wechat, icon: MessageSquare },
    { label: '学号', value: udoc.studentId, icon: Hash },
    { label: '学校', value: udoc.school, icon: UserIcon },
  ].filter((it) => it.value);

  // Top tag histogram — normalise widths from the largest count
  const maxTagCount = tags.length ? Math.max(...tags.map(([, c]) => c)) : 0;

  const avatarUrl = udoc.avatarUrl || (udoc.avatar && /^https?:|^\//.test(udoc.avatar) ? udoc.avatar : null);

  return (
    <motion.div
      className="space-y-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Hero card */}
      <Card>
        <CardContent className="flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-start">
          <Avatar className="size-24 shrink-0">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
            <AvatarFallback className="text-3xl">{makeInitials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 text-center sm:text-left min-w-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold truncate">{name}</h1>
                {udoc.displayName ? (
                  <p className="text-sm text-muted-foreground">{udoc.displayName}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                  {udoc.role ? <Badge variant="outline" className="text-[10px]">{udoc.role}</Badge> : null}
                  {udoc.school ? <Badge variant="secondary" className="text-[10px]">{udoc.school}</Badge> : null}
                  <Badge variant="outline" className="text-[10px] font-mono">UID {udoc._id ?? '?'}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-end shrink-0">
                {isSelfProfile ? (
                  <Button asChild variant="outline" size="sm">
                    <a href="/home/settings/account">
                      <SettingsIcon className="size-4" />
                      编辑资料
                    </a>
                  </Button>
                ) : null}
                {bs.user.signedIn && udoc._id ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/home/messages?target=${udoc._id}`} target="_blank" rel="noreferrer">
                      <MessageSquare className="size-4" />
                      发消息
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bio card — only when non-empty; rendered with full Markdown */}
      {bio ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-1.5">
              <UserIcon className="size-4" />
              个人简介
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownView content={bio} preferredLang={bs.locale} />
          </CardContent>
        </Card>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="RP" value={rp} icon={<Trophy className="size-4 text-amber-500" />} />
        <KpiCard label="通过" value={acCount} icon={<ListChecks className="size-4 text-green-600" />} />
        <KpiCard label="提交" value={submitCount} icon={<Hash className="size-4 text-muted-foreground" />} />
        <KpiCard label="排名" value={udoc.rank ? `#${udoc.rank}` : '—'} icon={<Trophy className="size-4 text-muted-foreground" />} />
      </div>

      {/* 65 : 35 main grid */}
      <div className="grid gap-5 lg:grid-cols-[64fr_36fr]">
        {/* Left */}
        <div className="space-y-4 min-w-0">
          {/* Tag histogram */}
          {tags.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-1.5">
                  <Tag className="size-4" />
                  常通过标签
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {tags.slice(0, 12).map(([tag, count]) => {
                  const pct = maxTagCount > 0 ? Math.round((count / maxTagCount) * 100) : 0;
                  return (
                    <div key={tag} className="flex items-center gap-3 text-xs">
                      <span className="w-24 truncate" title={tag}>{tag}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary/80 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 text-right font-mono tabular-nums text-muted-foreground">{count}</span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {/* Submission heatmap (GitHub-style) */}
          <ActivityHeatmap daily={data.daily || {}} />


          {/* Attended contests */}
          {tdocs.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Trophy className="size-4" />
                    参加过的比赛
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">{tdocs.length}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {tdocs.slice(0, 12).map((t: R) => (
                    <a
                      key={String(t.docId)}
                      href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(t.docId) })}
                      className="flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-accent"
                    >
                      <span className="truncate">{t.title || '未命名'}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] shrink-0">{t.rule || '—'}</Badge>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Right */}
        <div className="space-y-3 min-w-0">
          {/* Meta */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                账号信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="UID" value={String(udoc._id ?? '—')} mono />
              <Row label="注册" value={udoc.regat ? formatDateTime(udoc.regat, bs.locale) : '—'} />
              <Row label="最近活跃" value={lastActive ? formatDateTime(lastActive, bs.locale) : '离线'} />
              {udoc.timezone ? <Row label="时区" value={String(udoc.timezone)} /> : null}
            </CardContent>
          </Card>

          {/* Contacts */}
          {contactItems.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">联系方式</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {contactItems.map(({ label, value, icon: Icon }) => (
                  <ContactRow key={label} label={label} value={String(value)} icon={<Icon className="size-3.5 text-muted-foreground" />} />
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* Solutions */}
          {psdocs.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">最近题解</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {psdocs.slice(0, 8).map((ps: R) => {
                    const p = pdict[String(ps.parentId)];
                    return (
                      <a
                        key={String(ps._id)}
                        href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(ps.parentId) }) + `/solution/${ps._id}`}
                        className="flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-accent"
                      >
                        <span className="font-mono text-[10px] text-muted-foreground">{ps.parentId}</span>
                        <span className="truncate">{p?.title || ps.title || '题解'}</span>
                        {ps.vote ? <Badge variant="outline" className="ml-auto text-[10px]">{ps.vote}↑</Badge> : null}
                      </a>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="rounded-md bg-muted/40 p-2">{icon}</div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground truncate">{label}</p>
          <p className="text-xl font-semibold tabular-nums leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * GitHub-style submission heatmap. 53 columns × 7 rows (Sun→Sat).
 *
 * `daily` is keyed by local-time YYYY-MM-DD strings — the backend already
 * formatted via `$dateToString` so we don't re-do timezone math here.
 *
 * Color scale: 5 buckets, transparent → primary at quartiles of the
 * non-zero distribution. We compute thresholds locally so a low-activity
 * user still gets a meaningful gradient (instead of one solid color).
 */
function ActivityHeatmap({ daily }: { daily: Record<string, number> }) {
  // Build the 53×7 grid backwards from "today" so the rightmost column
  // contains the current day, with Sunday at row 0 and Saturday at row 6.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDay = today.getTime();

  // Align right column to a full Sun-Sat week by padding forward to Saturday.
  const sat = new Date(today);
  sat.setDate(today.getDate() + (6 - today.getDay()));
  const totalDays = 53 * 7;
  const startTs = sat.getTime() - (totalDays - 1) * 86400000;

  const cells: Array<{ date: string; count: number; isFuture: boolean }> = [];
  let totalSubmissions = 0;
  let activeDays = 0;
  const nonZeroCounts: number[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startTs + i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const count = daily[key] || 0;
    const isFuture = d.getTime() > endDay;
    cells.push({ date: key, count, isFuture });
    if (!isFuture && count > 0) {
      totalSubmissions += count;
      activeDays++;
      nonZeroCounts.push(count);
    }
  }

  // Quartile thresholds for the 4 active buckets. Sort non-zero counts and
  // pick 25/50/75 percentile boundaries. Falls back to [1,2,4,8] for tiny
  // samples so empty / brand-new users still see a sensible scale.
  function bucket(n: number): 0 | 1 | 2 | 3 | 4 {
    if (n <= 0) return 0;
    const sorted = nonZeroCounts.slice().sort((a, b) => a - b);
    if (sorted.length < 4) {
      if (n >= 8) return 4;
      if (n >= 4) return 3;
      if (n >= 2) return 2;
      return 1;
    }
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q2 = sorted[Math.floor(sorted.length * 0.50)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    if (n >= q3) return 4;
    if (n >= q2) return 3;
    if (n >= q1) return 2;
    return 1;
  }

  // Group by column (53 columns of 7 days each).
  const columns: Array<Array<typeof cells[number]>> = [];
  for (let c = 0; c < 53; c++) columns.push(cells.slice(c * 7, c * 7 + 7));

  // Month labels — show the month name above the first column where it
  // changes (only for full visible months, not partial). We also add a
  // label for the very first column.
  const monthLabels: Array<{ col: number; label: string }> = [];
  let lastMonth = -1;
  columns.forEach((col, ci) => {
    const firstDay = new Date(col[0].date);
    const m = firstDay.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ col: ci, label: `${m + 1}月` });
      lastMonth = m;
    }
  });

  const bucketClass: Record<0 | 1 | 2 | 3 | 4, string> = {
    0: 'bg-muted/40',
    1: 'bg-primary/20',
    2: 'bg-primary/45',
    3: 'bg-primary/70',
    4: 'bg-primary',
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Activity className="size-4" />
            最近一年的提交活跃度
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            共 {totalSubmissions} 次 · 活跃 {activeDays} 天
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="inline-flex flex-col gap-1 text-[10px] text-muted-foreground">
            {/* Month axis */}
            <div className="ml-7 flex gap-[3px]">
              {columns.map((_, ci) => {
                const label = monthLabels.find((m) => m.col === ci);
                return (
                  <div key={ci} className="w-[11px] text-left" style={{ minWidth: 11 }}>
                    {label ? <span className="pl-0">{label.label}</span> : null}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1">
              {/* Day-of-week axis */}
              <div className="mr-1 flex flex-col gap-[3px] justify-around pt-px text-right">
                {['', '一', '', '三', '', '五', ''].map((d, i) => (
                  <div key={i} className="h-[11px] w-6 leading-[11px]">{d}</div>
                ))}
              </div>
              {/* Cells */}
              <div className="flex gap-[3px]">
                {columns.map((col, ci) => (
                  <div key={ci} className="flex flex-col gap-[3px]">
                    {col.map((cell, ri) => (
                      <div
                        key={ri}
                        className={`size-[11px] rounded-[2px] ${cell.isFuture ? 'opacity-0' : bucketClass[bucket(cell.count)]}`}
                        title={cell.isFuture
                          ? ''
                          : `${cell.date} · ${cell.count} 次提交`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="ml-7 mt-1 flex items-center gap-1.5">
              <span>少</span>
              {([0, 1, 2, 3, 4] as const).map((b) => (
                <span key={b} className={`size-[11px] rounded-[2px] ${bucketClass[b]}`} />
              ))}
              <span>多</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium tabular-nums ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function ContactRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex w-full items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
      title="点击复制"
    >
      {icon}
      <span className="font-medium shrink-0">{label}</span>
      <span className="truncate text-muted-foreground">{value}</span>
      <Clipboard className={`size-3 ml-auto shrink-0 ${copied ? 'text-green-600' : 'text-muted-foreground/40'}`} />
      {copied ? <span className="text-[10px] text-green-600">已复制</span> : null}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Settings / Security / Messages (unchanged from before)             */
/* ────────────────────────────────────────────────────────────────── */

export function SettingsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const settings: R[] = data.settings || [];
  const current: R = data.current || {};

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h1 className="text-xl font-semibold">{data.page_name === 'home_account' ? '账号' : '设置'}</h1>

      <form method="post" className="space-y-6">
        {settings.map((s: R) => (
          <Card key={String(s.key)}>
            <CardHeader>
              <CardTitle className="text-base">{s.name || s.key}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SettingControl setting={s} value={current[s.key]} />
            </CardContent>
          </Card>
        ))}
        <div className="flex justify-end">
          <Button type="submit">保存</Button>
        </div>
      </form>
    </motion.div>
  );
}

function SettingControl({ setting, value }: { setting: R; value: any }) {
  const name = String(setting.key);
  const type = setting.type || 'text';
  if (setting.range && typeof setting.range === 'object') {
    const entries = Object.entries(setting.range);
    return (
      <SimpleSelect
        name={name}
        defaultValue={value || ''}
        options={entries.map(([k, v]) => ({ value: k, label: String(v) }))}
      />
    );
  }
  if (type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name={name} defaultChecked={!!value} />
        {setting.desc || setting.key}
      </label>
    );
  }
  if (type === 'markdown' || type === 'textarea') {
    return <MarkdownEditor name={name} value={value || ''} minHeight={220} />;
  }
  return <Input name={name} defaultValue={value || ''} />;
}

export function SecurityPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const sessions: R[] = data.sessions || [];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h1 className="text-xl font-semibold">账号安全</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">修改密码</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/home/security/password" className="space-y-3">
            <Input name="currentPassword" placeholder="当前密码" type="password" />
            <Input name="newPassword" placeholder="新密码" type="password" />
            <Input name="newPasswordAgain" placeholder="重复新密码" type="password" />
            <Button type="submit">修改密码</Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader><CardTitle className="text-base">会话</CardTitle></CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无会话</p>
          ) : (
            <div className="divide-y">
              {sessions.map((s: R) => (
                <div key={String(s._id)} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.userAgent || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">{s.updateAt ? formatDateTime(s.updateAt, bs.locale) : '—'}</p>
                  </div>
                  {s._id ? (
                    <form method="post" action="/home/security/session" className="ml-auto">
                      <input type="hidden" name="sid" value={String(s._id)} />
                      <Button type="submit" variant="outline" size="sm">登出</Button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function MessagesPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const mdocs: R[] = data.mdocs || [];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h1 className="text-xl font-semibold">消息</h1>
      <Card>
        <CardContent className="p-0">
          {mdocs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">没有消息</p>
          ) : (
            <div className="divide-y">
              {mdocs.map((m: R) => (
                <div key={String(m._id)} className="p-3 text-sm">
                  <p className="font-medium">{m.from || '系统'}</p>
                  <p className="text-xs text-muted-foreground">{m.updateAt ? formatDateTime(m.updateAt, bs.locale) : '—'}</p>
                  <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
