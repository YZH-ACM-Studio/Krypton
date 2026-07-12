import path from 'node:path';
import globals from 'globals';
import react from '@hydrooj/eslint-config';

const config = react(
    {
        ignores: [
            '**/{public,files}/**/*.js',
            '**/dist',
            '**/*.d.ts',
            '**/node_modules',
            '**/.*.js',
            '.playwright-cli',
            'dev',
            'docs',
            'ecosystems',
            'packages/ui-default/public',
            'packages/ui-default/static',
            'packages/hydrojudge/vendor',
            'install/helm-single/templates',
        ],
        stylistic: {
            indent: 4,
        },
        jsonc: false,
        rules: {
            'yaml/indent': ['warn', 2],

            // There are too many `global` and `Function` in codebase already
            'no-restricted-globals': 'off',
            'no-await-in-loop': 'off',
            'ts/no-unsafe-function-type': 'off',
            'ts/no-use-before-define': 'off',
            'ts/naming-convention': 'off',
            'github/array-foreach': 'off',
            'max-len': 'off',
            'style/member-delimiter-style': [
                'error',
                {
                    multiline: {
                        delimiter: 'semi',
                        requireLast: true,
                    },
                    multilineDetection: 'brackets',
                    singleline: {
                        delimiter: 'semi',
                        requireLast: false,
                    },
                },
            ],
        },
    },
    {
        languageOptions: {
            ecmaVersion: 5,
            sourceType: 'module',
        },

        settings: {
            'import/parsers': {
                '@typescript-eslint/parser': ['.ts', '.js', '.jsx', '.tsx'],
            },

            'import/resolver': {
                webpack: {
                    config: {
                        resolve: {
                            extensions: ['.js', '.jsx', '.ts', '.tsx', '.vue'],
                        },
                    },
                },
            },
        },

        rules: {
            '@typescript-eslint/no-invalid-this': 1,

            'simple-import-sort/imports': [
                'warn',
                {
                    groups: [
                        ['^\\u0000'],
                        [
                            '^(node:)?(assert|buffer|child_process|cluster|console|constants|crypto|dgram|dns|domain|events|fs|http|https|module|net|os|path|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|tty|url|util|vm|zlib|freelist|v8|process|async_hooks|http2|perf_hooks)(/.*|$)',
                            '^(?!@?hydrooj)(@?\\w.+)',
                            '^@?hydrooj',
                            '^',
                            '^\\.',
                        ],
                    ],
                },
            ],
        },
    },
    {
        files: ['**/{public,frontend}/**/*.{ts,tsx,page.js}', '**/plugins/**/*.page.{ts,js,tsx,jsx}', 'packages/ui-default/**/*.{ts,tsx,js,jsx}'],

        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.jquery,
                ...globals.commonjs,
                UiContext: true,
                UserContext: true,
                externalModules: true,
                LOCALES: true,
                LANGS: true,
                __webpack_public_path__: true,
                __webpack_require__: true,
            },
            parserOptions: {
                sourceType: 'module',
                ecmaVersion: 2020,
                ecmaFeatures: {
                    impliedStrict: true,
                    experimentalObjectRestSpread: true,
                    jsx: true,
                    defaultParams: true,
                    legacyDecorators: true,
                    allowImportExportEverywhere: true,
                },
            },
        },

        settings: {
            'react-x': {
                version: '18.3.1',
            },
            'import/resolver': {
                webpack: {
                    config: {
                        resolve: {
                            extensions: ['.js', '.jsx', '.ts', '.tsx'],
                            alias: {
                                vj: path.resolve('./packages/ui-default'),
                            },
                        },
                    },
                },
            },
        },

        rules: {
            'github/array-foreach': 0,
            'ts/no-invalid-this': 0,

            // FIXME A bug with eslint-parser
            // 'template-curly-spacing': 'off',

            'e18e/prefer-array-at': 'off',

            'style/indent': [
                'warn',
                2,
                {
                    ArrayExpression: 1,
                    CallExpression: {
                        arguments: 1,
                    },
                    flatTernaryExpressions: false,
                    FunctionDeclaration: {
                        body: 1,
                        parameters: 1,
                    },
                    FunctionExpression: {
                        body: 1,
                        parameters: 1,
                    },
                    ignoreComments: false,
                    ignoredNodes: [
                        'TSUnionType',
                        'TSIntersectionType',
                        'TSTypeParameterInstantiation',
                        'FunctionExpression > .params[decorators.length > 0]',
                        'FunctionExpression > .params > :matches(Decorator, :not(:first-child))',
                        'JSXElement',
                        'JSXElement > *',
                        'JSXAttribute',
                        'JSXIdentifier',
                        'JSXNamespacedName',
                        'JSXMemberExpression',
                        'JSXSpreadAttribute',
                        'JSXExpressionContainer',
                        'JSXOpeningElement',
                        'JSXClosingElement',
                        'JSXFragment',
                        'JSXOpeningFragment',
                        'JSXClosingFragment',
                        'JSXText',
                        'JSXEmptyExpression',
                        'JSXSpreadChild',
                    ],
                    ImportDeclaration: 1,
                    ObjectExpression: 1,
                    outerIIFEBody: 1,
                    SwitchCase: 1,
                    VariableDeclarator: 1,
                },
            ],
            'style/jsx-indent-props': 'off',
            'style/indent-binary-ops': 'off',
            'function-paren-newline': 'off',
            'no-mixed-operators': 'off',
            'no-await-in-loop': 'off',
            'no-lonely-if': 'off',
            'no-script-url': 'off',

            'simple-import-sort/imports': [
                'warn',
                {
                    groups: [
                        ['^\\u0000'],
                        [
                            '^(node:)?(assert|buffer|child_process|cluster|console|constants|crypto|dgram|dns|domain|events|fs|http|https|module|net|os|path|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|tty|url|util|vm|zlib|freelist|v8|process|async_hooks|http2|perf_hooks)(/.*|$)',
                            '^@?hydrooj',
                            '^',
                            '^(@|vj)\\/',
                            '^\\.',
                        ],
                    ],
                },
            ],
        },
    },
    {
        files: ['packages/ui-next/**/*.{ts,tsx,js,jsx}'],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            'style/indent': ['warn', 2],
            'style/indent-binary-ops': ['warn', 2],
            'no-alert': 'off',
            'react-refresh/only-export-components': 'off',
        },
    },
    {
        files: ['**/*.yaml', '**/*.yml'],
        rules: {
            // Prettier owns YAML layout; ESLint remains responsible for semantic rules.
            'yaml/indent': 'off',
            'yaml/plain-scalar': 'off',
            'style/no-trailing-spaces': 'off',
            'max-len': 'off',
        },
    },
    {
        files: ['**/*.{ts,tsx,js,jsx,cjs,cts,mjs,mts,vue}'],
        rules: {
            'consistent-return': 'off',
            'eslint-comments/no-unused-disable': 'off',
            'github/array-foreach': 'off',
            'logical-assignment-operators': 'off',
            'max-len': 'off',
            'no-await-in-loop': 'off',
            'no-unmodified-loop-condition': 'off',
            'react-refresh/only-export-components': 'off',
            // Import declarations can execute module initialization in source order.
            // Keep the authored order instead of applying a behavior-changing autofix.
            'simple-import-sort/imports': 'off',
            // Prettier is the single source of truth for source-code layout.
            'style/indent': 'off',
            'style/indent-binary-ops': 'off',
            'style/jsx-curly-newline': 'off',
            'style/member-delimiter-style': [
                'error',
                {
                    multiline: {
                        delimiter: 'semi',
                        requireLast: true,
                    },
                    multilineDetection: 'brackets',
                    singleline: {
                        delimiter: 'semi',
                        requireLast: false,
                    },
                },
            ],
            'style/operator-linebreak': 'off',
            'ts/naming-convention': 'off',
            // Preserve existing runtime module evaluation for inline type imports.
            'ts/no-import-type-side-effects': 'off',
            'ts/no-unused-vars': [
                'error',
                {
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_|e',
                    ignoreRestSiblings: true,
                    vars: 'all',
                    varsIgnorePattern: '^_',
                },
            ],
            'ts/no-use-before-define': 'off',
            'unicorn/number-literal-case': 'off',
        },
    },
    {
        files: ['packages/ui-default/**/*.{ts,tsx,js,jsx}'],
        rules: {
            'ts/no-loop-func': 'off',
        },
    },
);
export default config;
