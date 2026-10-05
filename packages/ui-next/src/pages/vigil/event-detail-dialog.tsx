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
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
// VigilDateTime adds the missing UTC marker before delegating to <DateTime/>.
// Required because vigil-server emits naive ISO strings.
import { VigilDateTime as DateTime } from '@/pages/vigil/timestamp';
import type { VigilStudentEvent } from '@/lib/vigil-api';
import { vigilScreenshotUrl, vigilThumbUrl } from '@/lib/vigil-api';
// Event type / severity translation moved to ./i18n so the sheet's
// inline event list shares the same labels.
import { translateEventType as eventTypeLabel, translateSeverity } from '@/pages/vigil/i18n';

interface EventDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: VigilStudentEvent | null;
}

const SEVERITY_TONE: Record<string, BadgeTone> = {
  info: 'neutral',
  warning: 'warning',
  error: 'orange',
  critical: 'danger',
};

export function EventDetailDialog({ open, onOpenChange, event }: EventDetailDialogProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (!event) return null;

  const severityTone = SEVERITY_TONE[event.severity] ?? 'neutral';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="xl" onClose={() => onOpenChange(false)}>
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2">
              <span className="shrink-0">行为详情</span>
              <span className="text-fg-subtle">·</span>
              <span className="min-w-0 truncate text-sm font-normal">{eventTypeLabel(event.type)}</span>
            </DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
              <Metric label="时间">
                <DateTime value={event.ts} mode="both" />
              </Metric>
              <Metric label="类型">
                <span className="min-w-0 break-all">{eventTypeLabel(event.type)}</span>
                <span className="ml-1.5 break-all font-mono text-2xs text-fg-subtle">{event.type}</span>
              </Metric>
              <Metric label="严重程度">
                <Badge tone={severityTone} size="sm">{translateSeverity(event.severity)}</Badge>
              </Metric>
              <Metric label="次数">{event.count > 1 ? `${event.count}（聚合）` : '1'}</Metric>
            </div>

            {event.count > 1 && (
              <div className="rounded-md border border-line bg-surface-sunken p-3 text-xs text-fg-muted">
                聚合时间窗：
                <DateTime value={event.firstTs} mode="both" /> — <DateTime value={event.lastTs} mode="both" />
              </div>
            )}

            <p className="text-sm text-fg">{event.summary}</p>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs font-medium tracking-wider text-fg-subtle uppercase">Payload</p>
                <pre className="max-h-72 overflow-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-2xs">
                  {JSON.stringify(event.payload || {}, null, 2)}
                </pre>
              </div>

              {event.screenshotId ? (
                <div className="min-w-0 space-y-1.5">
                  <p className="text-xs font-medium text-fg-subtle">事件触发截屏</p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setLightboxOpen(true)}
                    className="h-auto! w-full overflow-hidden p-0"
                  >
                    <img
                      src={vigilThumbUrl(event.screenshotId)}
                      alt={`截屏 ${event.screenshotId}`}
                      className="aspect-video w-full object-contain"
                      loading="lazy"
                    />
                  </Button>
                  <p className="text-2xs text-fg-subtle">点击查看大图</p>
                </div>
              ) : (
                <div className="min-w-0 space-y-1.5">
                  <p className="text-xs font-medium text-fg-subtle">事件触发截屏</p>
                  <div className="flex aspect-video w-full items-center justify-center rounded-md border border-line bg-surface-sunken px-3 text-center text-xs text-fg-muted">
                    此事件未关联截屏
                  </div>
                </div>
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {lightboxOpen && event.screenshotId && <ScreenshotLightbox screenshotId={event.screenshotId} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-2xs text-fg-subtle">{label}</p>
      <div className="min-w-0 break-all text-sm">{children}</div>
    </div>
  );
}

/* ─── Fullscreen lightbox ──────────────────────────────────────────────── */

export function ScreenshotLightbox({ screenshotId, onClose }: { screenshotId: string; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="full" onClose={onClose}>
        <DialogHeader onClick={onClose}>
          <DialogTitle className="truncate font-mono text-sm font-normal">{screenshotId}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex items-center justify-center bg-surface-sunken" onClick={(event) => event.stopPropagation()}>
          <img src={vigilScreenshotUrl(screenshotId)} alt={`截屏 ${screenshotId}`} className="max-h-full max-w-full" />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
