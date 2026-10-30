import { parseArgs } from 'node:util';
import {
  draftCommand,
  importCommand,
  publishCommand,
  validateCommand,
  type CommandResult,
  type Output,
} from './commands';

const HELP = `dismodo — builder CLI for DISMODO experience packages

Usage:
  dismodo validate <package.json>                 Check structure, semantics and package tests (offline)
  dismodo import <package.json>                   Import a new immutable draft version
  dismodo publish <id@version> --reviewer <name>  Publish a reviewed draft [--hash sha256:...]
  dismodo draft <notes.md> --id <experience-id>   Draft a package with AI from notes [--out file.json]

Options:
  --api <url>   API base URL (env DISMODO_API_URL, default http://localhost:4100)
  --key <key>   API key (env DISMODO_API_KEY)
  --json        Machine-readable output for scripts and agents
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    api: { type: 'string' },
    key: { type: 'string' },
    reviewer: { type: 'string' },
    hash: { type: 'string' },
    id: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const out: Output = { json: values.json, log: (line) => console.log(line) };
const api = {
  apiUrl: values.api ?? process.env.DISMODO_API_URL ?? 'http://localhost:4100',
  apiKey: values.key ?? process.env.DISMODO_API_KEY,
};
const [command, target] = positionals;

async function run(): Promise<CommandResult> {
  if (values.help || !command) {
    console.log(HELP);
    return { exitCode: command ? 0 : 1, data: null };
  }
  if (!target) throw new Error(`"${command}" needs an argument. See dismodo --help.`);
  switch (command) {
    case 'validate':
      return validateCommand(target, out);
    case 'import':
      return importCommand(target, api, out);
    case 'publish':
      if (!values.reviewer) throw new Error('publish needs --reviewer "<name>".');
      return publishCommand(target, values.reviewer, values.hash, api, out);
    case 'draft':
      if (!values.id) throw new Error('draft needs --id <experience-id>.');
      return draftCommand(target, values.id, values.out ?? `${values.id}.draft.json`, api, out);
    default:
      throw new Error(`Unknown command "${command}". See dismodo --help.`);
  }
}

try {
  const result = await run();
  if (values.json) console.log(JSON.stringify(result.data, null, 2));
  process.exitCode = result.exitCode;
} catch (error) {
  if (values.json) console.log(JSON.stringify({ error: (error as Error).message }));
  else console.error(`✗ ${(error as Error).message}`);
  process.exitCode = 2;
}
