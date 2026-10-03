import * as React from 'react';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { DEMOS, type DemoKey } from '../demos/pages';
import { Specimen } from './foundations';

const FRAMES = [
  { label: '手机', w: 375, h: 760 },
  { label: '平板竖屏', w: 768, h: 1024 },
  { label: '机房 1366×768', w: 1366, h: 768 },
  { label: '投影 1920×1080', w: 1920, h: 1080 },
];

/** A real iframe at the device width, scaled down to fit the column. */
function Frame({ demo, w, h, label }: { demo: DemoKey; w: number; h: number; label: string }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(0.3);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-fg">{label}</span>
        <span className="font-mono text-fg-subtle">
          {w}
          ×
          {h}
          {' '}
          ·
          {' '}
          {Math.round(scale * 100)}
          %
        </span>
      </figcaption>
      <div ref={box} className="w-full overflow-hidden rounded-lg border border-line bg-bg shadow-sm" style={{ height: h * scale }}>
        <iframe
          title={`${label} ${demo}`}
          src={`?demo=${demo}`}
          style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0 }}
        />
      </div>
    </figure>
  );
}

export function Viewports() {
  const [demo, setDemo] = React.useState<DemoKey>('problems');
  return (
    <Specimen
      label="多视口实时预览"
      rule="每个框都是真实 iframe，按设备宽度渲染再缩放；调参台改动会同步过去。单独打开：在地址后加 ?demo=problems。"
      stage={false}
    >
      <MiniTabs<DemoKey>
        value={demo}
        onValueChange={setDemo}
        aria-label="整页示例"
        className="max-w-full self-start overflow-x-auto"
        items={(Object.keys(DEMOS) as DemoKey[]).map((key) => ({ value: key, label: DEMOS[key].label }))}
      />
      <div className="mt-4 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Frame demo={demo} {...FRAMES[0]} />
        <Frame demo={demo} {...FRAMES[1]} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Frame demo={demo} {...FRAMES[2]} />
        <Frame demo={demo} {...FRAMES[3]} />
      </div>
    </Specimen>
  );
}
