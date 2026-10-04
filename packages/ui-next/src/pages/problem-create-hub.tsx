import { ArrowLeft, ArrowRight, Binary, Braces, CheckCircle2, CircleDot, Code2, FileQuestion, ListChecks, TextCursorInput } from 'lucide-react';
import { PROBLEM_KIND_TO_SLUG, PROBLEM_KINDS, type ProblemKind } from '@hydrooj/common';
import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/ui/page';
import { useBootstrap } from '@/lib/bootstrap';

const KIND_META: Record<
  ProblemKind,
  {
    label: string;
    description: string;
    group: '基础题型' | '人工阅卷' | '代码评测';
    icon: typeof Code2;
  }
> = {
  programming: {
    label: '编程题',
    description: '完整程序、测试数据与时空限制',
    group: '代码评测',
    icon: Code2,
  },
  single: {
    label: '单选题',
    description: '一个正确选项，自动判分',
    group: '基础题型',
    icon: CircleDot,
  },
  multi: {
    label: '多选题',
    description: '全对得满分，可配置正确真子集部分分',
    group: '基础题型',
    icon: ListChecks,
  },
  true_false: {
    label: '判断题',
    description: '正确或错误，自动判分',
    group: '基础题型',
    icon: CheckCircle2,
  },
  blank: {
    label: '填空题',
    description: '一个大小写敏感的精确答案',
    group: '基础题型',
    icon: TextCursorInput,
  },
  subjective: {
    label: '主观题',
    description: '在考试、作业或 OI 容器内提交并人工阅卷',
    group: '人工阅卷',
    icon: FileQuestion,
  },
  program_fill: {
    label: '程序填空题',
    description: '单行文本答案，或拼接后编译评测',
    group: '代码评测',
    icon: Binary,
  },
  function: {
    label: '代码实现题',
    description: '在公开代码骨架中完成函数、类或指定代码区域',
    group: '代码评测',
    icon: Braces,
  },
};

const GROUPS = ['基础题型', '人工阅卷', '代码评测'] as const;

export function ProblemCreateHubView({ problemKinds }: { problemKinds: Array<{ kind: ProblemKind; slug: string }> }) {
  const serverMapping = new Map<ProblemKind, string>();
  for (const item of problemKinds) {
    if (!PROBLEM_KINDS.includes(item.kind) || item.slug !== PROBLEM_KIND_TO_SLUG[item.kind] || serverMapping.has(item.kind)) {
      throw new Error(`Problem kind route mapping mismatch: ${item.kind}`);
    }
    serverMapping.set(item.kind, item.slug);
  }
  const visibleKinds = PROBLEM_KINDS.filter((kind) => serverMapping.has(kind));

  return (
    <Page width="wide">
        <PageHeader
          breadcrumb={<p className="text-xs font-medium text-fg-subtle">统一题库 · 创建</p>}
          title="选择题目类型"
          description="每种题型有独立字段和编辑界面。题型创建后固定；需要更换类型时请创建新题。"
          actions={(
            <Button asChild variant="ghost" size="sm">
              <a href="/p">
                <ArrowLeft />
                返回题库
              </a>
            </Button>
          )}
        />

        <div className="flex flex-col gap-8">
          {GROUPS.map((group) => {
            const kinds = visibleKinds.filter((kind) => KIND_META[kind].group === group);
            if (!kinds.length) return null;
            return (
              <section key={group} aria-labelledby={`problem-kind-${group}`} className="flex flex-col gap-2.5">
                <h2 id={`problem-kind-${group}`} className="text-sm font-semibold text-fg">
                  {group}
                </h2>
                <ul className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {kinds.map((kind) => {
                    const meta = KIND_META[kind];
                    const Icon = meta.icon;
                    return (
                      <li key={kind} className="min-w-0">
                        <a
                          href={`/problem/create/${PROBLEM_KIND_TO_SLUG[kind]}`}
                          className="flex min-h-20 items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3 shadow-xs outline-none transition-[border-color,box-shadow] duration-(--dur-1) ease-(--ease-standard) hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-active text-fg" aria-hidden="true">
                            <Icon className="size-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-fg">{meta.label}</span>
                            <span className="mt-0.5 block text-sm text-fg-muted">{meta.description}</span>
                          </span>
                          <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
    </Page>
  );
}

export function ProblemCreateHubPage() {
  const data = useBootstrap().page.data as {
    problemKinds?: Array<{ kind: ProblemKind; slug: string }>;
  };
  return <ProblemCreateHubView problemKinds={data.problemKinds || []} />;
}
