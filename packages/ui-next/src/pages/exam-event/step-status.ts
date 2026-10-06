import type { StepRailItem, StepState } from '@/components/admin/step-rail';
import {
  EVENT_PANELS,
  STATUS_LABELS,
  latestPolicyRevision,
  latestTargetRevision,
  samePolicy,
  sameSources,
  type EventPanel,
  type ExamEventView,
  type NetworkConfig,
  type NetworkExecution,
  type PolicyTemplate,
  type TargetAssignment,
} from './model';

export interface EventStepFacts {
  event: ExamEventView;
  config: NetworkConfig | null;
  templates: PolicyTemplate[];
  assignment: TargetAssignment | null;
  execution: NetworkExecution | null;
}

interface StepDetail {
  state: StepState;
  summary: string;
}

function basicsDetail(event: ExamEventView): StepDetail {
  if (event.lifecycle === 'draft') return { state: 'attention', summary: '草稿 · 尚未计划' };
  if (event.lifecycle === 'archived') return { state: 'done', summary: '已归档' };
  return { state: 'done', summary: `已计划 · ${STATUS_LABELS[event.status]}` };
}

function policyDetail(facts: EventStepFacts): StepDetail {
  const assigned = facts.config?.policy;
  if (assigned == null) return { state: 'todo', summary: '尚未设置' };
  const template = facts.templates.find((item) => item.templateId === assigned.id);
  const name = template?.name ?? '策略';
  if (template != null && policyHasUnpublishedChange(template, assigned.revision)) {
    return { state: 'attention', summary: `${name} · v${assigned.revision} 生效中，有新改动` };
  }
  return { state: 'done', summary: `${name} · v${assigned.revision} 已生效` };
}

function policyHasUnpublishedChange(template: PolicyTemplate, assignedRevision: number): boolean {
  const latest = latestPolicyRevision(template);
  if (latest == null) return true;
  if (!samePolicy(template.draft.policy, latest.policy)) return true;
  return latest.revision !== assignedRevision;
}

function targetsDetail(facts: EventStepFacts): StepDetail {
  const assigned = facts.config?.target;
  if (assigned == null) return { state: 'todo', summary: '尚未设置' };
  const published = facts.assignment?.revisions.find((item) => item.revision === assigned.revision);
  const count = published ? `${published.targetCount} 台` : '数量未知';
  if (facts.assignment != null && targetHasUnpublishedChange(facts.assignment, assigned.revision)) {
    return { state: 'attention', summary: `v${assigned.revision} · ${count} 生效中，有新改动` };
  }
  return { state: 'done', summary: `v${assigned.revision} · ${count}` };
}

function targetHasUnpublishedChange(assignment: TargetAssignment, assignedRevision: number): boolean {
  const latest = latestTargetRevision(assignment);
  if (latest == null) return true;
  if (!sameSources(assignment.draft.sources, latest.sources)) return true;
  return latest.revision !== assignedRevision;
}

function runDetail(execution: NetworkExecution | null): StepDetail {
  if (execution == null) return { state: 'todo', summary: '未启动' };
  if (execution.desiredState === 'active') {
    const items = execution.projection?.items ?? [];
    const applied = items.filter((item) => item.status === 'applied').length;
    return { state: 'active', summary: `运行中 · ${applied}/${items.length} 已应用` };
  }
  if (execution.desiredState === 'stopped') return { state: 'done', summary: '已停止' };
  const unexpected: never = execution.desiredState;
  throw new Error(`未知的网络执行状态：${String(unexpected)}`);
}

function stepDetail(facts: EventStepFacts, id: EventPanel): StepDetail {
  switch (id) {
    case 'basics':
      return basicsDetail(facts.event);
    case 'policy':
      return policyDetail(facts);
    case 'targets':
      return targetsDetail(facts);
    case 'run':
      return runDetail(facts.execution);
    default: {
      const unexpected: never = id;
      throw new Error(`未知的考试活动步骤：${String(unexpected)}`);
    }
  }
}

export function eventStepItems(facts: EventStepFacts): StepRailItem<EventPanel>[] {
  return EVENT_PANELS.map((panel) => {
    const detail = stepDetail(facts, panel.id);
    return {
      id: panel.id,
      label: panel.label,
      summary: detail.summary,
      state: detail.state,
    };
  });
}

export function defaultEventPanel(facts: EventStepFacts, requested: EventPanel | null): EventPanel {
  if (requested != null) return requested;
  if (facts.event.lifecycle === 'draft') return 'basics';
  if (facts.config?.policy == null) return 'policy';
  if (facts.config.target == null) return 'targets';
  return 'run';
}
