#!/usr/bin/env node
// Development entry: runs the TypeScript source through tsx.
import { register } from 'tsx/esm/api';
register();
await import('../src/main.ts');
