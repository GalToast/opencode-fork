import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"

const globalIgnores = [
  "**/node_modules/**",
  "**/dist/**",
  "**/ts-dist/**",
  "**/.opencode/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.tracker/**",
  "**/out/**",
  "**/tmp/**",
  "**/*.d.ts",
  "docs/**",
  "outreach/**",
  "test-output*.txt",
  "test_run*.log",
  "test-failures.txt",
  "*.log",
]

export default tseslint.config(
  {
    ignores: globalIgnores,
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-constant-binary-expression": "error",
      "no-unreachable": "error",
      "no-self-assign": "error",
      "no-unsafe-optional-chaining": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-undef": "off",
      "no-use-before-define": "off",
      "no-redeclare": "off",
      "no-shadow": "off",
      "no-constant-binary-expression": "error",
      "no-unreachable": "error",
      "no-self-assign": "error",
      "no-unsafe-optional-chaining": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "@typescript-eslint/no-use-before-define": [
        "error",
        {
          functions: false,
          classes: true,
          variables: true,
          typedefs: true,
          ignoreTypeReferences: true,
        },
      ],
      "@typescript-eslint/no-redeclare": "error",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          disallowTypeAnnotations: false,
        },
      ],
    },
  },
)
