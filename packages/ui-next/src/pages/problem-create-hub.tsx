import { ArrowLeft, ArrowRight, Binary, Braces, CheckCircle2, CircleDot, Code2, FileQuestion, ListChecks, TextCursorInput } from 'lucide-react';
import { PROBLEM_KIND_TO_SLUG, PROBLEM_KINDS, type ProblemKind } from '@hydrooj/common';
import { Button } from '../components/ui/button';
import { useBootstrap } from '../lib/bootstrap';

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
    <main className="w-full min-w-0 space-y-7 pb-12">
      <header className="space-y-4 border-b border-border/70 pb-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <a href="/p">
            <ArrowLeft className="size-4" />
            返回题库
          </a>
        </Button>
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">统一题库 · 创建</p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">选择题目类型</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            每种题型有独立字段和编辑界面。题型创建后固定；需要更换类型时请创建新题。
          </p>
        </div>
      </header>

      <div className="space-y-8">
        {GROUPS.map((group) => {
          const kinds = visibleKinds.filter((kind) => KIND_META[kind].group === group);
          if (!kinds.length) return null;
          return (
            <section key={group} aria-labelledby={`problem-kind-${group}`} className="space-y-2.5">
              <h2 id={`problem-kind-${group}`} className="px-1 text-sm font-semibold">
                {group}
              </h2>
              <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-background">
                {kinds.map((kind) => {
                  const meta = KIND_META[kind];
                  const Icon = meta.icon;
                  return (
                    <li key={kind}>
                      <a
                        href={`/problem/create/${PROBLEM_KIND_TO_SLUG[kind]}`}
                        className="group flex min-h-20 items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:px-5"
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground" aria-hidden="true">
                          <Icon className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{meta.label}</span>
                          <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">{meta.description}</span>
                        </span>
                        <ArrowRight
                          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                          aria-hidden="true"
                        />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}

export function ProblemCreateHubPage() {
  const data = useBootstrap().page.data as {
    problemKinds?: Array<{ kind: ProblemKind; slug: string }>;
  };
  return <ProblemCreateHubView problemKinds={data.problemKinds || []} />;
}
