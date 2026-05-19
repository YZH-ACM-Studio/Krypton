import { motion } from 'motion/react';
import {
  BookOpen,
  CircleHelp,
  Code2,
  Database,
  Flag,
  Gauge,
  Info,
  MessageSquareText,
  Trophy,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap } from '@/lib/bootstrap';

type R = Record<string, any>;

const HELP_SECTIONS = [
  {
    id: 'domain',
    title: '域与空间',
    icon: Flag,
    body: [
      '每个用户可以创建自己的域。教师可以为课程创建域，将题目、训练、比赛和学生放在一个独立空间中管理。',
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
      '在题目、比赛、作业和训练中，可以用 file://文件名 引用附件。',
    ],
  },
];

export function AboutPage() {
  const bs = useBootstrap();
  const sections: R[] = bs.page.data.sections || [];
  const nav = sections.length
    ? sections.map((section) => ({
      id: sectionId(section),
      title: section.title || '说明',
    }))
    : [{ id: 'about', title: bs.siteName || 'Krypton' }];

  return (
    <WikiShell title={`关于 ${bs.siteName || bs.domain.name}`} icon={Info} nav={nav}>
      {sections.length ? (
        sections.map((section) => (
          <ArticleSection
            key={sectionId(section)}
            id={sectionId(section)}
            title={section.title || '说明'}
            content={section.content || ''}
          />
        ))
      ) : (
        <ArticleSection
          id="about"
          title={bs.siteName || 'Krypton'}
          content={`${bs.siteName || 'Krypton'} 是面向信息学教学与竞赛的在线评测系统。`}
        />
      )}
    </WikiShell>
  );
}

export function WikiHelpPage() {
  return (
    <WikiShell
      title="帮助中心"
      icon={CircleHelp}
      nav={HELP_SECTIONS.map((section) => ({ id: section.id, title: section.title }))}
    >
      <div className="grid gap-4">
        {HELP_SECTIONS.map((section) => (
          <Card key={section.id} id={section.id}>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <section.icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">{section.title}</h2>
                    <Badge variant="outline" className="font-mono text-[10px]">#{section.id}</Badge>
                  </div>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                    {section.body.map((line) => <p key={line}>{line}</p>)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </WikiShell>
  );
}

function WikiShell({
  title,
  icon: Icon,
  nav,
  children,
}: {
  title: string;
  icon: React.ElementType;
  nav: Array<{ id: string; title: string }>;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="grid gap-6 lg:grid-cols-[220px_1fr]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <aside className="lg:sticky lg:top-16 lg:self-start">
        <div className="rounded-md border bg-card p-3">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Icon className="size-4 text-primary" />
            <span className="text-sm font-medium">{title}</span>
          </div>
          <div className="mt-2 space-y-1 text-sm">
            {nav.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.title}
              </a>
            ))}
          </div>
        </div>
      </aside>
      <main className="min-w-0 space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <BookOpen className="size-5 text-primary" />
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">常用规则、平台说明与格式约定。</p>
        </div>
        {children}
      </main>
    </motion.div>
  );
}

function ArticleSection({ id, title, content }: { id?: string; title: string; content: string }) {
  return (
    <Card id={id}>
      <CardContent className="p-5">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <MarkdownView content={content} />
      </CardContent>
    </Card>
  );
}

function sectionId(section: R) {
  return section.id || String(section.title || 'section').toLowerCase().replace(/\s+/g, '-');
}
