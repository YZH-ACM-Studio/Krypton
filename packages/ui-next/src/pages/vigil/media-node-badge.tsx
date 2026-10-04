import { useEffect, useState, type ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/menu';
import { getMediaNodes, type VigilMediaNode, type VigilMediaNodes } from '@/lib/vigil-api';

const POLL_MS = 15_000;
const EMPTY_VALUE = '\u2014';

type MediaNodeSnapshot =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'ready'; data: VigilMediaNodes };

function healthTone(healthy: number, total: number): BadgeTone {
  if (healthy === total && total > 0) return 'success';
  if (healthy === 0) return 'danger';
  return 'warning';
}

function nodeStatus(node: VigilMediaNode): string {
  if (node.registered === false) return '已离线';
  if (node.apiReachable === false) return 'API 不可达';
  return '正常';
}

function streamLabel(streams: number | null): string {
  if (streams === null) return EMPTY_VALUE;
  return `${streams} 路`;
}

function cpuLabel(cpuPercent: number | null): string {
  if (cpuPercent === null) return EMPTY_VALUE;
  return `CPU ${cpuPercent}%`;
}

function useMediaNodeSnapshot(): MediaNodeSnapshot {
  const [snapshot, setSnapshot] = useState<MediaNodeSnapshot>({ kind: 'pending' });

  useEffect(() => {
    let active = true;
    let generation = 0;

    const pull = () => {
      const request = generation + 1;
      generation = request;
      void getMediaNodes().then(
        (data) => {
          if (!active || generation !== request) return;
          setSnapshot({ kind: 'ready', data });
        },
        () => {
          if (!active || generation !== request) return;
          setSnapshot({ kind: 'failed' });
        },
      );
    };

    pull();
    const timer = window.setInterval(pull, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return snapshot;
}

function MediaNodePopover({ tone, label, children }: { tone: BadgeTone; label: string; children: ReactNode }) {
  return (
    <Popover
      placement="bottom-end"
      className="w-72"
      trigger={(props) => (
        <Button {...props} type="button" variant="ghost"><Badge tone={tone}>{label}</Badge></Button>
      )}
    >
      {children}
    </Popover>
  );
}

function MediaNodeList({ nodes }: { nodes: VigilMediaNode[] }) {
  if (nodes.length === 0) {
    return <p className="px-3 py-2 text-sm text-fg">没有已注册的媒体节点</p>;
  }
  return (
    <ul className="divide-y divide-line-subtle">
      {nodes.map((node, index) => (
        <li key={`${node.serverId}:${node.deviceId}:${node.ip}:${index}`} className="flex flex-col gap-0.5 px-3 py-2">
          <span className="truncate text-sm font-medium text-fg">{node.deviceId || node.serverId}</span>
          <span className="truncate text-xs text-fg-muted">{node.ip}</span>
          <span className="text-xs text-fg">{nodeStatus(node)}</span>
          <span className="text-xs text-fg-muted">{streamLabel(node.streams)}</span>
          <span className="text-xs text-fg-muted">{cpuLabel(node.cpuPercent)}</span>
        </li>
      ))}
    </ul>
  );
}

export function MediaNodeBadge() {
  const snapshot = useMediaNodeSnapshot();
  if (snapshot.kind === 'pending') return null;
  if (snapshot.kind === 'ready' && snapshot.data.configured === false) return null;
  if (snapshot.kind === 'failed' || snapshot.data.error === 'redis_unavailable') {
    return (
      <MediaNodePopover tone="warning" label="媒体节点状态未知">
        <p className="px-3 py-2 text-sm text-fg">无法读取媒体节点状态</p>
      </MediaNodePopover>
    );
  }
  return (
    <MediaNodePopover tone={healthTone(snapshot.data.healthy, snapshot.data.total)} label={`媒体节点 ${snapshot.data.healthy}/${snapshot.data.total} 正常`}>
      <MediaNodeList nodes={snapshot.data.nodes} />
    </MediaNodePopover>
  );
}
