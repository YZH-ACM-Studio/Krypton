import * as React from 'react';
import { Check, Copy, Download, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { type DesignParams, FONTS, type FontKey, tokensToCss } from '@/design/tokens';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { SimpleSelect } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { RangeInput } from './range';
import type { ThemePref } from './state';

const BRAND_PRESETS: { name: string; hue: number; chroma: number }[] = [
  { name: 'Indigo', hue: 268, chroma: 0.17 },
  { name: 'Cobalt', hue: 255, chroma: 0.18 },
  { name: 'Azure', hue: 235, chroma: 0.15 },
  { name: 'Teal', hue: 190, chroma: 0.12 },
  { name: 'Jade', hue: 165, chroma: 0.13 },
  { name: 'Violet', hue: 295, chroma: 0.18 },
  { name: 'Crimson', hue: 15, chroma: 0.19 },
  { name: 'Graphite', hue: 268, chroma: 0.02 },
];

const NEUTRAL_PRESETS: { name: string; hue: number; tint: number }[] = [
  { name: '纯灰', hue: 0, tint: 0 },
  { name: '冷灰', hue: 268, tint: 0.006 },
  { name: '蓝灰', hue: 245, tint: 0.014 },
  { name: '暖灰', hue: 70, tint: 0.008 },
];

function isFontKey(value: string): value is FontKey {
  return value === 'mona' || value === 'inter' || value === 'instrument' || value === 'plex' || value === 'onest' || value === 'system';
}

function writeClipboard(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return Promise.reject(new TypeError('Clipboard API is unavailable'));
  }
  return clipboard.writeText(text);
}

function clipboardFailure(error: unknown): string {
  return error instanceof Error ? error.message : 'Clipboard write failed';
}

function Row({ label, value, children }: { label: string; value?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        {value !== undefined ? <span className="font-mono text-2xs text-fg-subtle">{value}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function Tuner({
  params,
  setParams,
  theme,
  setTheme,
  reset,
}: {
  params: DesignParams;
  setParams: (patch: Partial<DesignParams>) => void;
  theme: ThemePref;
  setTheme: (next: ThemePref) => void;
  reset: () => void;
}) {
  const [exportOpen, setExportOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const css = tokensToCss(params);
  const neutral = NEUTRAL_PRESETS.find((item) => item.hue === params.neutralHue && item.tint === params.neutralTint)?.name ?? '';

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-fg">调参台</div>
          <div className="text-2xs text-fg-subtle">所有改动实时作用于整页与视口预览</div>
        </div>
        <SimpleTooltip content="重置">
          <Button type="button" variant="ghost" size="sm" iconOnly aria-label="重置" onClick={reset}>
            <RotateCcw />
          </Button>
        </SimpleTooltip>
      </div>

      <Row label="主题">
        <MiniTabs<ThemePref>
          className="w-full"
          fullWidth
          size="sm"
          aria-label="主题"
          value={theme}
          onValueChange={setTheme}
          items={[
            { value: 'light', label: '亮', icon: <Sun /> },
            { value: 'dark', label: '暗', icon: <Moon /> },
            { value: 'system', label: '系统', icon: <Monitor /> },
          ]}
        />
      </Row>

      <Row label="品牌色" value={`H ${params.brandHue} · C ${params.brandChroma.toFixed(2)}`}>
        <div className="grid grid-cols-8 gap-1.5">
          {BRAND_PRESETS.map((preset) => {
            const on = preset.hue === params.brandHue && Math.abs(preset.chroma - params.brandChroma) < 0.005;
            return (
              <button
                key={preset.name}
                type="button"
                title={preset.name}
                onClick={() => setParams({ brandHue: preset.hue, brandChroma: preset.chroma })}
                className={cn('grid aspect-square place-items-center rounded-md ring-offset-2 ring-offset-surface transition-shadow duration-(--dur-1)', on && 'ring-2 ring-fg')}
                style={{ background: `oklch(0.55 ${preset.chroma} ${preset.hue})` }}
              >
                {on ? <Check className="size-3.5 text-white" /> : null}
              </button>
            );
          })}
        </div>
        <RangeInput label="品牌色相" value={params.brandHue} min={0} max={360} onValueChange={(value) => setParams({ brandHue: value })} />
        <RangeInput label="品牌色度" value={params.brandChroma * 100} min={2} max={24} onValueChange={(value) => setParams({ brandChroma: value / 100 })} />
      </Row>

      <Row label="中性色" value={`H ${params.neutralHue} · ${params.neutralTint.toFixed(3)}`}>
        <MiniTabs
          size="sm"
          fullWidth
          className="w-full"
          aria-label="中性色"
          value={neutral}
          onValueChange={(name) => {
            const preset = NEUTRAL_PRESETS.find((item) => item.name === name);
            if (!preset) {
              throw new TypeError(`Unknown neutral preset ${name}`);
            }
            setParams({ neutralHue: preset.hue, neutralTint: preset.tint });
          }}
          items={NEUTRAL_PRESETS.map((preset) => ({ value: preset.name, label: preset.name }))}
        />
        <RangeInput label="中性色倾向" value={params.neutralTint * 1000} min={0} max={30} onValueChange={(value) => setParams({ neutralTint: value / 1000 })} />
      </Row>

      <FormField label="拉丁字体（中文始终走系统字体）">
        <SimpleSelect
          size="sm"
          ariaLabel="拉丁字体"
          value={params.font}
          onValueChange={(value) => {
            if (!isFontKey(value)) {
              throw new TypeError(`Unknown font ${value}`);
            }
            setParams({ font: value });
          }}
          options={(Object.keys(FONTS) as FontKey[]).map((key) => ({
            value: key,
            label: <span style={{ fontFamily: `${FONTS[key].stack}, system-ui` }}>{FONTS[key].label}</span>,
            hint: <span style={{ fontFamily: `${FONTS[key].stack}, system-ui` }}>Aa 0123</span>,
          }))}
        />
      </FormField>

      <Row label="正文字号" value={`${params.fontSize}px`}>
        <MiniTabs
          size="sm"
          fullWidth
          className="w-full"
          aria-label="正文字号"
          value={String(params.fontSize)}
          onValueChange={(value) => {
            const size = Number(value);
            if (size !== 13 && size !== 14 && size !== 15) {
              throw new TypeError(`Unknown font size ${value}`);
            }
            setParams({ fontSize: size });
          }}
          items={['13', '14', '15'].map((value) => ({ value, label: value }))}
        />
      </Row>

      <Row label="密度">
        <MiniTabs<DesignParams['density']>
          size="sm"
          fullWidth
          className="w-full"
          aria-label="密度"
          value={params.density}
          onValueChange={(value) => setParams({ density: value })}
          items={[
            { value: 'compact', label: '紧凑' },
            { value: 'default', label: '标准' },
            { value: 'comfortable', label: '宽松' },
          ]}
        />
      </Row>

      <Row label="圆角" value={`${params.radius}px`}>
        <RangeInput label="圆角" value={params.radius} min={0} max={12} onValueChange={(value) => setParams({ radius: value })} />
      </Row>

      <Row label="动效速度" value={params.motionScale === 0 ? '关' : `×${params.motionScale.toFixed(2)}`}>
        <RangeInput label="动效速度" value={params.motionScale * 100} min={0} max={200} step={25} onValueChange={(value) => setParams({ motionScale: value / 100 })} />
      </Row>

      <Button type="button" variant="primary" onClick={() => setExportOpen(true)}>
        <Download />
        导出 tokens
      </Button>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>导出 tokens</DialogTitle>
            <DialogDescription>把这段 CSS 或参数 JSON 发给我，我会把它锁进设计规范。</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <pre className="max-h-96 overflow-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-2xs leading-relaxed text-fg-muted">{css}</pre>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void writeClipboard(JSON.stringify(params, null, 2)).then(() => {
                  toast.success('参数 JSON 已复制');
                }, (error: unknown) => {
                  toast.error('无法复制参数 JSON', { description: clipboardFailure(error) });
                });
              }}
            >
              复制参数 JSON
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                void writeClipboard(css).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }, (error: unknown) => {
                  toast.error('无法复制 CSS', { description: clipboardFailure(error) });
                });
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? '已复制' : '复制 CSS'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
