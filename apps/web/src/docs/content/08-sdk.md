---
slug: sdk
title: SDK and client examples
nav: SDK
status: Preview
---

# SDK and client examples

**Status: Preview.** `@dismodo/sdk` is a TypeScript package in the DISMODO repository (`packages/sdk`). It is not published to npm yet; use it from the repository or copy it into your project.

It has no dependencies and uses the platform `fetch`.

## Product client

```ts
import { createClient } from '@dismodo/sdk';

const dismodo = createClient({ baseUrl: 'http://localhost:4100', apiKey: process.env.DISMODO_API_KEY });

const found = await dismodo.experiences.search('quarter');
const { session } = await dismodo.sessions.start({
  experience: 'parts-of-a-whole',
  learnerRef: 'learner-001',
  declared: { familiar_contexts: ['materials'] },
});
// Send session.url to the learner, then later:
const report = await dismodo.sessions.evidence(session.session_id);
```

## Learner link client

For building your own learner interface instead of using the hosted page:

```ts
import { createRuntimeClient, tokenFromSessionUrl } from '@dismodo/sdk';

const runtime = createRuntimeClient({
  baseUrl: 'http://localhost:4100',
  sessionToken: tokenFromSessionUrl(url)!,
});
const { view } = await runtime.view();
if (view.step.kind === 'item') {
  await runtime.submit({ type: 'hint_request', item_id: view.step.item.item_id });
}
```

Errors are thrown as `DismodoApiError` with `status`, `code` and `details`.

## Embedding the learner page

**Status: Preview.** Add the session to any page with one script and one element. Its styles live in a shadow root, so your page's CSS and DISMODO's never mix.

```html
<script type="module" src="https://your-dismodo-host/embed/dismodo-session.js"></script>
<dismodo-session token="TOKEN_FROM_THE_LEARNER_LINK" api="https://your-dismodo-host"></dismodo-session>
```

The token is the part of `session.url` after `#` (`tokenFromSessionUrl` extracts it). The element emits a `dismodo:change` event after each step. Only learner-link routes accept cross-origin calls; keep your API key on your server.

## CLI

**Status: Preview**, in the repository at `packages/cli`:

```bash
pnpm dismodo validate experience.json
pnpm dismodo import experience.json        # needs DISMODO_API_KEY
pnpm dismodo publish my-experience@1.0.0 --reviewer "Name"
```

## A second builder, end to end

`examples/acme-onboarding` is a second product on the same engine: a workplace-training portal with its own look and key. It publishes a package written by an independent builder — `halves-vs-quarters@1.0.0`, which changes the objective and condition of the activity without any engine change — starts sessions through the SDK, embeds `<dismodo-session>` and shows managers the evidence. Its README explains how to run it.
