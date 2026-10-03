import { useCallback, useState, type JSX } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel, loadDomainUsers } from '@/components/domain-user-search';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MultiSelect } from '@/components/ui/multi-select';

function presentUserSearchError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message.trim() : '';
  if (!raw || /^[a-z0-9_.:-]+$/i.test(raw)) return '用户搜索失败，请稍后重试。';
  return /[。！？]$/.test(raw) ? raw : `${raw}。`;
}

export function NewConversation(props: {
  domainId: string;
  selfUid: number;
  onPick: (user: { _id: number; uname?: string; avatarUrl?: string }) => void;
}): JSX.Element {
  const { domainId, selfUid, onPick } = props;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DomainUserOption[]>([]);
  const [error, setError] = useState('');

  const reset = () => {
    setSelected([]);
    setError('');
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const loadOptions = useCallback(
    async (query: string): Promise<DomainUserOption[]> => {
      try {
        const users = await loadDomainUsers(domainId, query);
        setError('');
        return users.filter((user) => user._id !== selfUid);
      } catch (cause) {
        console.error('[messages] User search failed', cause);
        setError(presentUserSearchError(cause));
        throw cause;
      }
    },
    [domainId, selfUid],
  );

  const selectedUser = selected[0];
  const canStart = selectedUser != null && selectedUser._id !== selfUid;

  const startConversation = () => {
    if (!selectedUser) {
      setError('请先选择一名用户。');
      return;
    }
    if (selectedUser._id === selfUid) {
      setError('不能给自己发消息。');
      return;
    }
    onPick({
      _id: selectedUser._id,
      uname: selectedUser.uname,
      avatarUrl: selectedUser.avatarUrl,
    });
    handleOpenChange(false);
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" aria-label="新会话" onClick={() => handleOpenChange(true)}>
        <MessageSquarePlus className="size-3.5" aria-hidden="true" />
        新会话
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {/* overflow-visible keeps the absolute MultiSelect popover from clipping */}
        <DialogContent className="overflow-visible" onClose={() => handleOpenChange(false)}>
          <DialogHeader>
            <DialogTitle>新会话</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 p-5">
            <p className="text-sm text-fg-muted">输入对方的 UID、用户名、学号或姓名进行搜索，选中一名用户后点击「开始」即可打开会话。</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-fg-subtle">收件人</label>
              <MultiSelect<DomainUserOption>
                value={selected}
                onChange={(next) => {
                  const filtered = next.filter((user) => user._id !== selfUid);
                  setSelected(filtered);
                  if (filtered.length !== next.length) setError('不能给自己发消息。');
                  else if (filtered.length) setError('');
                }}
                loadOptions={loadOptions}
                getKey={(item) => String(item._id)}
                getLabel={domainUserSearchLabel}
                renderChip={(item) => <span>{item.displayName || item.uname || `UID ${item._id}`}</span>}
                renderOption={(item) => <DomainUserSearchOption user={item} />}
                maxItems={1}
                minHeight={44}
                placeholder="搜索 UID / 用户名 / 学号 / 姓名"
                emptyText="没有找到用户"
              />
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                取消
              </Button>
              <Button type="button" variant="primary" disabled={!canStart} onClick={startConversation}>
                开始
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
