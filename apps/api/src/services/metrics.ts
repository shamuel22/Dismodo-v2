import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

/**
 * Tenant-scoped measurements: how decision models behave, and how the adaptive and fixed routes compare.
 * Descriptive only: small samples and non-random assignment do not support causal claims.
 */
export async function decisionMetrics(db: Database, tenantId: string) {
  const models = await db.execute(sql`
    select provider, model, tier,
      count(*)::int as calls,
      count(*) filter (where status = 'ok')::int as ok,
      percentile_cont(0.5) within group (order by latency_ms)::int as p50_latency_ms,
      percentile_cont(0.95) within group (order by latency_ms)::int as p95_latency_ms,
      coalesce(sum(input_tokens), 0)::int as input_tokens,
      coalesce(sum(output_tokens), 0)::int as output_tokens
    from model_calls where tenant_id = ${tenantId}
    group by provider, model, tier order by tier, provider, model`);
  const failures = await db.execute(sql`
    select provider, model, tier, status, count(*)::int as n
    from model_calls where tenant_id = ${tenantId} and status <> 'ok'
    group by provider, model, tier, status`);
  const decisions = await db.execute(sql`
    select payload->'decision'->>'source' as source, type, count(*)::int as n
    from session_events e join sessions s on s.id = e.session_id
    where s.tenant_id = ${tenantId} and e.type in ('intervention_started', 'decision_recorded')
    group by 1, 2 order by 1, 2`);
  const routes = await db.execute(sql`
    select s.policy,
      count(distinct s.id)::int as sessions,
      count(distinct s.id) filter (where s.status = 'completed')::int as completed,
      count(o.*) filter (where o.phase = 'independent' and o.correct is not null)::int as independent_attempted,
      count(o.*) filter (where o.phase = 'independent' and o.correct)::int as independent_correct,
      count(o.*) filter (where o.phase = 'practice' and o.correct is not null)::int as practice_attempted,
      count(o.*) filter (where o.phase = 'practice' and o.correct)::int as practice_correct,
      coalesce(sum(o.hints_used) filter (where o.phase = 'practice'), 0)::int as practice_hints
    from sessions s left join observations o on o.session_id = s.id
    where s.tenant_id = ${tenantId}
    group by s.policy order by s.policy`);

  return {
    models: models.rows.map((row) => ({
      ...row,
      failures: Object.fromEntries(
        failures.rows
          .filter((f) => f.provider === row.provider && f.model === row.model && f.tier === row.tier)
          .map((f) => [f.status, f.n]),
      ),
    })),
    decisions: decisions.rows,
    routes: routes.rows,
    note: 'Counts for this tenant. Sessions are not randomly assigned to routes; treat differences as signals, not effects.',
  };
}
