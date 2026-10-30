import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DismodoApiError, type DismodoClient } from '@dismodo/sdk';
import { randomBytes } from 'node:crypto';

export const SERVER_INFO = { name: 'dismodo', version: '0.1.0' } as const;

const INSTRUCTIONS = `DISMODO runs adaptive practice sessions for a person (the learner). Typical use:
1. search_experiences to find what can be practised.
2. start_session to get a learner link; give the link to the person. They work through it in a browser.
3. get_evidence later to read what happened. Results come from a deterministic evaluator, never from you or
   from a model; report them with their scope ("this skill and session") and what was not checked.
You cannot answer for the learner, grade, import or publish experiences through these tools.`;

function errorText(error: unknown): string {
  if (error instanceof DismodoApiError)
    return `DISMODO error ${error.status} ${error.code}: ${error.message}`;
  return `DISMODO request failed: ${(error as Error).message}`;
}

/** Consumer tools over the DISMODO API. Builder operations (import, publish) are deliberately absent. */
export function createDismodoMcpServer(client: DismodoClient): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool(
    'search_experiences',
    {
      title: 'Search experiences',
      description:
        'Find published practice experiences available to this product. Returns ids, objectives, familiar ' +
        'contexts (references the learner may know) and the time budget.',
      inputSchema: {
        query: z.string().max(100).optional().describe('Words to match in title, objective or skill.'),
      },
      outputSchema: {
        experiences: z.array(
          z.object({
            experience_ref: z.string(),
            title: z.string(),
            objective: z.string(),
            skill: z.string(),
            contexts: z.array(z.object({ id: z.string(), label: z.string() })),
            time_budget_minutes: z.number(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      try {
        const { experiences } = await client.experiences.search(query);
        const items = experiences.map((e) => ({
          experience_ref: e.experience_ref,
          title: e.title,
          objective: e.objective,
          skill: e.skill.name,
          contexts: e.contexts,
          time_budget_minutes: e.time_budget_minutes,
        }));
        const text = items.length
          ? items
              .map(
                (e) =>
                  `- ${e.experience_ref}: ${e.title}. ${e.objective} (~${e.time_budget_minutes} min; contexts: ${e.contexts.map((c) => c.id).join(', ')})`,
              )
              .join('\n')
          : 'No published experiences match.';
        return { content: [{ type: 'text', text }], structuredContent: { experiences: items } };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: errorText(error) }] };
      }
    },
  );

  server.registerTool(
    'start_session',
    {
      title: 'Start a practice session',
      description:
        'Start an adaptive session for a learner and get the link they open in a browser. Use a pseudonymous ' +
        'learner_ref (never a name or email) so later sessions of the same person can build on earlier ones.',
      inputSchema: {
        experience: z
          .string()
          .min(3)
          .max(100)
          .describe('"experience-id" for the latest version, or "experience-id@1.0.0".'),
        learner_ref: z
          .string()
          .regex(/^[A-Za-z0-9_.:@-]{1,128}$/)
          .optional()
          .describe('Pseudonymous learner id. A random one is created when omitted.'),
        familiar_contexts: z
          .array(z.string().max(64))
          .max(10)
          .optional()
          .describe('Context ids the learner says they know (from search_experiences).'),
        policy: z
          .enum(['adaptive', 'fixed'])
          .optional()
          .describe('"adaptive" (default) or "fixed" for the reviewed route only, as a comparison.'),
      },
      outputSchema: {
        session_id: z.string(),
        learner_url: z.string(),
        learner_ref: z.string(),
        experience_ref: z.string(),
        expires_at: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ experience, learner_ref, familiar_contexts, policy }) => {
      const learnerRef = learner_ref ?? `agent-${randomBytes(6).toString('hex')}`;
      try {
        const { session } = await client.sessions.start({
          experience,
          learnerRef,
          ...(familiar_contexts?.length ? { declared: { familiar_contexts } } : {}),
          ...(policy ? { policy } : {}),
        });
        const out = {
          session_id: session.session_id,
          learner_url: session.url,
          learner_ref: learnerRef,
          experience_ref: session.experience_ref,
          expires_at: session.expires_at,
        };
        return {
          content: [
            {
              type: 'text',
              text:
                `Session ${out.session_id} started for ${out.experience_ref} (learner ${learnerRef}).\n` +
                `Give this link to the learner (it expires ${out.expires_at}): ${out.learner_url}\n` +
                'Call get_evidence with the session_id after they finish.',
            },
          ],
          structuredContent: out,
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: errorText(error) }] };
      }
    },
  );

  server.registerTool(
    'get_evidence',
    {
      title: 'Get session evidence',
      description:
        "Read a session's evidence: status, results computed from graded events (practice with and without " +
        'hints, new problems without hints), the support given and who decided it, and what has not been checked.',
      inputSchema: { session_id: z.string().uuid() },
      outputSchema: {
        status: z.string(),
        practice: z.object({ attempted: z.number(), correct: z.number(), hints_used: z.number() }),
        independent: z.object({ attempted: z.number(), correct: z.number(), target: z.number() }),
        interventions: z.array(
          z.object({
            intervention: z.string(),
            source: z.string(),
            next_item_correct: z.boolean().nullable(),
          }),
        ),
        observed: z.array(z.string()),
        learner_view: z.array(z.string()),
        not_yet_checked: z.array(z.string()),
        scope: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ session_id }) => {
      try {
        const report = await client.sessions.evidence(session_id);
        const o = report.observations;
        const out = {
          status: report.status,
          practice: {
            attempted: o.practice.attempted,
            correct: o.practice.correct,
            hints_used: o.practice.hints_used,
          },
          independent: {
            attempted: o.independent.attempted,
            correct: o.independent.correct,
            target: o.independent.target,
          },
          interventions: o.interventions.map((i) => ({
            intervention: i.intervention,
            source: i.source,
            next_item_correct: i.next_item_correct,
          })),
          observed: report.statements.observed,
          learner_view: report.statements.learner_view,
          not_yet_checked: report.statements.not_yet_checked,
          scope: report.scope,
        };
        const lines = [
          `Status: ${out.status} (${report.experience_ref}). Scope: ${out.scope}.`,
          ...(out.observed.length
            ? ['Observed:', ...out.observed.map((s) => `- ${s}`)]
            : ['Nothing observed yet.']),
          ...(out.learner_view.length ? ['The learner said:', ...out.learner_view.map((s) => `- ${s}`)] : []),
          'Not yet checked:',
          ...out.not_yet_checked.map((s) => `- ${s}`),
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: out };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: errorText(error) }] };
      }
    },
  );

  return server;
}
