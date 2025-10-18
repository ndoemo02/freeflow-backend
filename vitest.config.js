import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
    include: [
      'tests/**/*.test.js',
      'tests/**/*.spec.js'
    ],
    exclude: [
      'node_modules',
      'dist',
      '.git'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'api/**/*.js'
      ],
      exclude: [
        'api/**/*.test.js',
        'api/**/*.spec.js',
        'node_modules'
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@api': path.resolve(__dirname, './api'),
      '@tests': path.resolve(__dirname, './tests')
    }
  }
});

