// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLatestRequestGate } from '../src/lib/latest-request.ts';

describe('createLatestRequestGate', () => {
  it('issues monotonically increasing generations starting at 1', () => {
    const gate = createLatestRequestGate();
    expect(gate.begin()).to.equal(1);
    expect(gate.begin()).to.equal(2);
    expect(gate.begin()).to.equal(3);
  });

  it('treats only the most recent begin() as current', () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).to.equal(false);
    expect(gate.isCurrent(second)).to.equal(true);
  });

  it('rejects generations that were never issued', () => {
    const gate = createLatestRequestGate();
    gate.begin();
    expect(gate.isCurrent(99)).to.equal(false);
    expect(gate.isCurrent(0)).to.equal(false);
  });

  it('invalidate() makes the in-flight generation stale without issuing a new one', () => {
    const gate = createLatestRequestGate();
    const generation = gate.begin();
    gate.invalidate();
    expect(gate.isCurrent(generation)).to.equal(false);
    // the bump is shared with begin(), so the next request continues from it
    expect(gate.begin()).to.equal(3);
  });

  it('keeps independent gates isolated from each other', () => {
    const a = createLatestRequestGate();
    const b = createLatestRequestGate();
    a.begin();
    a.begin();
    const bGeneration = b.begin();
    expect(b.isCurrent(bGeneration)).to.equal(true);
    expect(a.isCurrent(bGeneration)).to.equal(false);
  });

  it('lets a stale async response be dropped while the latest one lands', async () => {
    const gate = createLatestRequestGate();
    const applied: string[] = [];
    const request = async (label: string, generation: number) => {
      await Promise.resolve();
      if (gate.isCurrent(generation)) applied.push(label);
    };
    const slow = request('slow', gate.begin());
    const fast = request('fast', gate.begin());
    await Promise.all([slow, fast]);
    expect(applied).to.deep.equal(['fast']);
  });
});
