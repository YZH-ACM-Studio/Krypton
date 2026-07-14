import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('module');
const React: typeof import('react') = require('react');
const { renderToString }: typeof import('react-dom/server') = require('react-dom/server');
const RadixSelect: typeof import('@radix-ui/react-select') = require('@radix-ui/react-select');
const selectPath = require.resolve('../src/components/ui/select.tsx');
const originalLoad = Module._load;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
  if (parent?.filename === selectPath && request === '@/lib/cn') {
    return { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let renderSimpleSelectOptions: typeof import('../src/components/ui/select').renderSimpleSelectOptions;
try {
  delete require.cache[selectPath];
  ({ renderSimpleSelectOptions } = require(selectPath));
} finally {
  Module._load = originalLoad;
}

const adminSource = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/admin-tasks/index.tsx'), 'utf8');
const detailSource = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/tasks/index.tsx'), 'utf8');
const graphTypes = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/components/task-graph.tsx'), 'utf8');

describe('P2.5 canonical tag task UI', () => {
  it('renders canonical tags through grouped select options instead of a free text input', () => {
    expect(adminSource).to.include("spec.type === 'canonical_tag'");
    expect(adminSource).to.include('canonicalTagSelectOptions(spec.options || [])');
    expect(adminSource).to.include("{ type: 'label', label: group }");
    expect(adminSource).to.include("{ type: 'separator' }");

    const branchStart = adminSource.indexOf("if (spec.type === 'canonical_tag')");
    const branchEnd = adminSource.indexOf("if (spec.type === 'date')", branchStart);
    const branch = adminSource.slice(branchStart, branchEnd);
    expect(branchStart).to.be.greaterThan(-1);
    expect(branchEnd).to.be.greaterThan(branchStart);
    expect(branch).to.include('<SimpleSelect');
    expect(branch).not.to.include('<Input');
  });

  it('keeps group metadata in the shared preset type and shows group plus full path on task detail', () => {
    expect(graphTypes).to.include('group?: string');
    expect(detailSource).to.include('if (option) return option.group ?');
    expect(detailSource).to.include('option.group');
    expect(detailSource).to.include('option.label');
  });

  it('renders grouped options with a real Radix SelectGroup context', () => {
    const nodes = renderSimpleSelectOptions([
      { value: '', label: '— 选择规范标签 —' },
      { type: 'label', label: '算法知识点' },
      { value: '数据结构', label: '算法 / 数据结构' },
      { type: 'separator' },
      { type: 'label', label: '来源与赛事' },
      { value: 'L1', label: 'L1' },
    ]);

    const html = renderToString(
      React.createElement(
        RadixSelect.Root,
        { open: true },
        React.createElement(RadixSelect.Trigger, null, '选择标签'),
        React.createElement(RadixSelect.Content, null, React.createElement(RadixSelect.Viewport, null, ...nodes)),
      ),
    );
    expect(html).to.include('role="group"');
    expect(html).to.include('aria-labelledby=');
    expect(html).to.include('算法知识点');
    expect(html).to.include('来源与赛事');
  });
});
