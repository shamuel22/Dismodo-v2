/**
 * Plays one adaptive session against the configured decision models (real API calls) and prints every
 * decision: who decided, which model and tier, latency, the reviewed hypothesis the learner sees and the model reading kept in traces. Usage:
 *   pnpm --filter @dismodo/api decisions:live            # real models
 *   DECISION_FAULT=timeout pnpm ... decisions:live       # show the fallback path
 */
import { randomUUID } from 'node:crypto';
import { createModelPolicy, decisionTiersFromEnv } from '@dismodo/adaptation';
import { editorialPolicy } from '@dismodo/engine';
import { createDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { loadEnv } from '../src/env';
import { buildServer } from '../src/server';
import { createApiKey, ensureTenant } from '../src/services/tenants';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await runMigrations(database.db);
const tiers = decisionTiersFromEnv(process.env);
console.log('Decision models:', tiers.summary);
const app = buildServer({
  db: database.db,
  logLevel: 'warn',
  policies: { adaptive: createModelPolicy(tiers), fixed: editorialPolicy },
  decisionModels: tiers.summary,
});
const tenant = await ensureTenant(database.db, 'live-smoke', 'Live smoke');
const { key } = await createApiKey(database.db, tenant.id, `smoke-${Date.now()}`);
const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${key}` },
    ...(payload ? { payload: payload as object } : {}),
  });

const created = (
  await call('POST', '/v1/sessions', {
    experience: 'parts-of-a-whole',
    learner_ref: `smoke-${randomUUID().slice(0, 6)}`,
  })
).json();
const id = created.session.session_id;
let view = created.view;
// Script: baseline right; practice: "took the rest" twice (escalates), then disagree, then right answers.
const plan = ['right', 'rest', 'rest', 'right', 'right', 'right', 'right', 'right'];
let disagreed = false;
while (view.status === 'active') {
  let action: Record<string, unknown> = { type: 'continue' };
  if (view.step.kind === 'item') {
    const total = view.step.item.view.total;
    const kind = view.step.item.phase === 'independent' ? 'right' : (plan.shift() ?? 'right');
    const count = kind === 'rest' ? total - total / 4 : total / 4;
    action = {
      type: 'answer',
      item_id: view.step.item.item_id,
      response: { selected: Array.from({ length: count }, (_, i) => `e${i + 1}`) },
    };
    console.log(`\n[${view.step.item.phase}] ${view.step.item.prompt}  → marks ${count}`);
  } else if (view.step.kind === 'explanation') {
    const e = view.step.explanation;
    console.log(`  ↳ ${e.intervention}: ${e.title}`);
    if (view.step.hypothesis) console.log(`    learner sees (reviewed): ${view.step.hypothesis}`);
    if (view.step.can_give_feedback && !disagreed) {
      disagreed = true;
      action = {
        type: 'hypothesis_feedback',
        agrees: false,
        note: 'I knew it was a quarter, I just marked the wrong group.',
      };
      console.log('  ✋ learner disagrees: "I knew it was a quarter, I just marked the wrong group."');
    }
  } else if (view.step.kind === 'feedback') {
    console.log(`  = ${view.step.result.correct ? 'correct' : 'not correct'}: ${view.step.result.feedback}`);
  }
  const res = await call('POST', `/v1/sessions/${id}/events`, { action });
  if (res.statusCode !== 200) throw new Error(res.body);
  view = res.json().view;
}

const events = (await call('GET', `/v1/sessions/${id}/events`)).json().events;
console.log('\nDecisions:');
for (const e of events) {
  if (e.actor !== 'engine' || !['intervention_started', 'decision_recorded'].includes(e.event.type)) continue;
  const d = e.event.decision;
  const attempts = (d.attempts ?? []).map(
    (a: { tier: string; model: string; status: string; latency_ms: number }) =>
      `${a.tier}/${a.model} ${a.status} ${a.latency_ms}ms`,
  );
  console.log(
    `  #${e.seq} ${e.event.intervention ?? 'continue'} · source=${d.source}${d.escalation_reason ? ` · escalated: ${d.escalation_reason}` : ''}`,
  );
  if (attempts.length) console.log(`     attempts: ${attempts.join(' → ')}`);
  if (d.model_interpretation) console.log(`     model reading (trace only): ${d.model_interpretation}`);
  if (d.fallback_reason) console.log(`     fallback: ${d.fallback_reason}`);
}
const report = (await call('GET', `/v1/sessions/${id}/evidence`)).json();
console.log('\nReport observed:', report.statements.observed);
console.log('Metrics:', JSON.stringify((await call('GET', '/v1/metrics/decisions')).json().models));
await app.close();
await database.close();
