import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeftRight, Cpu } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

// Phase 0 spike probe page. Paired with ecosystems/KryptonVigilSystem/Client/spike-webview.
// Loaded inside a Qt 6 QWebEngineView; uses QWebChannel to talk to the host.

declare global {
  interface Window {
    qt?: {
      webChannelTransport?: unknown;
    };
    QWebChannel?: new (transport: unknown, callback: (channel: { objects: Record<string, any> }) => void) => void;
  }
}

interface BridgeMessage {
  direction: 'from' | 'to';
  text: string;
  timestamp: string;
}

export function SpikeWebViewProbePage() {
  const [bridge, setBridge] = useState<any>(null);
  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [platformName, setPlatformName] = useState<string | null>(null);
  const channelLoadedRef = useRef(false);

  function log(direction: BridgeMessage['direction'], text: string) {
    setMessages((prev) => [
      ...prev.slice(-49),
      { direction, text, timestamp: new Date().toISOString().slice(11, 19) },
    ]);
  }

  useEffect(() => {
    if (channelLoadedRef.current) return;
    channelLoadedRef.current = true;

    function attach(QWebChannelCtor: any) {
      if (!window.qt?.webChannelTransport) {
        log('from', '[probe] window.qt.webChannelTransport not present — running outside Qt host');
        return;
      }
      // eslint-disable-next-line no-new
      new QWebChannelCtor(window.qt.webChannelTransport, (channel: any) => {
        const b = channel.objects.bridge;
        if (!b) {
          log('from', '[probe] bridge object not registered');
          return;
        }
        b.toWeb.connect((msg: string) => log('from', msg));
        setBridge(b);
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
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-2">
        <Cpu className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">WebView Spike Probe</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bridge controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={ping} disabled={!bridge}>Ping C++</Button>
          <Button onClick={readPlatform} disabled={!bridge} variant="outline">Read platform name</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="size-4" />
            Message log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-72 rounded-md border bg-muted/30 font-mono text-xs" viewportClassName="p-3">
            {messages.length === 0 ? (
              <p className="text-muted-foreground">(no messages yet — click a control above)</p>
            ) : (
              messages.map((m, i) => (
                <p
                  key={i}
                  className={m.direction === 'from' ? 'text-emerald-500' : 'text-blue-500'}
                >
                  [{m.timestamp}] {m.direction === 'from' ? '←' : '→'} {m.text}
                </p>
              ))
            )}
          </ScrollArea>
          {platformName ? (
            <p className="mt-3 text-xs text-muted-foreground">
              host platform: <code className="font-mono">{platformName}</code>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
