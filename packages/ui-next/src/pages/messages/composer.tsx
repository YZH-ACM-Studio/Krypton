import type * as React from 'react';
import type { JSX } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function MessageComposer(props: {
  draftRef: React.Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
}): JSX.Element {
  const { draftRef, value, onChange, onSend, sending, disabled } = props;
  const sendDisabled = !value.trim() || sending || Boolean(disabled);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      onSend();
      return;
    }
    if (event.shiftKey) return;
    const nativeInputEvent = event.nativeEvent;
    // IME confirmation uses keyCode 229 and isComposing; do not send until committed.
    if (nativeInputEvent.isComposing || nativeInputEvent.keyCode === 229) return;
    event.preventDefault();
    onSend();
  };

  return (
    <div className="space-y-2 border-t p-3">
      <Textarea
        ref={draftRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        disabled={disabled}
        placeholder="输入消息… Markdown · Enter 发送 · Shift+Enter 换行"
        className="min-h-[80px] resize-none"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">{value.length} 字符</span>
        <Button type="button" size="sm" disabled={sendDisabled} onClick={onSend}>
          <Send className="size-3.5" aria-hidden="true" />
          {sending ? '发送中…' : '发送'}
        </Button>
      </div>
    </div>
  );
}
