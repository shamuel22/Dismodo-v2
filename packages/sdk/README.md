# @dismodo/sdk

Typed TypeScript client for the DISMODO API. It uses the global `fetch`, has no runtime dependencies
(types are imported from `@dismodo/contracts`), and covers only routes the API actually exposes.

## Tenant client

Use an API key (`dsm_...`) for building, publishing and running experiences:

```ts
import { createClient, DismodoApiError } from '@dismodo/sdk';

const client = createClient({
  baseUrl: 'http://localhost:4100',
  apiKey: 'dsm_your_api_key_here',
});

// The public catalog needs no key.
const schema = await client.catalog.experienceSchema();
const components = await client.catalog.components();

// Validate, import and publish a package. Publishing fetches the attestation
// statement from the API and sends it verbatim.
const checked = await client.packages.validate(pkg);
if (!checked.valid) console.error(checked.issues);
await client.packages.import(pkg);
await client.packages.publish('parts-of-a-whole', '1.0.0', { reviewer: 'Ana' });
const packages = await client.packages.list();
const one = await client.packages.get('parts-of-a-whole', '1.0.0');

// Find a runnable experience and start a session. Send the learner the
// `session.url` learner link; never send them your API key.
const { experiences } = await client.experiences.search('quarter');
const started = await client.sessions.start({
  experience: experiences[0]!.experience_ref,
  learnerRef: 'learner-123',
  declared: { familiar_contexts: ['materials'] },
});

// Follow the session from your backend.
const current = await client.sessions.get(started.session.session_id);
const result = await client.sessions.submit(
  started.session.session_id,
  { type: 'continue' },
  { clientEventId: 'my-event-001' }, // optional; generated when omitted
);
const evidence = await client.sessions.evidence(started.session.session_id);
const events = await client.sessions.events(started.session.session_id);

// Learner memory and decision metrics.
const history = await client.learners.history('learner-123');
await client.learners.resetHistory('learner-123', { skillKey: 'parts-of-a-whole|set-selection.v1' });
const metrics = await client.metrics.decisions();

try {
  await client.sessions.get('00000000-0000-0000-0000-000000000000');
} catch (error) {
  if (error instanceof DismodoApiError) {
    console.error(error.status, error.code, error.message, error.details);
    // 429 responses have `error.code === 'rate_limited'`: wait, then retry.
  }
  throw error;
}
```

## Runtime client (learner link)

A learner link carries its token after `#`. Extract it and use the runtime
client; it sends `Authorization: Session <token>` and can only reach its own
session:

```ts
import { createRuntimeClient, tokenFromSessionUrl } from '@dismodo/sdk';

const token = tokenFromSessionUrl(window.location.href);
if (!token) throw new Error('This learner link has no session token.');

const runtime = createRuntimeClient({ baseUrl: 'http://localhost:4100', sessionToken: token });
const { view } = await runtime.view();
if (view.step.kind === 'item') {
  await runtime.submit({ type: 'answer', item_id: view.step.item.item_id, response: { selected: ['e1'] } });
}
```

## Notes

- Every non-2xx response throws `DismodoApiError` with `status`, `code`, `message` and optional `details`.
- `submit` generates a `clientEventId` when you omit one, so retries of the same call stay safe.
- Pass a custom `fetch` in the options (`createClient({ baseUrl, apiKey, fetch })`) for tests or non-global-fetch runtimes.
