import { Code2, Database, Flag, Gauge, MessageSquareText, Trophy } from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { MarkdownView } from '@/components/markdown-renderer';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';

interface AboutSection {
  id?: string;
  title?: string;
  content?: string;
}

const HELP_SECTIONS: Array<{ id: string; title: string; icon: ElementType; body: string[] }> = [
  {
    id: 'domain',
    title: '域与空间',
    icon: Flag,
    body: [
      '每个用户可以创建自己的域。教师可以为课程创建域，将题目、题集、比赛和学生放在一个独立空间中管理。',
      '域可以通过角色和权限设置为公开或私有。默认域为 system，直接访问站点域名会进入默认域。',
    ],
  },
  {
    id: 'compiler',
    title: '编译与评测',
    icon: Code2,
    body: [
      'Krypton 使用 HydroJudge 进行评测。编译器版本、语言参数和评测机状态可以在系统状态页查看。',
      '若出现编译错误，请先检查语言选择、入口类名、函数返回值和非标准函数使用。',
    ],
  },
  {
    id: 'limits',
    title: '时间与内存限制',
    icon: Gauge,
    body: [
      '时间限制按进程 CPU 时间计算，具体限制以题目评测点配置为准。',
      '内存限制按虚拟内存与物理内存的总和计算。未特别说明时，默认内存限制通常为 256 MiB。',
    ],
  },
  {
    id: 'status',
    title: '评测状态',
    icon: Database,
    body: [
      'Waiting 表示等待评测机抓取；Fetched、Compiling、Judging 表示评测流程正在进行。',
      'Accepted 表示通过；Wrong Answer、Time Limit Exceeded、Memory Limit Exceeded、Runtime Error、Compile Error 表示对应失败类型。',
      'System Error 或 Unknown Error 通常需要管理员检查评测机或题目数据。',
    ],
  },
  {
    id: 'contest',
    title: '比赛规则',
    icon: Trophy,
    body: [
      '不同赛制有不同提交、封榜和排名规则。XCPC 按通过题数和罚时排序，OI 通常以最后一次提交得分为准。',
      '比赛中的题目时间、空间限制仍以题面为准。',
    ],
  },
  {
    id: 'markdown',
    title: 'Markdown',
    icon: MessageSquareText,
    body: [
      '题面、题解和讨论支持 Markdown、表格、代码块、LaTeX 公式，以及部分安全 HTML。',
      '在题目、比赛、作业和题集中，可以用 file://文件名 引用附件。',
    ],
  },
];

const WIKI_DESCRIPTION = '常用规则、平台说明与格式约定。';

function sectionId(section: AboutSection) {
  return (
    section.id ||
    String(section.title || 'section')
      .toLowerCase()
      .replace(/\s+/g, '-')
  );
}

function WikiNav({ items }: { items: Array<{ id: string; title: string }> }) {
  return (
    <aside className="lg:sticky lg:top-0 lg:self-start">
      <div className="rounded-lg border border-line bg-surface p-3 shadow-xs">
        <div className="flex flex-col gap-1 text-sm">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="block rounded-md px-2 py-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              {item.title}
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
}

function WikiColumns({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="lg:w-60 lg:shrink-0">{nav}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
    </div>
  );
}

function ArticleSection({ id, title, content }: { id?: string; title: string; content: string }) {
  return (
    <section id={id}>
      <Panel>
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <div className="krypton-prose mt-4 min-w-0">
          <MarkdownView content={content} />
        </div>
      </Panel>
    </section>
  );
}

export function AboutPage() {
  const bs = useBootstrap();
  const { sections = [] } = bs.page.data as { sections?: AboutSection[] };
  const nav = sections.length
    ? sections.map((section) => ({
        id: sectionId(section),
        title: section.title || '说明',
      }))
    : [{ id: 'about', title: bs.siteName || 'Krypton' }];

  return (
    <Page width="prose">
      <PageHeader title={`关于 ${bs.siteName || bs.domain.name}`} description={WIKI_DESCRIPTION} />
      <WikiColumns nav={<WikiNav items={nav} />}>
        {sections.length ? (
          sections.map((section) => (
            <ArticleSection key={sectionId(section)} id={sectionId(section)} title={section.title || '说明'} content={section.content || ''} />
          ))
        ) : (
          <ArticleSection id="about" title={bs.siteName || 'Krypton'} content={`${bs.siteName || 'Krypton'} 是面向信息学教学与竞赛的在线评测系统。`} />
        )}
      </WikiColumns>
    </Page>
  );
}

export function WikiHelpPage() {
  return (
    <Page width="prose">
      <PageHeader title="帮助中心" description={WIKI_DESCRIPTION} />
      <WikiColumns nav={<WikiNav items={HELP_SECTIONS.map((section) => ({ id: section.id, title: section.title }))} />}>
        {HELP_SECTIONS.map((section) => (
          <section key={section.id} id={section.id}>
            <Panel>
              <div className="flex items-start gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-fg-subtle">
                  <section.icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-fg">{section.title}</h2>
                    <Badge variant="outline" size="sm" className="font-mono">
                      #{section.id}
                    </Badge>
                  </div>
                  <div className="krypton-prose mt-3">
                    {section.body.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>
          </section>
        ))}
      </WikiColumns>
    </Page>
  );
}
