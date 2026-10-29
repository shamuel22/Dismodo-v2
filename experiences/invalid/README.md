# Invalid example packages

Each file is the `parts-of-a-whole` package with deliberate mistakes, to show what validation reports.
Run `pnpm dismodo validate experiences/invalid/<file>.json` to see the messages.

| File                 | Kind of mistake              | Expected issues                                                                                                                                                                                       |
| -------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bad-structure.json` | Structure                    | `/version` invalid_format · `/title` markup not allowed · `/contexts/0/nouns/constructor` reserved key                                                                                                |
| `bad-semantics.json` | Cross-references and meaning | scenario reveals the answer (`{{part_size}}` not available in prompts) · `contrast` allowed without editorial content · the same held-out problem reserved twice (a new context does not make it new) |
| `bad-tests.json`     | Package tests                | a test expects the wrong error code for the evaluator                                                                                                                                                 |
