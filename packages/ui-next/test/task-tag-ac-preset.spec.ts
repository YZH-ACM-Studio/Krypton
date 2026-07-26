import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import * as selectModule from '../src/components/ui/select';

const adminSource = readFileSync(resolve(import.meta.dirname, '../src/pages/admin-tasks/index.tsx'), 'utf8');
const detailSource = readFileSync(resolve(import.meta.dirname, '../src/pages/tasks/index.tsx'), 'utf8');
const graphTypes = readFileSync(resolve(import.meta.dirname, '../src/components/task-graph.tsx'), 'utf8');

describe('p2.5 canonical tag task UI', () => {
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

  it('builds grouped options from the exported Radix SelectGroup primitive', () => {
    const nodes = selectModule.renderSimpleSelectOptions([
      { value: '', label: '— 选择规范标签 —' },
      { type: 'label', label: '算法知识点' },
      { value: '数据结构', label: '算法 / 数据结构' },
      { type: 'separator' },
      { type: 'label', label: '来源与赛事' },
      { value: 'L1', label: 'L1' },
    ]);

    const groups = nodes.filter(
      (node): node is React.ReactElement<{ children?: React.ReactNode }> => React.isValidElement(node) && node.type === selectModule.SelectGroup,
    );
    expect(groups).to.have.lengthOf(2);
    expect(groups.every((group) => React.Children.toArray(group.props.children).some((child: any) => child?.type === selectModule.SelectLabel))).to.equal(
      true,
    );
    const labels = groups.flatMap((group) =>
      React.Children.toArray(group.props.children)
        .filter((child: any) => child?.type === selectModule.SelectLabel)
        .map((child: any) => child.props.children),
    );
    expect(labels).to.deep.equal(['算法知识点', '来源与赛事']);
  });
});
