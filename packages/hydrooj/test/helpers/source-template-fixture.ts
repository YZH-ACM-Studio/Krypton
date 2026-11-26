/** Persisted initial catalog fixture for tests of downstream authoring and namespace behavior. */
export function installSourceTemplateFixture() {
    const { MANAGED_SOURCE_TEMPLATES } = require('../../src/model/managed-problem-source') as typeof import('../../src/model/managed-problem-source');
    const { ValidationError } = require('../../src/error') as typeof import('../../src/error');
    const filename = require.resolve('../../src/model/problem-source-template');
    const templates = MANAGED_SOURCE_TEMPLATES.map((template) => ({ ...template, revision: 1 }));
    require.cache[filename] = {
        id: filename,
        filename,
        loaded: true,
        exports: {
            listManagedSourceTemplates: async () => structuredClone(templates),
            getManagedSourceTemplate: async (_domainId: string, id: string, forCreation = false) => {
                const template = templates.find((entry) => entry.id === id);
                if (!template || (forCreation && !template.enabled)) throw new ValidationError('template');
                return structuredClone(template);
            },
        },
    } as NodeModule;
    return templates;
}
