import { useState, useEffect } from 'react';
import { KeyRound, Plus, Copy, Check, Trash2, RefreshCw, Pencil } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { AdminPage } from '@/components/admin/admin-page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DateTime } from '@/components/ui/datetime';

// ── sidebar nav (registered at module load — read by AdminSidebar) ──────────
registerAdminNavSection({
  key: 'authtoken',
  label: '访问令牌',
  order: 31,
  requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
  items: [
    {
      key: 'tokens',
      label: '令牌管理',
      href: '/admin/authtoken',
      icon: KeyRound,
      templateNames: ['admin_authtoken.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
  ],
});

// User-bound auth-token channels. `vigil` is intentionally omitted: it is a
// service-token channel (a separate store, validated via requireServiceToken),
// so an authtoken.tokens row with channels:['vigil'] would NOT authenticate the
// vigil path — offering it here would mislead.
const CHANNELS: { key: string; label: string; hint: string }[] = [
  { key: 'crawler', label: 'crawler', hint: '爬题入库 · 需绑定用户的建题权限' },
  { key: 'tagger', label: 'tagger', hint: '题目标签 / 标题批量编辑 + 题库体检 · 需改题权限(体检还需看隐藏题权限)' },
  { key: 'scores', label: 'scores', hint: '天梯赛 / PAT / CSP 分数录入 · 受可录年份限定' },
  { key: 'judge', label: 'judge', hint: '评测救火台 · 队列监控 / 批量重判 · 需重判权限' },
  { key: 'contest', label: 'contest', hint: '比赛运营 · 克隆建赛 / 封解榜 / 导出榜单 · 需比赛编辑权限(导榜还需看用户私密信息权限)' },
];

interface AuthTokenRow {
  _id: string;
  display: string;
  uid: number | null;
  channels: string[];
  scopeFilters: { years?: number[]; [k: string]: unknown };
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
}

interface PageData {
  tokens: AuthTokenRow[];
  unames: Record<number, string>;
}

const ENDPOINT = '/admin/authtoken';

/** POST an operation to the auth-token handler; returns parsed JSON, throws on failure. */
async function postOp(fields: Record<string, string>): Promise<any> {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: new URLSearchParams(fields),
  });
  const json = await resp.json().catch(() => ({}) as any);
  if (!resp.ok) {
    throw new Error(json?.error?.message || json?.error || `请求失败 (${resp.status})`);
  }
  return json;
}

function tokenStatus(t: AuthTokenRow): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (t.revoked) return { label: '已撤销', variant: 'destructive' };
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) {
    return { label: '已过期', variant: 'secondary' };
  }
  return { label: '有效', variant: 'default' };
}

function scopeSummary(t: AuthTokenRow): string {
  const ys = t.scopeFilters?.years;
  if (Array.isArray(ys) && ys.length) return `年份 ${ys.join(' / ')}`;
  return '不限';
}

// ── Issue dialog ────────────────────────────────────────────────────────────
function IssueDialog({ open, onClose, onIssued }: { open: boolean; onClose: () => void; onIssued: (token: string) => void }) {
  const [channels, setChannels] = useState<Record<string, boolean>>({});
  const [uid, setUid] = useState('');
  const [label, setLabel] = useState('');
  const [years, setYears] = useState('');
  const [expireDays, setExpireDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = Object.keys(channels).filter((k) => channels[k]);
  const uidNum = Number.parseInt(uid.trim(), 10);
  const uidValid = uid.trim() !== '' && Number.isSafeInteger(uidNum) && uidNum > 0;
  const canSubmit = selected.length > 0 && uidValid && !busy;

  const reset = () => {
    setChannels({});
    setUid('');
    setLabel('');
    setYears('');
    setExpireDays('');
    setError(null);
    setBusy(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const fields: Record<string, string> = {
        operation: 'issue',
        channels: selected.join(','),
        uid: String(uidNum),
      };
      if (label.trim()) fields.label = label.trim();
      if (expireDays.trim()) fields.expireDays = expireDays.trim();
      const ys = years
        .split(/[\s,，、]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (ys.length) fields.years = ys.join(',');
      const json = await postOp(fields);
      if (!json?.token) throw new Error('服务器未返回令牌');
      const tok = json.token as string;
      reset();
      onIssued(tok);
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="w-full sm:w-[560px]" onClose={close}>
        <DialogHeader>
          <DialogTitle>签发访问令牌</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4 px-5 py-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">
              频道 <span className="text-destructive">*</span>
            </div>
            <div className="space-y-2">
              {CHANNELS.map((c) => (
                <label key={c.key} htmlFor={`kat-ch-${c.key}`} className="flex cursor-pointer items-start gap-2">
                  <Checkbox id={`kat-ch-${c.key}`} checked={!!channels[c.key]} onCheckedChange={(v) => setChannels((p) => ({ ...p, [c.key]: v }))} />
                  <span className="leading-tight">
                    <span className="font-mono text-sm">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <FormField
            label="绑定用户 UID"
            required
            htmlFor="kat-uid"
            hint="令牌以该用户身份鉴权(实际权限 = 用户权限 ∩ 频道 ∩ 数据范围)。crawler / tagger / scores 必须绑定用户。"
          >
            <Input id="kat-uid" inputMode="numeric" placeholder="如 2(root)" value={uid} onChange={(e) => setUid(e.target.value)} />
          </FormField>

          <FormField label="备注" htmlFor="kat-label">
            <Input id="kat-label" placeholder="如 张三的爬题工具" value={label} onChange={(e) => setLabel(e.target.value)} />
          </FormField>

          <FormField label="可录年份" htmlFor="kat-years" hint="仅约束 scores 频道可录入的年级;留空 = 不限年份。">
            <Input id="kat-years" placeholder="留空 = 不限;多个用逗号,如 2024,2025" value={years} onChange={(e) => setYears(e.target.value)} />
          </FormField>

          <FormField label="有效天数" htmlFor="kat-exp">
            <Input
              id="kat-exp"
              inputMode="numeric"
              placeholder="留空 / 0 = 永不过期"
              value={expireDays}
              onChange={(e) => setExpireDays(e.target.value)}
            />
          </FormField>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <KeyRound /> {busy ? '签发中…' : '签发'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── One-time token reveal ─────────────────────────────────────────────────────
function RevealDialog({ token, onClose }: { token: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable; the field is select-all as a fallback */
    }
  };
  return (
    <Dialog
      open={!!token}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="w-full sm:w-[560px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>令牌已签发</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm font-medium text-destructive">此令牌只显示这一次,关闭后无法再次查看,请立即复制保存。</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">{token}</code>
            <Button variant="outline" size="icon" onClick={copy} aria-label="复制">
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            在客户端 / 调用方的 <span className="font-mono">X-Service-Token</span> 请求头中粘贴此令牌。
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button onClick={onClose}>我已复制,关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Renew dialog ──────────────────────────────────────────────────────────────
function RenewDialog({ target, onClose }: { target: AuthTokenRow | null; onClose: () => void }) {
  const [expireDays, setExpireDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setExpireDays('');
    setError(null);
    setBusy(false);
    onClose();
  };
  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const fields: Record<string, string> = { operation: 'renew', id: target._id };
      if (expireDays.trim()) fields.expireDays = expireDays.trim();
      await postOp(fields);
      window.location.reload();
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!target}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="w-full sm:w-[460px]" onClose={close}>
        <DialogHeader>
          <DialogTitle>续期 / 改有效期</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <p className="font-mono text-sm text-muted-foreground">{target?.display}</p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="kat-renew">
              从现在起有效天数
            </label>
            <Input
              id="kat-renew"
              inputMode="numeric"
              placeholder="留空 / 0 = 永不过期"
              value={expireDays}
              onChange={(e) => setExpireDays(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">已撤销的令牌无法续期(请重新签发)。</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? '提交中…' : '确认'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Revoke confirm ────────────────────────────────────────────────────────────
function RevokeDialog({ target, onClose }: { target: AuthTokenRow | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    setBusy(false);
    onClose();
  };
  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await postOp({ operation: 'revoke', id: target._id });
      window.location.reload();
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!target}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="w-full sm:w-[460px]" onClose={close}>
        <DialogHeader>
          <DialogTitle>撤销令牌</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 px-5 py-4">
          <p className="text-sm">
            确认撤销 <span className="font-mono">{target?.display}</span>
            {target?.label ? `(${target.label})` : ''}?
          </p>
          <p className="text-sm text-destructive">撤销立即生效且不可恢复,如需重新授权请重新签发。</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            <Trash2 /> {busy ? '撤销中…' : '撤销'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog (channels / data-scope / label of an issued token) ────────────
function EditDialog({ target, onClose }: { target: AuthTokenRow | null; onClose: () => void }) {
  const [channels, setChannels] = useState<Record<string, boolean>>({});
  const [label, setLabel] = useState('');
  const [years, setYears] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // prefill from the target token whenever it changes
  useEffect(() => {
    if (!target) return;
    const ch: Record<string, boolean> = {};
    target.channels.forEach((c) => {
      ch[c] = true;
    });
    setChannels(ch);
    setLabel(target.label || '');
    const ys = target.scopeFilters?.years;
    setYears(Array.isArray(ys) ? ys.join(',') : '');
    setError(null);
    setBusy(false);
  }, [target]);

  const selected = Object.keys(channels).filter((k) => channels[k]);
  const canSubmit = selected.length > 0 && !busy;
  const close = () => {
    setError(null);
    setBusy(false);
    onClose();
  };
  const submit = async () => {
    if (!target || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const ys = years
        .split(/[\s,，、]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await postOp({
        operation: 'update',
        id: target._id,
        channels: selected.join(','),
        label: label.trim(),
        years: ys.join(','),
      });
      window.location.reload();
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!target}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="w-full sm:w-[560px]" onClose={close}>
        <DialogHeader>
          <DialogTitle>编辑令牌权限范围</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <p className="font-mono text-sm text-muted-foreground">{target?.display}</p>
          <div className="space-y-2">
            <div className="text-sm font-medium">
              频道 <span className="text-destructive">*</span>
            </div>
            <div className="space-y-2">
              {CHANNELS.map((c) => (
                <label key={c.key} htmlFor={`kat-ed-${c.key}`} className="flex cursor-pointer items-start gap-2">
                  <Checkbox id={`kat-ed-${c.key}`} checked={!!channels[c.key]} onCheckedChange={(v) => setChannels((p) => ({ ...p, [c.key]: v }))} />
                  <span className="leading-tight">
                    <span className="font-mono text-sm">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <FormField label="备注" htmlFor="kat-ed-label">
            <Input id="kat-ed-label" placeholder="如 张三的运维令牌" value={label} onChange={(e) => setLabel(e.target.value)} />
          </FormField>

          <FormField label="可录年份" htmlFor="kat-ed-years" hint="仅约束 scores 频道;留空 = 不限。保存会整体替换数据范围。">
            <Input id="kat-ed-years" placeholder="留空 = 不限;多个用逗号,如 2024,2025" value={years} onChange={(e) => setYears(e.target.value)} />
          </FormField>

          <p className="text-xs text-muted-foreground">绑定用户与密钥明文不变;仅调整频道与数据范围,保存后立即生效。</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <Pencil /> {busy ? '保存中…' : '保存'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdminAuthTokenPage() {
  const bs = useBootstrap();
  const data = (bs.page.data || {}) as Partial<PageData>;
  const tokens = data.tokens || [];
  const unames = data.unames || {};

  const [issueOpen, setIssueOpen] = useState(false);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<AuthTokenRow | null>(null);
  const [renewTarget, setRenewTarget] = useState<AuthTokenRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AuthTokenRow | null>(null);

  return (
    <AdminPage
      title="访问令牌"
      description="签发、撤销、续期 Krypton 访问令牌(KAT)。令牌绑定到 Hydro 用户、复用其权限,并按频道与数据范围收敛。明文仅在签发时显示一次。"
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      actions={
        <Button onClick={() => setIssueOpen(true)}>
          <Plus /> 签发令牌
        </Button>
      }
    >
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>令牌</TableHead>
                <TableHead>绑定用户</TableHead>
                <TableHead>频道</TableHead>
                <TableHead>数据范围</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近使用</TableHead>
                <TableHead>到期</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    暂无令牌,点击右上角「签发令牌」创建。
                  </TableCell>
                </TableRow>
              ) : (
                tokens.map((t) => {
                  const st = tokenStatus(t);
                  return (
                    <TableRow key={t._id}>
                      <TableCell>
                        <div className="font-mono text-sm">{t.display}</div>
                        {t.label && <div className="text-xs text-muted-foreground">{t.label}</div>}
                      </TableCell>
                      <TableCell>
                        {t.uid != null ? (
                          <span>
                            {unames[t.uid] || `UID ${t.uid}`} <span className="text-xs text-muted-foreground">#{t.uid}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">服务令牌</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {t.channels.map((c) => (
                            <Badge key={c} variant="secondary" className="font-mono">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{scopeSummary(t)}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <DateTime value={t.lastUsedAt} mode="relative" fallback="从未" />
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.expiresAt ? <DateTime value={t.expiresAt} mode="datetime" /> : <span className="text-muted-foreground">永不过期</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" disabled={t.revoked} onClick={() => setEditTarget(t)}>
                            <Pencil /> 编辑
                          </Button>
                          <Button variant="ghost" size="sm" disabled={t.revoked} onClick={() => setRenewTarget(t)}>
                            <RefreshCw /> 续期
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={t.revoked}
                            onClick={() => setRevokeTarget(t)}
                          >
                            <Trash2 /> 撤销
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <IssueDialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        onIssued={(tok) => {
          setIssueOpen(false);
          setRevealToken(tok);
        }}
      />
      <RevealDialog
        token={revealToken}
        onClose={() => {
          setRevealToken(null);
          window.location.reload();
        }}
      />
      <EditDialog target={editTarget} onClose={() => setEditTarget(null)} />
      <RenewDialog target={renewTarget} onClose={() => setRenewTarget(null)} />
      <RevokeDialog target={revokeTarget} onClose={() => setRevokeTarget(null)} />
    </AdminPage>
  );
}
