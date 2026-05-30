/**
 * Wrapper that injects the new judge config editor into the problem
 * management sidebar shell.
 */

import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { ProblemConfigEditor } from './problem-config-editor';

type R = Record<string, any>;

/** Side nav reused across all /p/:pid/* admin pages. */
function ProblemSidebar({ problemUrl, active }: { problemUrl: string; active: string }) {
  const items = [
    { key: 'detail', label: '题目详情', href: problemUrl },
    { key: 'edit', label: '编辑', href: `${problemUrl}/edit` },
    { key: 'config', label: '评测配置', href: `${problemUrl}/config` },
    { key: 'files', label: '附加文件', href: `${problemUrl}/files` },
    { key: 'solution', label: '题解', href: `${problemUrl}/solution` },
    { key: 'statistics', label: '统计', href: `${problemUrl}/stat` },
  ];
  return (
    <nav className="space-y-1">
      {items.map((it) => (
        <a
          key={it.key}
          href={it.href}
          className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${active === it.key ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}

export function ProblemConfigPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const testdata: R[] = Array.isArray(data.testdata) ? data.testdata : [];
  const config: string = data.config || '';
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <ProblemConfigEditor
        problemUrl={problemUrl}
        pdoc={pdoc}
        files={testdata}
        initialYaml={config}
      />
    </motion.div>
  );
}
