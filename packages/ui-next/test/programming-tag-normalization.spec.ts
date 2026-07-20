import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { requiresLegacyProgrammingTagNormalization } from '../src/lib/programming-tag-state';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function read(relative: string) {
  return readFileSync(resolve(workspaceRoot, relative), 'utf8');
}

describe('P2.17 programming tag normalization UI contract', () => {
  it('does not present empty or source-only legacy tags as a normalization task', () => {
    expect(requiresLegacyProgrammingTagNormalization({ mode: 'unconverted', sourceTags: [], selectedNodeIds: [] })).to.equal(false);
    expect(
      requiresLegacyProgrammingTagNormalization({
        mode: 'unconverted',
        sourceTags: ['MultiSchool', '2026牛客暑期多校'],
        selectedNodeIds: [],
      }),
    ).to.equal(false);
    expect(
      requiresLegacyProgrammingTagNormalization({
        mode: 'unconverted',
        sourceTags: [],
        selectedNodeIds: ['node-1'],
        suggestions: [{ tag: '二分', nodeId: 'node-1', label: '算法 / 二分' }],
      }),
    ).to.equal(true);
    expect(
      requiresLegacyProgrammingTagNormalization({
        mode: 'unconverted',
        sourceTags: [],
        selectedNodeIds: [],
        unknownTags: ['旧自由标签'],
      }),
    ).to.equal(true);
    expect(
      requiresLegacyProgrammingTagNormalization({
        mode: 'unconverted',
        sourceTags: [],
        selectedNodeIds: [],
        ambiguousTags: [{ tag: '模拟', candidates: ['算法 / 模拟', '专题 / 模拟'] }],
      }),
    ).to.equal(true);
    expect(requiresLegacyProgrammingTagNormalization({ mode: 'converted', sourceTags: [], selectedNodeIds: [] })).to.equal(false);
  });

  it('forces every interactive programming create through the managed protocol', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    expect(edit).to.include('const managed = managedExisting || isCreate');
    expect(edit).to.include('<input type="hidden" name="managed" value="true" />');
    expect(edit).to.include('canAssignManagedAuthor');
    expect(edit).not.to.include('managedCreateMode');
    expect(edit).not.to.include('创建托管题并指定出题人');
    expect(handler).to.include('managedCreateDefault: true');
    expect(handler).not.to.include('关闭后保留管理员原有的完整创建方式');
  });

  it('has no free programming tag input and keeps normalized PIDs read-only', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    expect(edit).not.to.include('id="edit-tag"');
    expect(edit).not.to.include("name={managed ? undefined : 'tag'}");
    expect(edit).to.include("name={canEditContent && pidEditable ? 'pid' : undefined}");
    expect(edit).to.include("const pidEditable = !managed && programmingTagMode === 'unconverted'");
    expect(handler).to.include("const canonicalFields = ['tag', 'knowledgeMapId', 'knowledgeNodeIds']");
    expect(handler).to.include('编程题标签只能从知识导图选择并单独确认');
  });

  it('shows managed, converted, and unconverted states with full-path node selection', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    for (const mode of ["'managed'", "'converted'", "'unconverted'"]) expect(edit).to.include(mode);
    expect(edit).to.include('唯一匹配建议');
    expect(edit).to.include('映射歧义');
    expect(edit).to.include('无法识别的历史标签');
    expect(edit).to.include('只读来源与赛事标签');
    expect(edit).to.include('当前题目没有待迁移的历史知识标签');
    expect(edit).to.include("? '保存知识标签'");
    expect(edit).to.include("? '确认保存知识标签'");
    expect(edit).to.include('getLabel={(node) => node.label}');
    expect(edit).to.include('按完整导图路径搜索，可多选');
    expect(edit).to.include('建议已预填选择器，但尚未写入数据库');
  });

  it('uses server preview plus an explicit custom confirmation dialog for one atomic write', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    expect(edit).to.include(['`$', '{problemUrl}/tags/preview`'].join(''));
    expect(edit).to.include(['`$', '{problemUrl}/tags/apply`'].join(''));
    expect(edit).to.include("intent: 'normalize'");
    expect(edit).to.include("confirmed: 'true'");
    expect(edit).to.include('previewFingerprint: tagPreview.fingerprint');
    expect(edit).to.include('setPersistedStructureRevision(body.structureRevision)');
    expect(edit).to.include('value={String(persistedStructureRevision)}');
    expect(edit).to.include('<DialogTitle>');
    expect(edit).to.include('确认并保存标签');
    expect(edit).to.include("{ label: '保留'");
    expect(edit).to.include("{ label: '新增'");
    expect(edit).to.include("{ label: '删除'");
    for (const nativeDialog of ['window.confirm(', 'window.alert(', 'window.prompt(']) {
      expect(edit).not.to.include(nativeDialog);
    }
    expect(handler).to.include("'/p/:pid/tags/preview'");
    expect(handler).to.include("'/p/:pid/tags/apply'");
    expect(handler).to.include('applyProgrammingTagNormalization');
  });

  it('does not let ordinary save silently discard an unconfirmed node change', () => {
    const edit = read('packages/ui-next/src/pages/problem-edit.tsx');
    expect(edit).to.include('if (tagSelectionDirty) {');
    expect(edit).to.include('知识标签选择尚未确认');
    expect(edit).to.include('setPersistedMindmapNodeIds(normalizedNodeIds)');
    expect(edit).to.include(
      "(canEditContent && (dirtyState.dirty || saveState === 'saving')) || tagSelectionDirty || tagOperationState === 'applying'",
    );
  });
});
