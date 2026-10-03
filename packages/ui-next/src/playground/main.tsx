import { StrictMode } from 'react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogHost } from '@/components/ui/dialog';
import { useMediaQuery } from '@/components/ui/media';
import { PageTabs } from '@/components/ui/page-tabs';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ToastProvider } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { DEMOS, type DemoKey } from './demos/pages';
import { Foundations, MotionSpec, ResponsiveSpec, Section } from './sections/foundations';
import { Actions, Data, Display, Feedback, Inputs, Navigation, Overlays } from './sections/components';
import { ContestStatus, Samples, ScoreboardSpec, Verdicts } from './sections/oj';
import { Viewports } from './sections/viewports';
import { usePlaygroundState } from './state';
import { Tuner } from './tuner';
import './playground.css';

const SECTIONS = [
  { id: 'foundations', label: '基础：色彩 / 字体 / 形状' },
  { id: 'motion', label: '微动效' },
  { id: 'responsive', label: '响应式与视口' },
  { id: 'actions', label: '按钮' },
  { id: 'inputs', label: '表单' },
  { id: 'display', label: '展示' },
  { id: 'feedback', label: '反馈' },
  { id: 'overlays', label: '浮层' },
  { id: 'navigation', label: '导航' },
  { id: 'data', label: '数据表' },
  { id: 'oj', label: 'OJ 专属模式' },
];

function useActiveSection() {
  const [active, setActive] = React.useState(SECTIONS[0].id);
  React.useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    SECTIONS.forEach((section) => {
      const el = document.getElementById(section.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);
  return active;
}

function Showcase({ tuner }: { tuner: React.ReactNode }) {
  const active = useActiveSection();
  const wide = useMediaQuery('(min-width: 1280px)');
  const [tunerOpen, setTunerOpen] = React.useState(false);
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="flex h-12 items-center gap-3 px-4 sm:px-6">
          <span className="grid size-7 place-items-center rounded-md bg-fg text-sm font-bold text-bg">Kr</span>
          <span className="text-sm font-semibold tracking-tight text-fg">Krypton Design System</span>
          <span className="hidden text-xs text-fg-subtle sm:inline">playground · 草案</span>
          {!wide ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => setTunerOpen(true)}
            >
              <SlidersHorizontal />
              调参
            </Button>
          ) : null}
        </div>
        <PageTabs
          className="px-4 lg:hidden"
          aria-label="目录"
          value={active}
          items={SECTIONS.map((section) => ({ value: section.id, label: section.label, href: `#${section.id}` }))}
        />
      </header>
      <div className="flex">
        <nav className="sticky top-12 hidden h-[calc(100dvh-3rem)] w-56 shrink-0 overflow-y-auto border-r border-line px-3 py-6 lg:block">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={cn(
                'block rounded-md px-2.5 py-1.5 text-sm transition-colors duration-(--dur-1)',
                active === section.id ? 'bg-surface-active font-medium text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {section.label}
            </a>
          ))}
          <div className="mt-6 border-t border-line-subtle px-2.5 pt-4 text-2xs font-semibold text-fg-subtle">整页示例</div>
          {(Object.keys(DEMOS) as DemoKey[]).map((key) => (
            <a
              key={key}
              href={`?demo=${key}`}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors duration-(--dur-1) hover:text-fg"
            >
              {DEMOS[key].label}
              {' '}
              ↗
            </a>
          ))}
        </nav>
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-5xl flex-col gap-14">
            <Section id="foundations" title="基础" description="所有颜色都从右侧调参台的几个参数生成：品牌色只有一个，语义色固定不可调，中性色只有轻微倾向。">
              <Foundations />
            </Section>
            <Section id="motion" title="微动效" description="四档时长、三条曲线、一个弹簧。试着把调参台的「动效速度」拖到 0 或 2。">
              <MotionSpec />
            </Section>
            <Section id="responsive" title="响应式与视口" description="下面每个预览框都是真实渲染。">
              <ResponsiveSpec />
              <Viewports />
            </Section>
            <Section id="actions" title="按钮">
              <Actions />
            </Section>
            <Section id="inputs" title="表单">
              <Inputs />
            </Section>
            <Section id="display" title="展示">
              <Display />
            </Section>
            <Section id="feedback" title="反馈">
              <Feedback />
            </Section>
            <Section id="overlays" title="浮层">
              <Overlays />
            </Section>
            <Section id="navigation" title="导航">
              <Navigation />
            </Section>
            <Section id="data" title="数据表">
              <Data />
            </Section>
            <Section id="oj" title="OJ 专属模式" description="评测结果、榜单、样例、比赛状态、考试计时：这些是 Krypton 独有的，必须全站一致。">
              <Verdicts />
              <Samples />
              <ScoreboardSpec />
              <ContestStatus />
            </Section>
          </div>
        </main>
        {wide ? (
          <aside className="sticky top-12 h-[calc(100dvh-3rem)] w-72 shrink-0 overflow-y-auto border-l border-line bg-surface">{tuner}</aside>
        ) : (
          <Sheet open={tunerOpen} onOpenChange={setTunerOpen}>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>调参台</SheetTitle>
              </SheetHeader>
              <SheetBody>
                {tuner}
              </SheetBody>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </div>
  );
}

function isDemoKey(value: string): value is DemoKey {
  return Object.hasOwn(DEMOS, value);
}

function App() {
  const state = usePlaygroundState();
  const demoParam = new URLSearchParams(window.location.search).get('demo');
  const demo = demoParam !== null && isDemoKey(demoParam) ? demoParam : null;
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <DialogHost />
        {demo ? (
          DEMOS[demo].el()
        ) : (
          <Showcase tuner={<Tuner params={state.params} setParams={state.setParams} theme={state.theme} setTheme={state.setTheme} reset={state.reset} />} />
        )}
      </ToastProvider>
    </MotionConfig>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('playground root is missing');
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
