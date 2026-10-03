import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/display';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { ScrollArea } from '@/components/ui/scroll-area';

// Phase 0 spike probe page. Paired with ecosystems/KryptonVigilSystem/Client/spike-webview.
// Loaded inside a Qt 6 QWebEngineView; uses QWebChannel to talk to the host.

interface WebChannelBridge {
  toWeb: {
    connect(listener: (message: string) => void): void;
  };
  fromWeb(message: string): void;
  platformName(): Promise<string>;
}

interface WebChannel {
  objects: {
    bridge?: WebChannelBridge;
    [name: string]: unknown;
  };
}

type QWebChannelConstructor = new (transport: unknown, callback: (channel: WebChannel) => void) => unknown;

declare global {
  interface Window {
    qt?: {
      webChannelTransport?: unknown;
    };
    QWebChannel?: QWebChannelConstructor;
  }
}

interface BridgeMessage {
  direction: 'from' | 'to';
  text: string;
  timestamp: string;
}

export function SpikeWebViewProbePage() {
  const [bridge, setBridge] = useState<WebChannelBridge | null>(null);
  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [platformName, setPlatformName] = useState<string | null>(null);
  const channelLoadedRef = useRef(false);

  function log(direction: BridgeMessage['direction'], text: string) {
    setMessages((prev) => [...prev.slice(-49), { direction, text, timestamp: new Date().toISOString().slice(11, 19) }]);
  }

  useEffect(() => {
    if (channelLoadedRef.current) return;
    channelLoadedRef.current = true;

    function attach(QWebChannelCtor: QWebChannelConstructor) {
      if (!window.qt?.webChannelTransport) {
        log('from', '[probe] window.qt.webChannelTransport not present — running outside Qt host');
        return;
      }
      // eslint-disable-next-line no-new
      new QWebChannelCtor(window.qt.webChannelTransport, (channel) => {
        const next = channel.objects.bridge;
        if (!next) {
          log('from', '[probe] bridge object not registered');
          return;
        }
        next.toWeb.connect((msg: string) => log('from', msg));
        setBridge(next);
        log('from', '[probe] channel connected');
      });
    }

    if (window.QWebChannel) {
      attach(window.QWebChannel);
    } else {
      // Qt 6 ships qwebchannel.js at qrc://qtwebchannel/qwebchannel.js
      const script = document.createElement('script');
      script.src = 'qrc:///qtwebchannel/qwebchannel.js';
      script.onload = () => {
        if (window.QWebChannel) attach(window.QWebChannel);
        else log('from', '[probe] qwebchannel.js loaded but QWebChannel ctor missing');
      };
      script.onerror = () => log('from', '[probe] failed to load qwebchannel.js (likely not in Qt host)');
      document.head.appendChild(script);
    }
  }, []);

  function ping() {
    if (!bridge) return;
    log('to', 'ping');
    bridge.fromWeb('ping');
  }

  function readPlatform() {
    if (!bridge) return;
    bridge.platformName().then((name: string) => {
      setPlatformName(name);
      log('from', `platformName() = ${name}`);
    });
  }

  return (
    <Page width="wide">
      <PageHeader title="WebView Spike Probe" />

      <Panel title="Bridge controls">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={ping} disabled={!bridge}>
            Ping C++
          </Button>
          <Button type="button" variant="secondary" onClick={readPlatform} disabled={!bridge}>
            Read platform name
          </Button>
        </div>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <ArrowLeftRight className="size-4" />
            Message log
          </span>
        }
      >
        <ScrollArea className="max-h-72 rounded-md border border-line bg-surface-sunken font-mono text-xs" viewportClassName="p-3">
          {messages.length === 0 ? (
            <p className="text-fg-subtle">(no messages yet — click a control above)</p>
          ) : (
            messages.map((message, index) => (
              <p key={index} className={message.direction === 'from' ? 'break-all text-fg' : 'break-all text-fg-muted'}>
                [{message.timestamp}] {message.direction === 'from' ? '←' : '→'} {message.text}
              </p>
            ))
          )}
        </ScrollArea>
        {platformName ? (
          <p className="mt-3 text-xs text-fg-subtle">
            host platform: <Code>{platformName}</Code>
          </p>
        ) : null}
      </Panel>
    </Page>
  );
}
