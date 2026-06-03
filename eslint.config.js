// Minimal flat ESLint config (ESLint 9+).
const nodeGlobals = {
  require: 'readonly',
  module: 'readonly',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
};

module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
    },
  },
  {
    // Jest provides these as globals in test files.
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...nodeGlobals,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
];
