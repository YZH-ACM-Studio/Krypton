/**
 * EventDetailDialog — full payload + associated screenshot for a single event.
 *
 * Layout (CLIENT_PROCTOR_MONITORING_DESIGN §8.6):
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ 行为详情 · USB 插入                                         [✕] │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ 时间 / 类型 / severity / 次数 / 设备                            │
 *   │                                                                │
 *   │ ┌────── payload JSON ──────┐     ┌── associated screenshot ─┐  │
 *   │ │                          │     │                          │  │
 *   │ │                          │     │   click → fullscreen     │  │
 *   │ └──────────────────────────┘     └──────────────────────────┘  │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Clicking the thumbnail opens a fullscreen lightbox layered on top.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
// VigilDateTime adds the missing UTC marker before delegating to <DateTime/>.
// Required because vigil-server emits naive ISO strings.
import { VigilDateTime as DateTime } from '@/pages/vigil/timestamp';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { VigilStudentEvent } from '@/lib/vigil-api';
import { vigilScreenshotUrl, vigilThumbUrl } from '@/lib/vigil-api';
import { cn } from '@/lib/cn';

interface EventDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: VigilStudentEvent | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-muted text-muted-foreground',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  error: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  critical: 'bg-destructive/15 text-destructive',
};

// Event type / severity translation moved to ./i18n so the sheet's
// inline event list shares the same labels.
import { translateEventType as eventTypeLabel, translateSeverity } from '@/pages/vigil/i18n';

export function EventDetailDialog({
  open, onOpenChange, event,
}: EventDetailDialogProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (!event) return null;

  const sevClass = SEVERITY_COLORS[event.severity] || SEVERITY_COLORS.info;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="w-[90vw] max-w-[900px]"
          onClose={() => onOpenChange(false)}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>行为详情</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm font-normal">{eventTypeLabel(event.type)}</span>
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-4 p-5">
              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <Metric label="时间">
                  <DateTime value={event.ts} mode="both" />
                </Metric>
                <Metric label="类型">
                  <span>{eventTypeLabel(event.type)}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/70">{event.type}</span>
                </Metric>
                <Metric label="严重程度">
                  <Badge className={cn('h-5 text-[10px]', sevClass)}>
                    {translateSeverity(event.severity)}
                  </Badge>
                </Metric>
                <Metric label="次数">
                  {event.count > 1 ? `${event.count}（聚合）` : '1'}
                </Metric>
              </div>

              {event.count > 1 && (
                <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                  聚合时间窗：
                  <DateTime value={event.firstTs} mode="both" /> — <DateTime value={event.lastTs} mode="both" />
                </div>
              )}

              <p className="text-sm">{event.summary}</p>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Payload JSON */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payload</p>
                  <pre className="max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(event.payload || {}, null, 2)}
                  </pre>
                </div>

                {/* Associated screenshot */}
                {event.screenshotId ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      事件触发截屏
                    </p>
                    <button
                      type="button"
                      onClick={() => setLightboxOpen(true)}
                      className="block w-full overflow-hidden rounded-md border bg-muted/20 transition-shadow hover:shadow-md"
                    >
                      <img
                        src={vigilThumbUrl(event.screenshotId)}
                        alt={`截屏 ${event.screenshotId}`}
                        className="aspect-video w-full object-contain"
                        loading="lazy"
                      />
                    </button>
                    <p className="text-[10px] text-muted-foreground">点击查看大图</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      事件触发截屏
                    </p>
                    <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted/20 text-xs text-muted-foreground">
                      此事件未关联截屏
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {lightboxOpen && event.screenshotId && (
        <ScreenshotLightbox
          screenshotId={event.screenshotId}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/* ─── Fullscreen lightbox ──────────────────────────────────────────────── */

export function ScreenshotLightbox({
  screenshotId, onClose,
}: { screenshotId: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-black/95 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-white">
        <p className="font-mono text-[11px] text-white/70">{screenshotId}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-1 transition-colors hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <img
          src={vigilScreenshotUrl(screenshotId)}
          alt={`截屏 ${screenshotId}`}
          className="max-h-full max-w-full"
        />
      </div>
    </div>,
    document.body,
  );
}
