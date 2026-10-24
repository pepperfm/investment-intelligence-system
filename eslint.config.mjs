import withNuxt from './.nuxt/eslint.config.mjs'

// Explicit braces and multiline formatting for objects and Vue templates.
export default withNuxt(
  { ignores: ['.data/**', '.output/**', '.agents/**', '.codex/**', '.claude/**'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    rules: {
      'curly': ['error', 'all'],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
      '@stylistic/object-curly-newline': ['error', {
        ObjectExpression: {
          minProperties: 3,
          multiline: true,
          consistent: true,
        },
        ObjectPattern: {
          multiline: true,
          consistent: true,
        },
        TSTypeLiteral: {
          minProperties: 3,
          multiline: true,
          consistent: true,
        },
        TSInterfaceBody: {
          minProperties: 3,
          multiline: true,
          consistent: true,
        },
      }],
      '@stylistic/object-property-newline': 'error',
    },
  },
  {
    files: ['**/*.vue'],
    rules: {
      'vue/max-attributes-per-line': ['error', {
        singleline: { max: 2 },
        multiline: { max: 1 },
      }],
      'vue/first-attribute-linebreak': ['error', {
        singleline: 'ignore',
        multiline: 'below',
      }],
    },
  },
)
