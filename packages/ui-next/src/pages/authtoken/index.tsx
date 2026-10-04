import { useEffect, useRef, useState } from 'react';
import { KeyRound, Plus, Copy, Check, Trash2, RefreshCw, Pencil } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { AdminPage } from '@/components/admin/admin-page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { alertDialog, confirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DateTime } from '@/components/ui/datetime';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { Spinner } from '@/components/ui/display';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

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

/**
 * JSON envelope from the auth-token handler. `issue` returns `{ token, doc }`;
 * `update` / `renew` / `revoke` return `{ ok }`. Failures carry an `error`
 * payload that is either a bare string or `{ message }` — typed as an
 * intersection so both access paths below typecheck without runtime narrowing.
 */
interface PostOpResponse {
  token?: string;
  ok?: boolean;
  error?: string & { message?: string };
  [key: string]: unknown;
}

/** Best-effort `.message` access on a caught value without assuming an Error instance. */
interface ErrorLike {
  message?: unknown;
}

/** POST an operation to the auth-token handler; returns parsed JSON, throws on failure. */
async function postOp(fields: Record<string, string>): Promise<PostOpResponse> {
  const resp = await fetchHydroResponse(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: new URLSearchParams(fields),
  });
  if (!resp.ok) throw new Error(await readHydroResponseError(resp, '令牌操作失败'));
  const json: PostOpResponse = await resp.json().catch(() => ({}));
  return json;
}

function tokenStatus(t: AuthTokenRow): {
  label: string;
  tone: 'danger' | 'warning' | 'success';
} {
  if (t.revoked) return { label: '已撤销', tone: 'danger' };
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) {
    return { label: '已过期', tone: 'warning' };
  }
  return { label: '有效', tone: 'success' };
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
      const tok = json.token;
      reset();
      onIssued(tok);
    } catch (e) {
      setError(String((e as ErrorLike)?.message || e));
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
      <DialogContent size="lg" onClose={close}>
        <DialogHeader>
          <DialogTitle>签发访问令牌</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium">
              频道 <span className="text-danger-fg">*</span>
            </div>
            <div className="space-y-2">
              {CHANNELS.map((c) => (
                <label key={c.key} htmlFor={`kat-ch-${c.key}`} className="flex cursor-pointer items-start gap-2">
                  <Checkbox id={`kat-ch-${c.key}`} checked={!!channels[c.key]} onCheckedChange={(v) => setChannels((p) => ({ ...p, [c.key]: v }))} />
                  <span className="min-w-0">
                    <span className="font-mono text-sm">{c.label}</span>
                    <span className="block text-xs text-fg-subtle">{c.hint}</span>
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

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </DialogBody>
        <DialogFooter className="border-t">
          <Button type="button" variant="ghost" onClick={close}>
            取消
          </Button>
          <Button type="button" variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? <Spinner /> : <KeyRound />} {busy ? '签发中…' : '签发'}
          </Button>
        </DialogFooter>
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
      <DialogContent size="md" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>令牌已签发</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Alert tone="danger">此令牌只显示这一次,关闭后无法再次查看,请立即复制保存。</Alert>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-md border border-line bg-surface-sunken px-3 py-2 font-mono text-sm">{token}</code>
            <Button type="button" variant="secondary" size="sm" iconOnly className="shrink-0" onClick={() => void copy()} aria-label="复制">
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">
            在客户端 / 调用方的 <span className="font-mono">X-Service-Token</span> 请求头中粘贴此令牌。
          </p>
        </DialogBody>
        <DialogFooter className="border-t">
          <Button type="button" variant="primary" onClick={onClose}>我已复制,关闭</Button>
        </DialogFooter>
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
    } catch (e) {
      setError(String((e as ErrorLike)?.message || e));
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
      <DialogContent size="sm" onClose={close}>
        <DialogHeader>
          <DialogTitle>续期 / 改有效期</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="truncate font-mono text-sm text-fg-muted">{target?.display}</p>
          <FormField label="从现在起有效天数" htmlFor="kat-renew">
            <Input
              id="kat-renew"
              inputMode="numeric"
              placeholder="留空 / 0 = 永不过期"
              value={expireDays}
              onChange={(e) => setExpireDays(e.target.value)}
            />
          </FormField>
          <p className="text-xs text-fg-subtle">已撤销的令牌无法续期(请重新签发)。</p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </DialogBody>
        <DialogFooter className="border-t">
          <Button type="button" variant="ghost" onClick={close}>
            取消
          </Button>
          <Button type="button" variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : null}{busy ? '提交中…' : '确认'}
          </Button>
        </DialogFooter>
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
    } catch (e) {
      setError(String((e as ErrorLike)?.message || e));
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
      <DialogContent size="lg" onClose={close}>
        <DialogHeader>
          <DialogTitle>编辑令牌权限范围</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <p className="truncate font-mono text-sm text-fg-muted">{target?.display}</p>
          <div className="space-y-2">
            <div className="text-sm font-medium">
              频道 <span className="text-danger-fg">*</span>
            </div>
            <div className="space-y-2">
              {CHANNELS.map((c) => (
                <label key={c.key} htmlFor={`kat-ed-${c.key}`} className="flex cursor-pointer items-start gap-2">
                  <Checkbox id={`kat-ed-${c.key}`} checked={!!channels[c.key]} onCheckedChange={(v) => setChannels((p) => ({ ...p, [c.key]: v }))} />
                  <span className="min-w-0">
                    <span className="font-mono text-sm">{c.label}</span>
                    <span className="block text-xs text-fg-subtle">{c.hint}</span>
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

          <p className="text-xs text-fg-subtle">绑定用户与密钥明文不变;仅调整频道与数据范围,保存后立即生效。</p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </DialogBody>
        <DialogFooter className="border-t">
          <Button type="button" variant="ghost" onClick={close}>
            取消
          </Button>
          <Button type="button" variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? <Spinner /> : <Pencil />} {busy ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
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
  const revoking = useRef(false);
  const revokeToken = async (t: AuthTokenRow) => {
    if (t.revoked || revoking.current) return;
    revoking.current = true;
    try {
      const confirmed = await confirmDialog(
        `确认撤销 ${t.display}${t.label ? `(${t.label})` : ''}？撤销立即生效且不可恢复,如需重新授权请重新签发。`,
        { destructive: true, confirmLabel: '撤销', title: `撤销 ${t.display}？` },
      );
      if (!confirmed) {
        revoking.current = false;
        return;
      }
      await postOp({ operation: 'revoke', id: t._id });
      window.location.reload();
    } catch (error) {
      revoking.current = false;
      const message = error instanceof Error ? error.message : String((error as ErrorLike)?.message || error);
      await alertDialog(message);
    }
  };
  const columns: Column<AuthTokenRow>[] = [
    {
      key: 'token',
      header: '令牌',
      stackRole: 'title',
      cell: (token) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-sm">{token.display}</div>
          {token.label ? <div className="truncate text-xs text-fg-subtle">{token.label}</div> : null}
          <p className="mt-1 truncate text-xs font-normal text-fg-subtle md:hidden">
            绑定用户 {token.uid != null ? `${unames[token.uid] || `UID ${token.uid}`} #${token.uid}` : '服务令牌'}
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 md:hidden">
            <span className="text-xs font-normal text-fg-subtle">频道</span>
            {token.channels.map((channel) => (
              <Badge key={channel} variant="outline"><span className="font-mono">{channel}</span></Badge>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'user',
      header: '绑定用户',
      stackRole: 'hidden',
      cell: (token) => (token.uid != null ? (
        <span className="block max-w-64 truncate">
          {unames[token.uid] || `UID ${token.uid}`} <span className="text-xs text-fg-subtle">#{token.uid}</span>
        </span>
      ) : (
        <span className="text-fg-subtle">服务令牌</span>
      )),
    },
    {
      key: 'channels',
      header: '频道',
      stackRole: 'hidden',
      cell: (token) => (
        <div className="flex flex-wrap gap-1">
          {token.channels.map((channel) => (
            <Badge key={channel} variant="outline"><span className="font-mono">{channel}</span></Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'scope',
      header: '数据范围',
      cell: (token) => scopeSummary(token),
    },
    {
      key: 'status',
      header: '状态',
      stackRole: 'meta',
      cell: (token) => {
        const status = tokenStatus(token);
        return <Badge tone={status.tone}>{status.label}</Badge>;
      },
    },
    {
      key: 'used',
      header: '最近使用',
      cell: (token) => <DateTime value={token.lastUsedAt} mode="relative" fallback="从未" />,
    },
    {
      key: 'expires',
      header: '到期',
      cell: (token) => (token.expiresAt ? <DateTime value={token.expiresAt} mode="datetime" /> : <span className="text-fg-subtle">永不过期</span>),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      cell: (t) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={t.revoked} onClick={() => setEditTarget(t)}>
            <Pencil /> 编辑
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={t.revoked} onClick={() => setRenewTarget(t)}>
            <RefreshCw /> 续期
          </Button>
          <Button
            type="button"
            variant="danger-soft"
            size="sm"
            disabled={t.revoked}
            onClick={() => void revokeToken(t)}
          >
            <Trash2 /> 撤销
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="访问令牌"
      description="签发、撤销、续期 Krypton 访问令牌(KAT)。令牌绑定到 Hydro 用户、复用其权限,并按频道与数据范围收敛。明文仅在签发时显示一次。"
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      contentClassName="min-w-0"
      actions={
        <Button type="button" variant="primary" onClick={() => setIssueOpen(true)}>
          <Plus /> 签发令牌
        </Button>
      }
    >
      <Panel flush>
        <DataTable
          mobile="stack"
          columns={columns}
          rows={tokens}
          rowKey={(token) => token._id}
          empty={<EmptyState compact title="暂无令牌,点击右上角「签发令牌」创建。" />}
        />
      </Panel>

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
    </AdminPage>
  );
}
