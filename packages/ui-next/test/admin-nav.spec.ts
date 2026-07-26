// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAdminNavRegistry,
  getAdminNavSections,
  registerAdminNavSection,
} from '../src/lib/admin-nav-registry.ts';
import type { AdminNavSection } from '../src/lib/admin-nav-registry.ts';
// Side-effect import: registers the builtin sections into the module-level registry.
import '../src/lib/admin-nav-builtins.ts';
import { PRIV } from '../src/lib/perms.ts';

// Snapshot the builtin registrations at module load, before any test clears the
// registry. The section objects stay valid after clearAdminNavRegistry() since
// only the map is emptied.
const builtinSections = getAdminNavSections();

const makeSection = (key: string, order: number, extra?: Partial<AdminNavSection>): AdminNavSection => ({
  key,
  label: `label-${key}`,
  order,
  items: [],
  ...extra,
});

describe('admin nav registry', () => {
  beforeEach(() => {
    clearAdminNavRegistry();
  });

  it('returns an empty list when nothing is registered', () => {
    expect(getAdminNavSections()).to.deep.equal([]);
  });

  it('sorts sections by ascending order regardless of registration order', () => {
    registerAdminNavSection(makeSection('late', 90));
    registerAdminNavSection(makeSection('early', 10));
    registerAdminNavSection(makeSection('middle', 50));

    expect(getAdminNavSections().map((s) => s.key)).to.deep.equal(['early', 'middle', 'late']);
  });

  it('keeps registration order for sections with equal order values', () => {
    registerAdminNavSection(makeSection('first', 30));
    registerAdminNavSection(makeSection('second', 30));
    registerAdminNavSection(makeSection('third', 30));

    // Array.prototype.sort is stable, so ties resolve by insertion order.
    expect(getAdminNavSections().map((s) => s.key)).to.deep.equal(['first', 'second', 'third']);
  });

  it('overwrites an existing section when the same key is re-registered', () => {
    registerAdminNavSection(makeSection('dup', 10, { label: 'old' }));
    registerAdminNavSection(makeSection('other', 20));
    registerAdminNavSection(makeSection('dup', 40, { label: 'new' }));

    const sections = getAdminNavSections();
    expect(sections).to.have.length(2);
    // The replacement takes the new order slot, not the original one.
    expect(sections.map((s) => s.key)).to.deep.equal(['other', 'dup']);
    expect(sections[1].label).to.equal('new');
    expect(sections[1].order).to.equal(40);
  });

  it('returns a fresh array on each call while sharing section references', () => {
    const section = makeSection('solo', 10);
    registerAdminNavSection(section);

    const first = getAdminNavSections();
    const second = getAdminNavSections();
    expect(first).to.not.equal(second);
    expect(first[0]).to.equal(section);
    expect(second[0]).to.equal(section);
  });

  it('clears every registered section', () => {
    registerAdminNavSection(makeSection('a', 1));
    registerAdminNavSection(makeSection('b', 2));
    clearAdminNavRegistry();

    expect(getAdminNavSections()).to.deep.equal([]);
  });
});

describe('builtin admin nav sections', () => {
  it('registers the four hydro sections in display order', () => {
    expect(builtinSections.map((s) => s.key)).to.deep.equal(['overview', 'domain', 'content', 'system']);
    expect(builtinSections.map((s) => s.order)).to.deep.equal([10, 20, 25, 50]);
  });

  it('gates the system section and all its items behind PRIV_EDIT_SYSTEM', () => {
    const system = builtinSections.find((s) => s.key === 'system');
    expect(system?.requiredPriv).to.equal(PRIV.PRIV_EDIT_SYSTEM);
    expect(system?.items.map((item) => item.key)).to.deep.equal(['manage_setting', 'manage_config', 'manage_script']);
    for (const item of system!.items) {
      expect(item.requiredPriv).to.equal(PRIV.PRIV_EDIT_SYSTEM);
    }
  });

  it('gates non-system sections with the domainAdmin access level', () => {
    for (const key of ['overview', 'domain', 'content']) {
      const section = builtinSections.find((s) => s.key === key);
      expect(section?.requiredAccess).to.equal('domainAdmin');
      expect(section?.requiredPriv).to.equal(undefined);
    }
  });

  it('keeps system-wide overview entries stricter than domain entries', () => {
    const overview = builtinSections.find((s) => s.key === 'overview');
    const byKey = new Map(overview!.items.map((item) => [item.key, item]));
    expect(byKey.get('manage_dashboard')?.requiredAccess).to.equal('systemAdmin');
    expect(byKey.get('status')?.requiredAccess).to.equal('systemAdmin');
    expect(byKey.get('domain_dashboard')?.requiredAccess).to.equal('domainAdmin');
  });

  it('links the domain management pages to their hydro routes', () => {
    const domain = builtinSections.find((s) => s.key === 'domain');
    expect(domain?.items.map((item) => item.href)).to.deep.equal([
      '/domain/edit',
      '/domain/user',
      '/domain/join_applications',
    ]);
    const content = builtinSections.find((s) => s.key === 'content');
    expect(content?.items.map((item) => item.href)).to.deep.equal(['/problem/import/hydro']);
  });

  it('gives every item a unique key, an absolute href and template names for highlighting', () => {
    for (const section of builtinSections) {
      const keys = section.items.map((item) => item.key);
      expect(new Set(keys).size).to.equal(keys.length);
      for (const item of section.items) {
        expect(item.label.length).to.be.greaterThan(0);
        expect(item.href.startsWith('/')).to.equal(true);
        expect(item.templateNames?.length ?? 0).to.be.greaterThan(0);
        for (const template of item.templateNames!) {
          expect(template.endsWith('.html')).to.equal(true);
        }
      }
    }
  });

  it('maps the multi-template domain user page to both raw and rendered templates', () => {
    const domain = builtinSections.find((s) => s.key === 'domain');
    const domainUser = domain?.items.find((item) => item.key === 'domain_user');
    expect(domainUser?.templateNames).to.deep.equal(['domain_user.html', 'domain_user_raw.html']);
  });
});
