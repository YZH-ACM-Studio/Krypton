import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isCatalogDiscoverable,
  isRedemptionVisible,
  isStageEnterable,
  matchesProblemSetBucket,
  problemSetAccessSources,
  problemSetSourceLabel,
  stageLockReason,
} from '../src/pages/training-access.ts';

const root = resolve(import.meta.dirname, '..');

describe('P3.4 problem set access UI', () => {
  it('splits catalog, enrolled, and redemption-only sources without treating enroll as authorization', () => {
    const catalog = [{ kind: 'public' as const }, { kind: 'group' as const, groupId: 'g1' }];
    const redemption = [{ kind: 'redemption' as const, entitlementId: 'e1' }];
    expect(isCatalogDiscoverable(catalog)).to.equal(true);
    expect(isRedemptionVisible(catalog)).to.equal(false);
    expect(isCatalogDiscoverable(redemption)).to.equal(false);
    expect(isRedemptionVisible(redemption)).to.equal(true);
    expect(matchesProblemSetBucket('mine', { sources: catalog }, false)).to.equal(false);
    expect(matchesProblemSetBucket('mine', { sources: redemption, enrolled: true }, true)).to.equal(true);
    expect(matchesProblemSetBucket('redemption', { sources: redemption }, false)).to.equal(true);
    expect(matchesProblemSetBucket('discoverable', { sources: catalog }, false)).to.equal(true);
    expect(problemSetAccessSources({ sources: [{ kind: 'course', courseId: 'c1' }] }).map((source) => source.kind)).to.deep.equal(['course']);
    expect(problemSetSourceLabel({ kind: 'redemption' })).to.equal('兑换');
  });

  it('does not treat locked stages as enterable problem pages', () => {
    expect(isStageEnterable({ isOpen: true })).to.equal(true);
    expect(isStageEnterable({ isProgress: true })).to.equal(true);
    expect(isStageEnterable({ isDone: true })).to.equal(true);
    expect(isStageEnterable({ isOpen: false, isProgress: false, isDone: false })).to.equal(false);
    expect(isStageEnterable({ isOpen: true, hasAccess: false })).to.equal(false);
    expect(stageLockReason({ hasAccess: false })).to.equal('no_access');
    expect(stageLockReason({ isOpen: false })).to.equal('prereq');
  });

  it('uses 开始题集, source chips, and locked-stage copy on the student pages', () => {
    const list = readFileSync(resolve(root, 'src/pages/training.tsx'), 'utf8');
    const manage = readFileSync(resolve(root, 'src/pages/training-manage.tsx'), 'utf8');
    expect(list).to.include('开始题集');
    expect(list).to.include('可发现');
    expect(list).to.include('我的题集');
    expect(list).to.include('兑换获得');
    expect(list).to.include('problemSetSourceLabel');
    expect(list).to.include('isStageEnterable');
    expect(list).to.include('未获得访问权');
    expect(list).to.include('前置阶段未完成');
    expect(list).to.not.match(/参加题集/);
    expect(manage).to.include('audiencePublic');
    expect(manage).to.include('audienceGroupIds');
  });
});
