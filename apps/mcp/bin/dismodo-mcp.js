#!/usr/bin/env node
// stdio entry for MCP clients: runs the TypeScript source through tsx.
import { register } from 'tsx/esm/api';
register();
await import('../src/stdio.ts');
