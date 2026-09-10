import type { JSX, ReactNode } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import { parseSystemMessage } from './parse';
import type { MessageDoc } from './types';

export function renderMessageContent(message: MessageDoc, linkClassName: string): ReactNode {
  const system = parseSystemMessage(message.content);
  if (!system) return String(message.content || '');
  const parts: ReactNode[] = [];
  let cursor = 0;
  const regex = /\{([^{}]+)\}/g;
  for (let match = regex.exec(system.message); match; match = regex.exec(system.message)) {
    if (match.index > cursor) parts.push(system.message.slice(cursor, match.index));
    const key = match[1];
    const index = Number.parseInt(key.split(':')[0], 10);
    const param = String(system.params[index] || '');
    if (key.endsWith(':link') && param) {
      parts.push(
        <a key={`${match.index}-${key}`} href={param} className={linkClassName} target="_blank" rel="noreferrer">
          {param}
        </a>,
      );
    } else {
      parts.push(
        <span key={`${match.index}-${key}`} className="font-medium">
          {param}
        </span>,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < system.message.length) parts.push(system.message.slice(cursor));
  return parts;
}

export function MessageBody({ message, fromMe }: { message: MessageDoc; fromMe: boolean }): JSX.Element {
  const system = parseSystemMessage(message.content);
  if (system) {
    const linkClassName = fromMe
      ? 'font-medium underline underline-offset-2'
      : 'font-medium text-primary underline underline-offset-2';
    return <>{renderMessageContent(message, linkClassName)}</>;
  }
  return (
    <MarkdownView
      content={String(message.content || '')}
      className={
        fromMe
          ? 'text-sm leading-6 break-words [&_p]:my-0 [&_a]:underline [&_a]:text-primary-foreground'
          : 'text-sm leading-6 break-words [&_p]:my-0 [&_a]:underline [&_a]:text-primary'
      }
    />
  );
}
