import { MarkdownView } from '@/components/markdown-renderer';
import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import {
  PAPER_IDENTITY_LINE,
  PAPER_JUDGE_BLANK,
  paperAnswerText,
  paperItemLabel,
  paperOptionLine,
  paperShowsJudgeBlank,
  paperShowsOptions,
  paperWritingLines,
  parseTeachPaperExport,
} from './paper-export-model';
import type { TeachPaperItem, TeachPaperSection } from './paper-export-model';

const PRINT_NOTE = '用浏览器的「打印」可以另存为 PDF。';

// tokens.css :root light values. .dark lives on html, so print inherits light text onto unprinted white paper.
const PRINT_LIGHT_CSS = [
  '@media print {',
  '  [data-paper-print] {',
  '    color-scheme: light;',
  '    background: white;',
  '    color: var(--fg);',
  '    --bg: oklch(0.982 0.005 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --surface: oklch(1 0 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --surface-sunken: oklch(0.97 0.006 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --surface-active: oklch(0.942 0.008 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --line-subtle: oklch(0.944 0.006 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --line: oklch(0.915 0.007 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --line-strong: oklch(0.865 0.008 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --fg: oklch(0.205 0.015 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --fg-muted: oklch(0.45 0.015 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --fg-subtle: oklch(0.54 0.012 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的变量打出来看不见
  '    --brand-fg: oklch(0.5 0.162 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的代码和链接打出来看不见
  '    --brand-line: oklch(0.86 0.071 268);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的代码和链接打出来看不见
  '    --success-fg: oklch(0.5 0.143 152);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的代码和链接打出来看不见
  '    --warning-fg: oklch(0.5 0.143 75);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的代码和链接打出来看不见
  '    --danger-fg: oklch(0.5 0.181 25);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的代码和链接打出来看不见
  '    --info-fg: oklch(0.5 0.124 235);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的代码和链接打出来看不见
  '    --violet-fg: oklch(0.5 0.152 300);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的代码和链接打出来看不见
  '    --orange-fg: oklch(0.5 0.152 48);', // ds-allow DS003: 打印白纸沿用 tokens.css 浅色，深色主题的代码和链接打出来看不见
  '  }',
  '}',
].join('\n');

function WritingLines({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-6 border-b border-line" />
      ))}
    </div>
  );
}

function PaperItemView({ item, answers }: { item: TeachPaperItem; answers: boolean }) {
  const writingLines = paperWritingLines(item.kind);
  return (
    <article className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-semibold text-fg">{paperItemLabel(item)}</h2>
      <MarkdownView content={item.statement} />
      {paperShowsOptions(item.kind) && item.options !== null ? (
        <div className="flex flex-col gap-1">
          {item.options.map((option, index) => (
            <p key={`${item.pid}-${index}`} className="text-sm text-fg">{paperOptionLine(index, option)}</p>
          ))}
        </div>
      ) : null}
      {paperShowsJudgeBlank(item.kind) ? <p className="text-sm text-fg">{PAPER_JUDGE_BLANK}</p> : null}
      {writingLines > 0 ? <WritingLines count={writingLines} /> : null}
      {answers ? <p className="text-sm font-semibold text-fg">{paperAnswerText(item.kind, item.answer)}</p> : null}
    </article>
  );
}

function PaperSectionView({ section, answers }: { section: TeachPaperSection; answers: boolean }) {
  return (
    <Panel
      title={section.heading === '' ? undefined : section.heading}
      description={section.drawNote ?? undefined}
    >
      <div className="flex min-w-0 flex-col gap-6">
        {section.items.map((item) => (
          <PaperItemView key={`${item.pid}-${item.label}`} item={item} answers={answers} />
        ))}
      </div>
    </Panel>
  );
}

export function TeachPaperPrintPage() {
  const paper = parseTeachPaperExport(useBootstrap().page.data);
  return (
    <div data-paper-print="">
      <style>{PRINT_LIGHT_CSS}</style>
      <Page width="prose">
        <PageHeader
          title={paper.title}
          actions={(
            <div className="print:hidden flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                type="button"
                className="shrink-0"
                onClick={() => {
                  window.print();
                }}
              >
                打印
              </Button>
              <p className="min-w-0 text-sm text-fg-muted">{PRINT_NOTE}</p>
            </div>
          )}
        />
        {paper.answers ? null : <p className="whitespace-pre text-sm text-fg">{PAPER_IDENTITY_LINE}</p>}
        {paper.sections.map((section, index) => (
          <PaperSectionView key={`${section.kind ?? 'plain'}-${index}`} section={section} answers={paper.answers} />
        ))}
      </Page>
    </div>
  );
}
