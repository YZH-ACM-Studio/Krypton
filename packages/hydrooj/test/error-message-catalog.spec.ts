import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import yaml from 'js-yaml';
import ts from 'typescript';
import {
    describeHydroError,
    ERROR_MESSAGE_CLASSIFICATIONS,
    ERROR_MESSAGE_TRANSLATIONS,
    HydroError,
    localizeError,
    localizeErrorParameter,
    localizedErrorText,
    lookupErrorMessageTranslation,
    resolveErrorMessage,
    BadRequestError,
    NotFoundError,
    UserFacingError,
    ValidationError,
} from '@hydrooj/framework';
import {
    AccessDeniedError,
    AccountStateConflictError,
    ContestNotFoundError,
    ContestNotLiveError,
    DocumentNotFoundError,
    DomainJoinForbiddenError,
    HackFailedError,
    InvalidTokenError,
    ManagedProblemMetadataConflictError,
    NotAssignedError,
    OpcountExceededError,
    PermissionError,
    ProblemIsReferencedError,
    ProblemNotFoundError,
    ProblemStructureConflictError,
    RecordNotFoundError,
    SendMailError,
    UserNotFoundError,
} from '../src/error';
import { examTeacherCatalogTranslations } from '@hydrooj/common';
import { getProblemConfigErrorText, validateStructuredCodeTemplate } from '../src/lib/problem-config';

const workspaceRoot = process.cwd();
const canonicalFiles = ['framework/framework/error.ts', 'packages/hydrooj/src/error.ts', 'packages/hydrooj/src/lib/auth-token.ts'] as const;
const userFacingConstructors = new Map([
    ['ValidationError', 2],
    ['BadRequestError', 0],
    ['ForbiddenError', 0],
    ['MethodNotAllowedError', 0],
    ['NotFoundError', 0],
    ['UserFacingError', 0],
    ['MindmapRequestError', 0],
    ['MindmapConflictError', 0],
]);
const sourceRoots = ['framework/framework', 'packages'] as const;
const skippedDirectories = new Set(['dev', 'node_modules', 'output', 'public', 'test', 'tests', 'tmp']);

function placeholderIndexes(template: string): number[] {
    return [...template.matchAll(/\{(0|[1-9]\d*)\}/g)].map((match) => Number(match[1])).sort((a, b) => a - b);
}

function canonicalTemplates(): Array<{ file: string; line: number; template: string }> {
    const result: Array<{ file: string; line: number; template: string }> = [];
    for (const file of canonicalFiles) {
        const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const add = (node: ts.StringLiteralLike) => {
            result.push({
                file,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                template: node.text,
            });
        };
        const walk = (node: ts.Node) => {
            if (ts.isCallExpression(node) && ['Err', 'CreateError'].includes(node.expression.getText(sourceFile))) {
                for (const argument of node.arguments.slice(2)) {
                    if (ts.isStringLiteralLike(argument)) add(argument);
                    const findReturns = (child: ts.Node) => {
                        if (ts.isReturnStatement(child) && child.expression && ts.isStringLiteralLike(child.expression)) {
                            add(child.expression);
                        }
                        ts.forEachChild(child, findReturns);
                    };
                    if (ts.isFunctionExpression(argument) || ts.isArrowFunction(argument)) findReturns(argument);
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }
    return result;
}

function canonicalConstructorRequirements(): Map<string, number> {
    const result = new Map<string, number>();
    for (const file of canonicalFiles) {
        const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const walk = (node: ts.Node) => {
            if (
                ts.isVariableDeclaration(node) &&
                ts.isIdentifier(node.name) &&
                node.initializer &&
                ts.isCallExpression(node.initializer) &&
                ['Err', 'CreateError'].includes(node.initializer.expression.getText(sourceFile))
            ) {
                let requiredArguments = 0;
                let hasDeterministicTemplate = false;
                for (const argument of node.initializer.arguments.slice(2)) {
                    if (ts.isStringLiteralLike(argument)) {
                        hasDeterministicTemplate = true;
                        for (const index of placeholderIndexes(argument.text)) {
                            requiredArguments = Math.max(requiredArguments, index + 1);
                        }
                    }
                    const returnedRequirements: number[] = [];
                    const findReturns = (child: ts.Node) => {
                        if (ts.isReturnStatement(child) && child.expression && ts.isStringLiteralLike(child.expression)) {
                            returnedRequirements.push(
                                placeholderIndexes(child.expression.text).reduce((maximum, index) => Math.max(maximum, index + 1), 0),
                            );
                        }
                        ts.forEachChild(child, findReturns);
                    };
                    if (ts.isFunctionExpression(argument) || ts.isArrowFunction(argument)) {
                        findReturns(argument);
                        if (returnedRequirements.length && new Set(returnedRequirements).size === 1) {
                            hasDeterministicTemplate = true;
                            requiredArguments = Math.max(requiredArguments, returnedRequirements[0]);
                        }
                    }
                }
                if (hasDeterministicTemplate) result.set(node.name.text, requiredArguments);
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }
    return result;
}

function sourceFiles(directory: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(resolve(workspaceRoot, directory), { withFileTypes: true })) {
        if (skippedDirectories.has(entry.name)) continue;
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) result.push(...sourceFiles(relative));
        else if (entry.isFile() && /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(entry.name)) result.push(relative);
    }
    return result;
}

function taggedTemplate(node: ts.TaggedTemplateExpression, sourceFile: ts.SourceFile): string | null {
    if (node.tag.getText(sourceFile) !== 'localizedErrorText') return null;
    if (ts.isNoSubstitutionTemplateLiteral(node.template)) return node.template.text;
    let result = node.template.head.text;
    node.template.templateSpans.forEach((span, index) => {
        result += `{${index}}${span.literal.text}`;
    });
    return result;
}

function isLocalizedErrorTextParameter(argument: ts.Expression, sourceFile: ts.SourceFile): boolean {
    if (!ts.isIdentifier(argument)) return false;
    let current: ts.Node | undefined = argument.parent;
    while (current) {
        if (ts.isFunctionLike(current)) {
            return current.parameters.some(
                (parameter) =>
                    ts.isIdentifier(parameter.name) &&
                    parameter.name.text === argument.text &&
                    parameter.type?.getText(sourceFile) === 'LocalizedErrorText',
            );
        }
        current = current.parent;
    }
    return false;
}

function usesExplicitLocalizedMetadata(node: ts.NewExpression, sourceFile: ts.SourceFile): boolean {
    const parent = node.parent;
    if (!ts.isCallExpression(parent) || parent.arguments[0] !== node || parent.expression.getText(sourceFile) !== 'localizeErrorParameter') {
        return false;
    }
    const template = parent.arguments[2];
    return (
        !!template &&
        ts.isPropertyAccessExpression(template) &&
        template.name.text === 'template' &&
        ts.isPropertyAccessExpression(template.expression) &&
        template.expression.name.text === 'localizedMessage'
    );
}

function explicitTemplate(node: ts.NewExpression, argument: ts.Expression, sourceFile: ts.SourceFile): string | null {
    if (ts.isTaggedTemplateExpression(argument)) return taggedTemplate(argument, sourceFile);
    const parent = node.parent;
    if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) return null;
    const helper = parent.expression.getText(sourceFile);
    const templateArgument = helper === 'localizeError' ? parent.arguments[1] : helper === 'localizeErrorParameter' ? parent.arguments[2] : null;
    return templateArgument && ts.isStringLiteralLike(templateArgument) ? templateArgument.text : null;
}

function userFacingTemplates(): Array<{ file: string; line: number; callee: string; template: string | null; explicit: boolean }> {
    const result: Array<{ file: string; line: number; callee: string; template: string | null; explicit: boolean }> = [];
    for (const root of sourceRoots) {
        for (const file of sourceFiles(root)) {
            const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
            const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            const walk = (node: ts.Node) => {
                if (ts.isNewExpression(node)) {
                    const callee = node.expression.getText(sourceFile);
                    const argumentIndex = userFacingConstructors.get(callee);
                    const argument = argumentIndex === undefined ? undefined : node.arguments?.[argumentIndex];
                    if (argument) {
                        const template = explicitTemplate(node, argument, sourceFile);
                        result.push({
                            file,
                            line: sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile)).line + 1,
                            callee,
                            template,
                            explicit:
                                template !== null ||
                                isLocalizedErrorTextParameter(argument, sourceFile) ||
                                usesExplicitLocalizedMetadata(node, sourceFile),
                        });
                    }
                }
                ts.forEachChild(node, walk);
            };
            walk(sourceFile);
        }
    }
    return result;
}

function fixedExpressionTemplates(node: ts.Expression): string[] {
    if (ts.isStringLiteralLike(node)) return node.text ? [node.text] : [];
    if (ts.isTemplateExpression(node)) {
        let template = node.head.text;
        node.templateSpans.forEach((span, index) => {
            template += `{${index}}${span.literal.text}`;
        });
        return template ? [template] : [];
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        return fixedExpressionTemplates(node.expression);
    }
    if (ts.isConditionalExpression(node)) {
        return [...fixedExpressionTemplates(node.whenTrue), ...fixedExpressionTemplates(node.whenFalse)];
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
        return [...fixedExpressionTemplates(node.left), ...fixedExpressionTemplates(node.right)];
    }
    return [];
}

function embeddedErrorTemplates(node: ts.Expression): string[] {
    const direct = fixedExpressionTemplates(node);
    if (direct.length) return direct;
    if (ts.isAwaitExpression(node)) return embeddedErrorTemplates(node.expression);
    if (ts.isCallExpression(node)) return node.arguments.flatMap(embeddedErrorTemplates);
    if (ts.isObjectLiteralExpression(node)) {
        return node.properties.flatMap((property) => (ts.isPropertyAssignment(property) ? embeddedErrorTemplates(property.initializer) : []));
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => embeddedErrorTemplates(element as ts.Expression));
    if (ts.isArrowFunction(node) && ts.isExpression(node.body)) return embeddedErrorTemplates(node.body);
    return [];
}

function explicitLocalizedCalls(): Array<{ file: string; line: number; template: string; providedParameterCount: number }> {
    const result: Array<{ file: string; line: number; template: string; providedParameterCount: number }> = [];
    for (const root of sourceRoots) {
        for (const file of sourceFiles(root)) {
            const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
            const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            const walk = (node: ts.Node) => {
                if (ts.isCallExpression(node)) {
                    const helper = node.expression.getText(sourceFile);
                    const templateIndex = helper === 'localizeError' ? 1 : helper === 'localizeErrorParameter' ? 2 : -1;
                    const templateArgument = templateIndex >= 0 ? node.arguments[templateIndex] : undefined;
                    if (templateArgument && ts.isStringLiteralLike(templateArgument)) {
                        result.push({
                            file,
                            line: sourceFile.getLineAndCharacterOfPosition(templateArgument.getStart(sourceFile)).line + 1,
                            template: templateArgument.text,
                            providedParameterCount: node.arguments.length - templateIndex - 1,
                        });
                    }
                }
                ts.forEachChild(node, walk);
            };
            walk(sourceFile);
        }
    }
    return result;
}

function localizedErrorTextTemplates(): Array<{ file: string; line: number; template: string }> {
    const result: Array<{ file: string; line: number; template: string }> = [];
    for (const root of sourceRoots) {
        for (const file of sourceFiles(root)) {
            const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
            const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            const walk = (node: ts.Node) => {
                if (ts.isTaggedTemplateExpression(node)) {
                    const template = taggedTemplate(node, sourceFile);
                    if (template !== null) {
                        result.push({
                            file,
                            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                            template,
                        });
                    }
                }
                ts.forEachChild(node, walk);
            };
            walk(sourceFile);
        }
    }
    return result;
}

function uiNextPlainErrorTemplates(): Array<{ file: string; line: number; template: string }> {
    const result: Array<{ file: string; line: number; template: string }> = [];
    for (const file of sourceFiles('packages/ui-next/src')) {
        const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const walk = (node: ts.Node) => {
            if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === 'Error' && node.arguments?.[0]) {
                for (const template of embeddedErrorTemplates(node.arguments[0])) {
                    result.push({
                        file,
                        line: sourceFile.getLineAndCharacterOfPosition(node.arguments[0].getStart(sourceFile)).line + 1,
                        template,
                    });
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }
    return result;
}

function pluginPlainHandlerErrors(): Array<{ file: string; line: number; template: string }> {
    const result: Array<{ file: string; line: number; template: string }> = [];
    const pluginSourceFiles = sourceFiles('packages').filter((file) => /^packages\/krypton-[^/]+\/src\/(?:handler|model)(?:\/|\.ts$)/.test(file));
    for (const file of pluginSourceFiles) {
        const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const walk = (node: ts.Node) => {
            if (
                ts.isThrowStatement(node) &&
                node.expression &&
                ts.isNewExpression(node.expression) &&
                node.expression.expression.getText(sourceFile) === 'Error' &&
                node.expression.arguments?.[0]
            ) {
                for (const template of embeddedErrorTemplates(node.expression.arguments[0])) {
                    result.push({
                        file,
                        line: sourceFile.getLineAndCharacterOfPosition(node.expression.getStart(sourceFile)).line + 1,
                        template,
                    });
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }
    return result;
}

function humanErrorParameterTemplates(): Array<{ file: string; line: number; callee: string; template: string; explicit: boolean }> {
    const result: Array<{ file: string; line: number; callee: string; template: string; explicit: boolean }> = [];
    const parameterIndexes = new Map([
        ['PermissionError', 0],
        ['DomainJoinForbiddenError', 1],
        ['ManagedProblemMetadataConflictError', 0],
        ['AccountStateConflictError', 0],
        ['ContestTeamConflictError', 0],
        ['HackFailedError', 0],
        ['InvalidTokenError', 0],
        ['NotAssignedError', 0],
        ['ProblemIsReferencedError', 0],
    ]);
    for (const root of sourceRoots) {
        for (const file of sourceFiles(root)) {
            const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
            const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            const walk = (node: ts.Node) => {
                if (ts.isNewExpression(node)) {
                    const callee = node.expression.getText(sourceFile);
                    const index = parameterIndexes.get(callee);
                    const argument = index === undefined ? undefined : node.arguments?.[index];
                    if (argument) {
                        const templates = ts.isTaggedTemplateExpression(argument)
                            ? [taggedTemplate(argument, sourceFile)].filter((template): template is string => template !== null)
                            : fixedExpressionTemplates(argument);
                        for (const template of templates) {
                            result.push({
                                file,
                                line: sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile)).line + 1,
                                callee,
                                template,
                                explicit: ts.isTaggedTemplateExpression(argument),
                            });
                        }
                    }
                }
                ts.forEachChild(node, walk);
            };
            walk(sourceFile);
        }
    }
    return result;
}

function validationHumanParameterTemplates(): Array<{
    file: string;
    line: number;
    index: number;
    template: string;
    explicit: boolean;
}> {
    const result: Array<{ file: string; line: number; index: number; template: string; explicit: boolean }> = [];
    for (const root of sourceRoots) {
        for (const file of sourceFiles(root)) {
            const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
            const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            const walk = (node: ts.Node) => {
                if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === 'ValidationError') {
                    for (const index of [1, 2]) {
                        const argument = node.arguments?.[index];
                        if (!argument) continue;
                        const templates = ts.isTaggedTemplateExpression(argument)
                            ? [taggedTemplate(argument, sourceFile)].filter((template): template is string => template !== null)
                            : fixedExpressionTemplates(argument);
                        const parent = node.parent;
                        const parentCall = ts.isCallExpression(parent) && parent.arguments[0] === node ? parent : null;
                        const helper = parentCall?.expression.getText(sourceFile) ?? '';
                        const localizedParameterIndex =
                            helper === 'localizeErrorParameter' && parentCall?.arguments[1] && ts.isNumericLiteral(parentCall.arguments[1])
                                ? Number(parentCall.arguments[1].text)
                                : -1;
                        const explicit = ts.isTaggedTemplateExpression(argument) || helper === 'localizeError' || localizedParameterIndex === index;
                        for (const template of templates) {
                            if (!template || !/[\u3400-\u9FFF\s.!?，。；：]/.test(template)) continue;
                            result.push({
                                file,
                                line: sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile)).line + 1,
                                index,
                                template,
                                explicit,
                            });
                        }
                    }
                }
                ts.forEachChild(node, walk);
            };
            walk(sourceFile);
        }
    }
    return result;
}

function studentFilterValidationTemplates(): Array<{ file: string; line: number; template: string | null }> {
    const file = 'packages/krypton-userbind/src/student-filter.ts';
    const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const result: Array<{ file: string; line: number; template: string | null }> = [];
    const walk = (node: ts.Node) => {
        if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === 'StudentFilterValidationError' && node.arguments?.[1]) {
            const templates = fixedExpressionTemplates(node.arguments[1]);
            result.push({
                file,
                line: sourceFile.getLineAndCharacterOfPosition(node.arguments[1].getStart(sourceFile)).line + 1,
                template: templates.length === 1 ? templates[0] : null,
            });
        }
        ts.forEachChild(node, walk);
    };
    walk(sourceFile);
    return result;
}

function systemOwnedApiResponseFields(): Array<{
    file: string;
    line: number;
    field: 'error' | 'message' | 'errorMessage';
    template: string;
}> {
    const result: Array<{
        file: string;
        line: number;
        field: 'error' | 'message' | 'errorMessage';
        template: string;
    }> = [];
    const serverFiles = sourceFiles('packages').filter(
        (file) => !/^packages\/(?:ui-default|ui-next|hydrojudge|vjudge|migrate)\//.test(file) && !/\/(?:script|scripts)\//.test(file),
    );
    for (const file of serverFiles) {
        const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const addField = (node: ts.PropertyAssignment) => {
            const field = node.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
            if (field !== 'error' && field !== 'message' && field !== 'errorMessage') return;
            for (const template of fixedExpressionTemplates(node.initializer)) {
                result.push({
                    file,
                    line: sourceFile.getLineAndCharacterOfPosition(node.initializer.getStart(sourceFile)).line + 1,
                    field,
                    template,
                });
            }
        };
        const inspectPayload = (payload: ts.Node, includeError: boolean) => {
            const walkPayload = (node: ts.Node) => {
                if (ts.isPropertyAssignment(node)) {
                    const field = node.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
                    if (includeError || field !== 'error') addField(node);
                }
                ts.forEachChild(node, walkPayload);
            };
            walkPayload(payload);
        };
        const belongsToFailureResult = (node: ts.PropertyAssignment) => {
            if (!ts.isObjectLiteralExpression(node.parent)) return false;
            return node.parent.properties.some((property) => {
                if (!ts.isPropertyAssignment(property)) return false;
                const field = property.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
                const value = property.initializer.getText(sourceFile);
                return (
                    (field === 'ok' && value === 'false') ||
                    (field === 'finished' && value === 'true') ||
                    (field === 'status' && ["'invalid'", "'duplicate'", '"invalid"', '"duplicate"'].includes(value)) ||
                    (field === 'state' && ["'invalid'", '"invalid"'].includes(value))
                );
            });
        };
        const walk = (node: ts.Node) => {
            if (
                ts.isBinaryExpression(node) &&
                node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                /\.response\.body$/.test(node.left.getText(sourceFile))
            ) {
                inspectPayload(node.right, false);
            }
            if (ts.isPropertyAssignment(node) && (/\/src\/handler\//.test(file) || file === 'packages/onsite-toolkit/submit.ts')) {
                const field = node.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
                if (field === 'error' || belongsToFailureResult(node)) addField(node);
            }
            if (
                file === 'packages/onsite-toolkit/submit.ts' &&
                ts.isReturnStatement(node) &&
                node.expression &&
                ts.isObjectLiteralExpression(node.expression)
            ) {
                inspectPayload(node.expression, false);
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }
    return result;
}

function uiNextLocalErrorTemplates(): Array<{ file: string; line: number; template: string }> {
    const result: Array<{ file: string; line: number; template: string }> = [];
    for (const file of sourceFiles('packages/ui-next/src')) {
        const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const walk = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                const isErrorSetter = ts.isIdentifier(node.expression) && /^set(?:.*Error.*|.*Err)$/.test(node.expression.text);
                const isToastError =
                    ts.isPropertyAccessExpression(node.expression) &&
                    node.expression.expression.getText(sourceFile) === 'toast' &&
                    node.expression.name.text === 'error';
                const isAlert = ts.isIdentifier(node.expression) && node.expression.text === 'alert';
                if (isErrorSetter || isToastError || isAlert) {
                    for (const argument of node.arguments) {
                        for (const template of embeddedErrorTemplates(argument)) {
                            result.push({
                                file,
                                line: sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile)).line + 1,
                                template,
                            });
                        }
                    }
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }
    return result;
}

function uiDefaultLocalErrorTemplates(): {
    direct: Array<{ file: string; line: number; template: string }>;
    localized: Array<{ file: string; line: number; template: string; providedParameterCount: number }>;
} {
    const direct: Array<{ file: string; line: number; template: string }> = [];
    const localized: Array<{ file: string; line: number; template: string; providedParameterCount: number }> = [];
    for (const file of sourceFiles('packages/ui-default')) {
        const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const walk = (node: ts.Node) => {
            if (!ts.isCallExpression(node)) {
                ts.forEachChild(node, walk);
                return;
            }
            const isNotification =
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.expression.getText(sourceFile) === 'Notification' &&
                ['error', 'warn'].includes(node.expression.name.text);
            const isAlert = ts.isIdentifier(node.expression) && node.expression.text === 'alert';
            if ((isNotification || isAlert) && node.arguments[0]) {
                const argument = node.arguments[0];
                const line = sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile)).line + 1;
                if (ts.isCallExpression(argument) && argument.expression.getText(sourceFile) === 'i18n' && argument.arguments[0]) {
                    for (const template of fixedExpressionTemplates(argument.arguments[0])) {
                        localized.push({
                            file,
                            line,
                            template,
                            providedParameterCount: argument.arguments.length - 1,
                        });
                    }
                } else {
                    for (const template of fixedExpressionTemplates(argument)) {
                        if (template.replace(/\{\d+\}/g, '').trim()) direct.push({ file, line, template });
                    }
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }
    return { direct, localized };
}

describe('P2.43 error message catalog', () => {
    it('classifies every canonical user-facing template without broad exceptions', () => {
        const unclassified = canonicalTemplates().filter(
            ({ template }) => !(template in ERROR_MESSAGE_TRANSLATIONS) && !(template in ERROR_MESSAGE_CLASSIFICATIONS),
        );
        assert.deepEqual(unclassified, [], unclassified.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'));
        assert.deepEqual(ERROR_MESSAGE_CLASSIFICATIONS.SystemError, {
            classification: 'internal_log',
            reason: 'Unexpected server failures use the safe trace-ID response instead of this internal class label.',
        });
        for (const [template, classification] of Object.entries(ERROR_MESSAGE_CLASSIFICATIONS)) {
            assert.ok(
                ['external_text', 'internal_log', 'machine_code'].includes(classification.classification),
                `${template} has an invalid classification`,
            );
            assert.ok(classification.reason.trim(), `${template} has no classification reason`);
        }
    });

    it('keeps source, English and Chinese placeholder sets identical', () => {
        for (const [source, translations] of Object.entries(ERROR_MESSAGE_TRANSLATIONS)) {
            const expected = placeholderIndexes(source);
            assert.deepEqual(placeholderIndexes(translations.en), expected, `English placeholders drifted for ${source}`);
            assert.deepEqual(placeholderIndexes(translations['zh-CN']), expected, `Chinese placeholders drifted for ${source}`);
            assert.ok(
                !/\{\d+\}/.test(
                    resolveErrorMessage(
                        {
                            name: 'CatalogProbe',
                            errorCode: 'CatalogProbe',
                            status: 400,
                            template: source,
                            params: expected.map((index) => `value-${index}`),
                            messageParams: Object.fromEntries(expected.map((index) => [index, `value-${index}`])),
                        },
                        {
                            locale: 'zh-CN',
                            lookup: lookupErrorMessageTranslation,
                            createTraceId: () => 'catalog-test-trace',
                        },
                    ).message,
                ),
            );
        }
    });

    it('requires explicit localized metadata for every first-party user-facing call site', () => {
        const entries = userFacingTemplates();
        const missingMetadata = entries.filter(({ explicit }) => !explicit);
        assert.deepEqual(missingMetadata, [], missingMetadata.map(({ file, line, callee }) => `${file}:${line} ${callee}`).join('\n'));
        const missingCatalog = entries.filter(
            ({ template }) => template !== null && !(template in ERROR_MESSAGE_TRANSLATIONS) && !(template in ERROR_MESSAGE_CLASSIFICATIONS),
        );
        assert.deepEqual(
            missingCatalog,
            [],
            missingCatalog.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'),
        );
    });

    it('catalogs every explicit localizer call and validates its placeholders', () => {
        const entries = explicitLocalizedCalls();
        const missing = entries.filter(({ template }) => !(template in ERROR_MESSAGE_TRANSLATIONS) && !(template in ERROR_MESSAGE_CLASSIFICATIONS));
        assert.deepEqual(missing, [], missing.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'));
        const invalidParameters = entries.filter(({ template, providedParameterCount }) => {
            const indexes = [...new Set(placeholderIndexes(template))];
            return indexes.length !== providedParameterCount || indexes.some((index, expected) => index !== expected);
        });
        assert.deepEqual(
            invalidParameters,
            [],
            invalidParameters
                .map(
                    ({ file, line, template, providedParameterCount }) =>
                        `${file}:${line} ${JSON.stringify(template)} received ${providedParameterCount} parameter(s)`,
                )
                .join('\n'),
        );
    });

    it('catalogs every explicit localizedErrorText template', () => {
        const missing = localizedErrorTextTemplates().filter(
            ({ template }) => !(template in ERROR_MESSAGE_TRANSLATIONS) && !(template in ERROR_MESSAGE_CLASSIFICATIONS),
        );
        assert.deepEqual(missing, [], missing.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'));
    });

    it('requires concrete Hydro error constructors to supply every referenced parameter', () => {
        const requirements = canonicalConstructorRequirements();
        const invalid: Array<{ file: string; line: number; callee: string; actual: number; required: number }> = [];
        for (const root of sourceRoots) {
            for (const file of sourceFiles(root)) {
                const source = readFileSync(resolve(workspaceRoot, file), 'utf8');
                const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
                const walk = (node: ts.Node) => {
                    if (ts.isNewExpression(node)) {
                        const callee = node.expression.getText(sourceFile);
                        const required = requirements.get(callee);
                        const actual = node.arguments?.length || 0;
                        const parent = node.parent;
                        const hasLocalizedMessageOverride =
                            ts.isCallExpression(parent) && parent.arguments[0] === node && parent.expression.getText(sourceFile) === 'localizeError';
                        if (required && actual < required && !hasLocalizedMessageOverride) {
                            invalid.push({
                                file,
                                line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                                callee,
                                actual,
                                required,
                            });
                        }
                    }
                    ts.forEachChild(node, walk);
                };
                walk(sourceFile);
            }
        }
        assert.deepEqual(
            invalid,
            [],
            invalid
                .map(({ file, line, callee, actual, required }) => `${file}:${line} ${callee} received ${actual}, requires ${required}`)
                .join('\n'),
        );
    });

    it('catalogs every fixed ui-next local error', () => {
        const missing = [...uiNextLocalErrorTemplates(), ...uiNextPlainErrorTemplates()].filter(
            ({ template }) => !(template in ERROR_MESSAGE_TRANSLATIONS) && !(template in ERROR_MESSAGE_CLASSIFICATIONS),
        );
        assert.deepEqual(missing, [], missing.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'));
    });

    it('requires fixed plain errors in plugin request handlers to be explicit internal logs', () => {
        const invalid = pluginPlainHandlerErrors().filter(
            ({ template }) =>
                !(template in ERROR_MESSAGE_CLASSIFICATIONS) || ERROR_MESSAGE_CLASSIFICATIONS[template].classification !== 'internal_log',
        );
        assert.deepEqual(invalid, [], invalid.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'));
    });

    it('catalogs fixed human detail parameters used by first-party errors', () => {
        const entries = humanErrorParameterTemplates();
        const alwaysExplicit = new Set(['HackFailedError', 'InvalidTokenError', 'NotAssignedError', 'ProblemIsReferencedError']);
        const implicitHumanText = entries.filter(
            ({ callee, template, explicit }) =>
                !explicit && (alwaysExplicit.has(callee) || /[\u3400-\u9FFF]/.test(template) || /[\s.!?，。；：]/.test(template)),
        );
        assert.deepEqual(
            implicitHumanText,
            [],
            implicitHumanText
                .map(({ file, line, callee, template }) => `${file}:${line} ${callee} must explicitly localize ${JSON.stringify(template)}`)
                .join('\n'),
        );
        const missing = entries.filter(({ template }) => !(template in ERROR_MESSAGE_TRANSLATIONS) && !(template in ERROR_MESSAGE_CLASSIFICATIONS));
        assert.deepEqual(
            missing,
            [],
            missing.map(({ file, line, callee, template }) => `${file}:${line} ${callee} ${JSON.stringify(template)}`).join('\n'),
        );
    });

    it('requires fixed human ValidationError parameters to use explicit localization metadata', () => {
        const invalid = validationHumanParameterTemplates().filter(({ explicit }) => !explicit);
        assert.deepEqual(
            invalid,
            [],
            invalid.map(({ file, line, index, template }) => `${file}:${line} parameter ${index} ${JSON.stringify(template)}`).join('\n'),
        );
    });

    it('keeps pure student-filter reasons fixed and cataloged at the HTTP boundary', () => {
        const entries = studentFilterValidationTemplates();
        const invalid = entries.filter(({ template }) => !template);
        assert.deepEqual(invalid, [], invalid.map(({ file, line }) => `${file}:${line} must use one fixed validation reason`).join('\n'));
        const missing = entries.filter(
            ({ template }) => template && !(template in ERROR_MESSAGE_TRANSLATIONS) && !(template in ERROR_MESSAGE_CLASSIFICATIONS),
        );
        assert.deepEqual(missing, [], missing.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'));
    });

    it('classifies every fixed system-owned API response error and localizes its human messages', () => {
        const fields = systemOwnedApiResponseFields();
        const missing = fields.filter(({ template }) => !(template in ERROR_MESSAGE_TRANSLATIONS) && !(template in ERROR_MESSAGE_CLASSIFICATIONS));
        assert.deepEqual(
            missing,
            [],
            missing.map(({ file, line, field, template }) => `${file}:${line} ${field}=${JSON.stringify(template)}`).join('\n'),
        );
        const invalidMachineCodes = fields.filter(
            ({ field, template }) =>
                field === 'error' &&
                template in ERROR_MESSAGE_CLASSIFICATIONS &&
                ERROR_MESSAGE_CLASSIFICATIONS[template].classification !== 'machine_code',
        );
        assert.deepEqual(
            invalidMachineCodes,
            [],
            invalidMachineCodes.map(({ file, line, template }) => `${file}:${line} error=${JSON.stringify(template)} is not machine_code`).join('\n'),
        );
        const classifiedHumanMessages = fields.filter(({ field, template }) => field !== 'error' && template in ERROR_MESSAGE_CLASSIFICATIONS);
        assert.deepEqual(
            classifiedHumanMessages,
            [],
            classifiedHumanMessages
                .map(({ file, line, field, template }) => `${file}:${line} ${field}=${JSON.stringify(template)} must be localized`)
                .join('\n'),
        );
    });

    it('requires ui-default fixed local errors to use translated i18n keys', () => {
        const uiDefault = uiDefaultLocalErrorTemplates();
        assert.deepEqual(
            uiDefault.direct,
            [],
            uiDefault.direct.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'),
        );
        const translations = yaml.load(readFileSync(resolve(workspaceRoot, 'packages/ui-default/locales/zh.yaml'), 'utf8')) as Record<
            string,
            unknown
        >;
        const missing = uiDefault.localized.filter(({ template }) => !(template in translations));
        assert.deepEqual(missing, [], missing.map(({ file, line, template }) => `${file}:${line} ${JSON.stringify(template)}`).join('\n'));
        const invalidParameters = uiDefault.localized.filter(({ template, providedParameterCount }) => {
            const indexes = [...new Set(placeholderIndexes(template))];
            return indexes.length !== providedParameterCount || indexes.some((index, expected) => index !== expected);
        });
        assert.deepEqual(
            invalidParameters,
            [],
            invalidParameters
                .map(
                    ({ file, line, template, providedParameterCount }) =>
                        `${file}:${line} ${JSON.stringify(template)} received ${providedParameterCount} parameter(s)`,
                )
                .join('\n'),
        );
    });

    it('catalogs every exam teacher Chinese sentence', () => {
        const missing = Object.keys(examTeacherCatalogTranslations()).filter((template) => !(template in ERROR_MESSAGE_TRANSLATIONS));
        assert.deepEqual(missing, [], missing.map((template) => JSON.stringify(template)).join('\n'));
    });

    it('supports explicit English and fixed zh-CN without falling back to source text', () => {
        assert.equal(lookupErrorMessageTranslation('Access denied.', 'zh-CN'), '访问被拒绝。');
        assert.equal(lookupErrorMessageTranslation('Access denied.', 'en-US'), 'Access denied.');
        assert.equal(lookupErrorMessageTranslation('访问令牌无效、已撤销或已过期。', 'en'), 'The access token is invalid, revoked, or expired.');
        assert.equal(lookupErrorMessageTranslation('missing catalog key', 'zh-CN'), null);
    });

    it('restores the second SendMailError placeholder', () => {
        const error = new SendMailError('teacher@example.com', 'SMTP unavailable');
        const result = resolveErrorMessage(describeHydroError(error), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.equal(result.message, '向 teacher@example.com 发送邮件失败。（SMTP unavailable）');
        assert.deepEqual(result.params, ['teacher@example.com', 'SMTP unavailable']);
    });

    it('localizes dynamic first-party details without changing raw machine params', () => {
        const rawDetail = 'Request is already approved';
        const validation = localizeErrorParameter(new ValidationError('status', null, rawDetail), 2, 'Request is already {0}.', 'approved');
        const result = resolveErrorMessage(describeHydroError(validation), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(result.params, ['status', null, rawDetail]);
        assert.equal(result.message, '字段 status 验证失败。（请求状态已经是 approved。）');

        const topLevel = localizeError(new ValidationError('operation'), 'Operation {0} is invalid.', 'publish');
        const topLevelResult = resolveErrorMessage(describeHydroError(topLevel), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(topLevelResult.params, ['operation']);
        assert.equal(topLevelResult.message, '操作 publish 无效。');

        const validationDetail = localizedErrorText`${'uid'} 必须是正整数`;
        const detailedValidation = new ValidationError('uid', null, validationDetail);
        const detailedValidationResult = resolveErrorMessage(describeHydroError(detailedValidation), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(detailedValidationResult.params, ['uid', null, validationDetail.raw]);
        assert.equal(detailedValidationResult.message, '字段 uid 验证失败。（uid 必须是正整数）');
        assert.equal(
            resolveErrorMessage(describeHydroError(detailedValidation), {
                locale: 'en',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            'Field uid validation failed. (uid must be a positive integer.)',
        );

        const mindmapDetail = '题目不存在或不属于当前域：P1000；题号有歧义：P2000';
        const detailedMindmap = localizeError(
            new UserFacingError(mindmapDetail, { reason: 'problem-resolution' }),
            'The requested problems could not be resolved (missing or outside the current domain: {0}; ambiguous: {1}; belongs to another map: {2}).',
            'P1000',
            'P2000',
            '-',
        );
        const detailedMindmapResult = resolveErrorMessage(describeHydroError(detailedMindmap), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(detailedMindmapResult.params, [mindmapDetail, { reason: 'problem-resolution' }]);
        assert.equal(detailedMindmapResult.message, '无法解析请求的题目（不存在或不属于当前域：P1000；题号有歧义：P2000；属于另一张导图：-）。');
        assert.equal(
            resolveErrorMessage(describeHydroError(detailedMindmap), {
                locale: 'en',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            'The requested problems could not be resolved (missing or outside the current domain: P1000; ambiguous: P2000; belongs to another map: -).',
        );

        const oauthError = localizeError(
            new UserFacingError('bad_verification_code', 'The code passed is incorrect or expired.', 'https://example.invalid/help'),
            'External service returned an error: {0}. {1} {2}',
            'bad_verification_code',
            'The code passed is incorrect or expired.',
            'https://example.invalid/help',
        );
        const oauthResult = resolveErrorMessage(describeHydroError(oauthError), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(oauthResult.params, ['bad_verification_code', 'The code passed is incorrect or expired.', 'https://example.invalid/help']);
        assert.equal(
            oauthResult.message,
            '外部服务返回错误：bad_verification_code。The code passed is incorrect or expired. https://example.invalid/help',
        );

        const plainDetail = new PermissionError(localizedErrorText`请求域与当前会话域不一致`);
        const plainDetailResult = resolveErrorMessage(describeHydroError(plainDetail), {
            locale: 'en',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(plainDetailResult.params, ['请求域与当前会话域不一致']);
        assert.equal(
            plainDetailResult.message,
            "You don't have the required permission (The requested domain does not match the current session domain) in this domain.",
        );

        const joinDenied = new DomainJoinForbiddenError('system', localizedErrorText`The link is either invalid or expired.`);
        const joinDeniedResult = resolveErrorMessage(describeHydroError(joinDenied), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.equal(joinDeniedResult.message, '您不能加入域 system。链接无效或已过期。');

        const hackFailed = new HackFailedError(localizedErrorText`This problem is not hackable.`);
        const hackFailedResult = resolveErrorMessage(describeHydroError(hackFailed), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(hackFailedResult.params, ['This problem is not hackable.']);
        assert.equal(hackFailedResult.message, 'Hack 失败：此题不允许 Hack。');

        const referencedProblem = new ProblemIsReferencedError(localizedErrorText`edit files`);
        const referencedProblemResult = resolveErrorMessage(describeHydroError(referencedProblem), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(referencedProblemResult.params, ['edit files']);
        assert.equal(referencedProblemResult.message, '题目已被引用，不能编辑文件。');

        const invalidToken = new InvalidTokenError(localizedErrorText`Contest Invitation`);
        const invalidTokenResult = resolveErrorMessage(describeHydroError(invalidToken), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(invalidTokenResult.params, ['Contest Invitation']);
        assert.equal(invalidTokenResult.message, '比赛邀请 令牌无效。');

        const notAssigned = new NotAssignedError(localizedErrorText`contest`, 'C1000');
        const notAssignedResult = resolveErrorMessage(describeHydroError(notAssigned), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(notAssignedResult.params, ['contest', 'C1000']);
        assert.equal(notAssignedResult.message, '您未被分配到此比赛。');

        const metadataConflict = new ManagedProblemMetadataConflictError(localizedErrorText`所属导图已删除`);
        const metadataConflictResult = resolveErrorMessage(describeHydroError(metadataConflict), {
            locale: 'en',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.equal(
            metadataConflictResult.message,
            'Managed problem metadata changed (The knowledge map has been deleted). Reselect the affected item and try again.',
        );
    });

    it('captures explicit first-party template metadata while preserving rendered raw params', () => {
        const validation = new ValidationError('score', null, localizedErrorText`分数不能超过 ${100}`);
        assert.equal(String(localizedErrorText`分数不能超过 ${100}`), '分数不能超过 100');
        const validationResult = resolveErrorMessage(describeHydroError(validation), {
            locale: 'en',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(validationResult.params, ['score', null, '分数不能超过 100']);
        assert.equal(validationResult.message, 'Field score validation failed. (The score cannot exceed 100.)');

        const badRequest = new BadRequestError(localizedErrorText`Invalid API operation: ${'publish'}`);
        const badRequestResult = resolveErrorMessage(describeHydroError(badRequest), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(badRequestResult.params, ['Invalid API operation: publish']);
        assert.equal(badRequestResult.message, 'API 操作无效：publish');

        const missingContest = new NotFoundError(localizedErrorText`Contest`, 'C1000');
        const missingContestResult = resolveErrorMessage(describeHydroError(missingContest), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.deepEqual(missingContestResult.params, ['Contest', 'C1000']);
        assert.equal(missingContestResult.message, '比赛 C1000 不存在。');
    });

    it('preserves native structured-config errors while localizing their display detail', () => {
        let nativeError: unknown;
        try {
            validateStructuredCodeTemplate(
                {
                    lang: 'cpp',
                    source: '',
                    sourceHash: 'forged',
                    publicRanges: [],
                    regions: [],
                },
                'function',
                { allowEmpty: true },
            );
        } catch (error) {
            nativeError = error;
        }
        assert(nativeError instanceof Error);
        assert.equal(nativeError.constructor, Error);
        assert.equal(nativeError.name, 'Error');
        assert.equal(nativeError.message, 'function: template source hash mismatch');

        const detail = getProblemConfigErrorText(nativeError);
        assert(detail);
        const validation = new ValidationError('config', null, detail);
        assert.equal(validation.code, 403);
        assert.deepEqual(validation.params, ['config', null, nativeError.message]);
        assert.equal(
            resolveErrorMessage(describeHydroError(validation), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            '字段 config 验证失败。（function：模板源码摘要不匹配）',
        );
        assert.equal(
            resolveErrorMessage(describeHydroError(validation), {
                locale: 'en',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            'Field config validation failed. (function: template source hash mismatch)',
        );
    });

    it('never translates technical identifiers by accidental catalog-key collision', () => {
        const cases: Array<{ error: HydroError; message: string }> = [
            { error: new UserNotFoundError('Problem'), message: '用户 Problem 不存在。' },
            { error: new ProblemNotFoundError('system', 'Problem'), message: '题目 Problem 不存在。' },
            { error: new RecordNotFoundError('Record'), message: '记录 Record 不存在。' },
        ];
        for (const item of cases) {
            const result = resolveErrorMessage(describeHydroError(item.error), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            });
            assert.equal(result.message, item.message);
        }
    });

    it('preserves the existing error classes and statuses while localizing legacy failures', () => {
        const permission = localizeError(new PermissionError(), 'You cannot delete a message sent by another user.');
        assert.equal(permission.code, 403);
        assert.deepEqual(permission.params, []);
        assert.equal(
            resolveErrorMessage(describeHydroError(permission), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            '不能删除其他用户发送的消息。',
        );

        const announcementSource = readFileSync(resolve(workspaceRoot, 'packages/krypton-announcement/src/handler.ts'), 'utf8');
        assert.match(announcementSource, /if \(!aid\) throw new Error\('aid required'\);/);
        assert.match(announcementSource, /if \(!key \|\| !name \|\| !color\) throw new Error\('key\/name\/color required'\);/);

        const taskSource = readFileSync(resolve(workspaceRoot, 'packages/krypton-tasks/src/model.ts'), 'utf8');
        for (const message of [
            '该任务认领数已满',
            '该任务由管理员分配，无法取消',
            '已完成的任务无法取消',
            '该任务非配额模式，无需 admit',
            '该任务非配额模式，无需 confirm',
        ]) {
            assert.match(taskSource, new RegExp(`throw new Error\\('${message}'\\)`));
        }
    });

    it('renders concrete not-found errors after their full parameter contracts are supplied', () => {
        const missingDocument = new DocumentNotFoundError('system', 20, 'D1000');
        const result = resolveErrorMessage(describeHydroError(missingDocument), {
            locale: 'zh-CN',
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'catalog-test-trace',
        });
        assert.equal(result.message, '文档 D1000 不存在。');

        const missingContest = new ContestNotFoundError('system', 'C1000');
        assert.equal(
            resolveErrorMessage(describeHydroError(missingContest), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            '比赛 C1000 不存在。',
        );

        const legacyRecordContest = localizeError(new ContestNotFoundError('system', undefined), 'Contest {0} not found.', 'C1000');
        assert.deepEqual(legacyRecordContest.params, ['system', undefined]);
        assert.equal(
            resolveErrorMessage(describeHydroError(legacyRecordContest), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            '比赛 C1000 不存在。',
        );

        const legacyRecordParams = localizeError(new RecordNotFoundError('system', 'R1000'), 'Record {0} not found.', 'R1000');
        assert.deepEqual(legacyRecordParams.params, ['system', 'R1000']);
        assert.equal(
            resolveErrorMessage(describeHydroError(legacyRecordParams), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            '记录 R1000 不存在。',
        );

        const legacyDocumentParams = localizeError(new DocumentNotFoundError('system', 'D1000'), 'Document {0} not found.', 'D1000');
        assert.deepEqual(legacyDocumentParams.params, ['system', 'D1000']);
        assert.equal(
            resolveErrorMessage(describeHydroError(legacyDocumentParams), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            '文档 D1000 不存在。',
        );

        const legacyProblemParams = localizeError(new ProblemNotFoundError(), 'Problem {0} not found.', 'P1000');
        assert.deepEqual(legacyProblemParams.params, []);
        assert.equal(
            resolveErrorMessage(describeHydroError(legacyProblemParams), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            '题目 P1000 不存在。',
        );

        const recordHandlerSource = readFileSync(resolve(workspaceRoot, 'packages/hydrooj/src/handler/record.ts'), 'utf8');
        assert.match(
            recordHandlerSource,
            /if \(!tdoc\) throw localizeError\(new ContestNotFoundError\(domainId, pid\), 'Contest \{0\} not found\.', tid\);/,
        );
        const problemHandlerSource = readFileSync(resolve(workspaceRoot, 'packages/hydrooj/src/handler/problem.ts'), 'utf8');
        assert.match(problemHandlerSource, /throw localizeError\(new RecordNotFoundError\(domainId, rid\), 'Record \{0\} not found\.', rid\);/);
        assert.match(problemHandlerSource, /throw localizeError\(new ProblemNotFoundError\(\), 'Problem \{0\} not found\.', reference\.pid\);/);
        const discussionHandlerSource = readFileSync(resolve(workspaceRoot, 'packages/hydrooj/src/handler/discussion.ts'), 'utf8');
        assert.match(
            discussionHandlerSource,
            /throw localizeError\(new DocumentNotFoundError\(domainId, drid\), 'Document \{0\} not found\.', drid\);/,
        );
        const discussionModelSource = readFileSync(resolve(workspaceRoot, 'packages/hydrooj/src/model/discussion.ts'), 'utf8');
        assert.match(
            discussionModelSource,
            /throw localizeError\(new DocumentNotFoundError\(domainId, drid\), 'Document \{0\} not found\.', drid\);/,
        );
    });

    it('preserves existing input-error status and structured-submission logging paths', () => {
        const accountHandlerSource = readFileSync(resolve(workspaceRoot, 'packages/hydrooj/src/handler/admin-account.ts'), 'utf8');
        assert.match(
            accountHandlerSource,
            /if \(error\.message === 'UID 列表包含无效值'\) throw new BadRequestError\(localizedErrorText`UID 列表包含无效值`\);/,
        );
        assert.match(
            accountHandlerSource,
            /if \(error\.message === `单次最多操作 \$\{ACCOUNT_BULK_LIMIT\} 个账号`\) \{\s*throw new BadRequestError\(localizedErrorText`单次最多操作 \$\{ACCOUNT_BULK_LIMIT\} 个账号`\);/s,
        );

        const invalidUidList = new BadRequestError(localizedErrorText`UID 列表包含无效值`);
        assert.equal(invalidUidList.code, 400);
        assert.deepEqual(invalidUidList.params, ['UID 列表包含无效值']);
        assert.equal(
            resolveErrorMessage(describeHydroError(invalidUidList), {
                locale: 'en',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            }).message,
            'The UID list contains an invalid value.',
        );

        const paperSource = readFileSync(resolve(workspaceRoot, 'packages/hydrooj/src/handler/paper.ts'), 'utf8');
        const tryStart = paperSource.indexOf('try {', paperSource.indexOf('function validatePaperRegionSubmission('));
        const missingPayload = paperSource.indexOf('throw new Error(`${kind}: region payload is required`)', tryStart);
        const catchStart = paperSource.indexOf('} catch (error: any) {', tryStart);
        assert.ok(tryStart >= 0 && missingPayload > tryStart && catchStart > missingPayload);
        assert.match(
            paperSource.slice(catchStart, paperSource.indexOf('return { code:', catchStart)),
            /logger\.error\([\s\S]*localizedErrorText`\$\{kind\}: region payload is required`/,
        );
    });

    it('runs the static catalog gate from the root CI test command', () => {
        const pkg = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'));
        assert.match(pkg.scripts.test, /--test packages\/hydrooj\/test\/error-message-catalog\.spec\.ts/);
    });

    it('snapshots representative Chinese messages across product modules', () => {
        const cases: Array<{ error: HydroError; message: string }> = [
            { error: new AccessDeniedError(), message: '访问被拒绝。' },
            { error: new ValidationError('title'), message: '字段 title 验证失败。' },
            { error: new ProblemNotFoundError('system', 'P1000'), message: '题目 P1000 不存在。' },
            { error: new RecordNotFoundError('R1000'), message: '记录 R1000 不存在。' },
            {
                error: new ProblemStructureConflictError('P1000'),
                message: '题目 P1000 已变化或结构已锁定，请刷新后重试。',
            },
            {
                error: new OpcountExceededError('login', 60, 5),
                message: 'login 操作过于频繁（限制：60 秒内最多 5 次）。',
            },
            { error: new ContestNotLiveError(), message: '比赛尚未开始。' },
            {
                error: new AccountStateConflictError('disabled'),
                message: '账号状态已变化（disabled），请刷新账号管理页面后重试。',
            },
        ];
        for (const item of cases) {
            const result = resolveErrorMessage(describeHydroError(item.error), {
                locale: 'zh-CN',
                lookup: lookupErrorMessageTranslation,
                createTraceId: () => 'catalog-test-trace',
            });
            assert.equal(result.message, item.message, item.error.name);
        }
    });
});
