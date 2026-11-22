module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testTimeout: 120000,
  collectCoverageFrom: ['lib/**/*.ts'],
  coverageThreshold: { global: { lines: 70, statements: 70, functions: 70, branches: 50 } },
};
