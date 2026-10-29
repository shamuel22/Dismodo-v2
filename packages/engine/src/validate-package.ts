import {
  ExperiencePackage,
  MAX_PACKAGE_DEPTH,
  interventionKind,
  jsonDepth,
  malformedPlaceholders,
  templateVariables,
  toJsonPointer,
  type ActivityAdapter,
  type ComponentRegistry,
  type EvaluatorAdapter,
  type ValidationIssue,
} from '@dismodo/contracts';
import type { z } from 'zod';

export interface PackageValidationSummary {
  /** Distinct problems the activity can generate under the package params. */
  candidate_pool: number;
  /** Candidates left for practice and examples once held-out checks are removed. */
  practice_pool: number;
  reserved_checks: number;
  tests_passed: number;
  tests_total: number;
  /** Component revisions the package resolved to; sessions pin these. */
  components: { activity: string; evaluator: string };
}

export type PackageValidation =
  | { ok: true; package: ExperiencePackage; summary: PackageValidationSummary; issues: [] }
  | { ok: false; issues: ValidationIssue[]; summary?: PackageValidationSummary };

function zodIssues(error: z.ZodError, prefix: ReadonlyArray<PropertyKey> = []): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: toJsonPointer([...prefix, ...issue.path]),
    code: issue.code,
    message: issue.message,
  }));
}

function prefixed(prefix: string, issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, path: prefix + issue.path }));
}

function duplicateIds(items: ReadonlyArray<{ id: string }>, path: string, issues: ValidationIssue[]) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) {
      issues.push({
        path: `${path}/${i}/id`,
        code: 'duplicate_id',
        message: `"${item.id}" is used more than once.`,
      });
    }
    seen.add(item.id);
  });
}

function checkTemplate(
  template: string,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (malformedPlaceholders(template)) {
    issues.push({
      path,
      code: 'malformed_placeholder',
      message: 'Placeholders must look like {{name}} with a lowercase name.',
    });
  }
  for (const variable of templateVariables(template)) {
    if (!allowed.has(variable)) {
      issues.push({
        path,
        code: 'unknown_template_variable',
        message: `{{${variable}}} is not available here.`,
        hint: `Available: ${[...allowed].sort().join(', ')}.`,
      });
    }
  }
}

/**
 * Validates a builder's experience package: structure, cross-references, activity semantics, held-out
 * checks and the package's own tests run against the registered evaluator. Pure: no IO.
 */
export function validatePackage(input: unknown, registry: ComponentRegistry): PackageValidation {
  if (jsonDepth(input) > MAX_PACKAGE_DEPTH) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          code: 'too_deep',
          message: `The document nests deeper than ${MAX_PACKAGE_DEPTH} levels.`,
        },
      ],
    };
  }
  const parsed = ExperiencePackage.safeParse(input);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  const pkg = parsed.data;
  const issues: ValidationIssue[] = [];

  const activity = registry.activity(pkg.activity.ref);
  const evaluator = registry.evaluator(pkg.evaluator.ref);
  if (!activity) {
    issues.push({
      path: '/activity/ref',
      code: 'unknown_activity',
      message: `No activity "${pkg.activity.ref}" is registered.`,
      hint: `Registered: ${registry
        .activities()
        .map((a) => a.ref)
        .join(', ')}.`,
    });
  }
  if (!evaluator) {
    issues.push({
      path: '/evaluator/ref',
      code: 'unknown_evaluator',
      message: `No evaluator "${pkg.evaluator.ref}" is registered.`,
      hint: `Registered: ${registry
        .evaluators()
        .map((e) => e.ref)
        .join(', ')}.`,
    });
  }
  if (!activity || !evaluator) return { ok: false, issues };
  if (!evaluator.activityRefs.includes(activity.ref)) {
    issues.push({
      path: '/evaluator/ref',
      code: 'incompatible_evaluator',
      message: `"${evaluator.ref}" cannot grade "${activity.ref}".`,
    });
    return { ok: false, issues };
  }

  const params = activity.paramsSchema.safeParse(pkg.activity.params);
  if (!params.success) return { ok: false, issues: zodIssues(params.error, ['activity', 'params']) };
  issues.push(...prefixed('/activity/params', activity.checkParams(params.data)));
  const config = evaluator.configSchema.safeParse(pkg.evaluator.config);
  if (!config.success) issues.push(...zodIssues(config.error, ['evaluator', 'config']));

  checkIdentifiers(pkg, issues);
  checkContexts(pkg, activity, params.data, issues);
  checkInterventions(pkg, activity, issues);
  checkConfusions(pkg, evaluator, issues);
  checkTone(pkg, issues);
  // Pool and tests depend on sound params and contexts; stop here if those already failed.
  if (issues.length > 0) return { ok: false, issues };

  const summary = checkPoolAndTests(pkg, activity, evaluator, params.data, config.data, issues);
  if (issues.length > 0) return { ok: false, issues, summary };
  return { ok: true, package: pkg, summary, issues: [] };
}

function checkIdentifiers(pkg: ExperiencePackage, issues: ValidationIssue[]) {
  duplicateIds(pkg.prerequisites, '/prerequisites', issues);
  duplicateIds(pkg.essential_facts, '/essential_facts', issues);
  duplicateIds(pkg.contexts, '/contexts', issues);
  duplicateIds(pkg.confusions, '/confusions', issues);
  duplicateIds(pkg.reserved_checks, '/reserved_checks', issues);
}

function checkContexts(
  pkg: ExperiencePackage,
  activity: ActivityAdapter,
  params: unknown,
  issues: ValidationIssue[],
) {
  const scenarioVariables = activity.scenarioVariables(params);
  pkg.contexts.forEach((context, i) => {
    for (const slot of activity.contextSlots) {
      if (!Object.hasOwn(context.nouns, slot)) {
        issues.push({
          path: `/contexts/${i}/nouns`,
          code: 'missing_context_slot',
          message: `"${activity.ref}" needs a "${slot}" noun in every context.`,
        });
      }
    }
    const allowed = new Set([...Object.keys(context.nouns), ...scenarioVariables]);
    checkTemplate(context.scenario_template, allowed, `/contexts/${i}/scenario_template`, issues);
  });
}

/** Nouns every context defines: the only ones shared explanation templates can rely on. */
function sharedNouns(pkg: ExperiencePackage): string[] {
  const [first, ...rest] = pkg.contexts.map((c) => Object.keys(c.nouns));
  return (first ?? []).filter((noun) => rest.every((keys) => keys.includes(noun)));
}

function checkInterventions(pkg: ExperiencePackage, activity: ActivityAdapter, issues: ValidationIssue[]) {
  const { allowed, editorial } = pkg.interventions;
  const allowedSet = new Set(allowed);
  if (allowedSet.size !== allowed.length) {
    issues.push({
      path: '/interventions/allowed',
      code: 'duplicate_id',
      message: 'Each intervention may appear once.',
    });
  }
  const explanations = allowed.filter((id) => interventionKind(id) === 'explanation');
  if (explanations.length === 0) {
    issues.push({
      path: '/interventions/allowed',
      code: 'no_explanation',
      message: 'Allow at least one explanation intervention so the engine has a reviewed fallback.',
    });
  }
  for (const id of explanations) {
    if (!editorial[id]) {
      issues.push({
        path: `/interventions/editorial`,
        code: 'missing_editorial',
        message: `"${id}" is allowed but has no reviewed editorial content.`,
        hint: 'Every allowed explanation needs editorial content; it is the fallback when no model is available.',
      });
    }
  }
  for (const id of Object.keys(editorial)) {
    if (!allowedSet.has(id as (typeof allowed)[number])) {
      issues.push({
        path: `/interventions/editorial/${id}`,
        code: 'editorial_not_allowed',
        message: `Editorial content for "${id}" is present but "${id}" is not allowed.`,
      });
    } else if (interventionKind(id as (typeof allowed)[number]) === 'flow') {
      issues.push({
        path: `/interventions/editorial/${id}`,
        code: 'editorial_for_flow',
        message: `"${id}" is run by the engine and takes no editorial content.`,
      });
    }
  }
  if (allowedSet.has('swap-context') && pkg.contexts.length < 2) {
    issues.push({
      path: '/interventions/allowed',
      code: 'swap_needs_contexts',
      message: '"swap-context" needs at least two contexts.',
    });
  }
  if (allowedSet.has('prerequisite-check') && pkg.prerequisites.length === 0) {
    issues.push({
      path: '/interventions/allowed',
      code: 'prerequisite_needs_prerequisites',
      message: '"prerequisite-check" needs at least one prerequisite.',
    });
  }
  const variables = new Set([...sharedNouns(pkg), ...activity.explanationVariables]);
  for (const [id, content] of Object.entries(editorial)) {
    if (!content) continue;
    checkTemplate(content.body_template, variables, `/interventions/editorial/${id}/body_template`, issues);
    content.steps_template?.forEach((step, i) =>
      checkTemplate(step, variables, `/interventions/editorial/${id}/steps_template/${i}`, issues),
    );
  }
}

function checkConfusions(pkg: ExperiencePackage, evaluator: EvaluatorAdapter, issues: ValidationIssue[]) {
  const allowed = new Set(pkg.interventions.allowed);
  pkg.confusions.forEach((confusion, i) => {
    confusion.signals.forEach((signal, j) => {
      if (!Object.hasOwn(evaluator.errorCodes, signal)) {
        issues.push({
          path: `/confusions/${i}/signals/${j}`,
          code: 'unknown_error_code',
          message: `"${evaluator.ref}" never reports "${signal}".`,
          hint: `It reports: ${Object.keys(evaluator.errorCodes).join(', ')}.`,
        });
      }
    });
    confusion.suggested.forEach((id, j) => {
      if (!allowed.has(id)) {
        issues.push({
          path: `/confusions/${i}/suggested/${j}`,
          code: 'suggestion_not_allowed',
          message: `"${id}" is suggested but not in interventions.allowed.`,
        });
      }
    });
  });
}

/** Learner-facing text with its JSON Pointer, for literal phrase checks. */
function learnerTexts(pkg: ExperiencePackage): Array<[string, string]> {
  const texts: Array<[string, string]> = [
    ['/title', pkg.title],
    ['/objective', pkg.objective],
    ['/skill/name', pkg.skill.name],
  ];
  pkg.essential_facts.forEach((f, i) => texts.push([`/essential_facts/${i}/text`, f.text]));
  pkg.prerequisites.forEach((p, i) => texts.push([`/prerequisites/${i}/text`, p.text]));
  pkg.contexts.forEach((c, i) => {
    texts.push([`/contexts/${i}/label`, c.label], [`/contexts/${i}/scenario_template`, c.scenario_template]);
    Object.entries(c.nouns).forEach(([key, value]) => texts.push([`/contexts/${i}/nouns/${key}`, value]));
  });
  for (const [id, content] of Object.entries(pkg.interventions.editorial)) {
    if (!content) continue;
    texts.push([`/interventions/editorial/${id}/title`, content.title]);
    texts.push([`/interventions/editorial/${id}/body_template`, content.body_template]);
    content.steps_template?.forEach((s, i) =>
      texts.push([`/interventions/editorial/${id}/steps_template/${i}`, s]),
    );
  }
  return texts;
}

function checkTone(pkg: ExperiencePackage, issues: ValidationIssue[]) {
  const phrases = pkg.tone.must_not_phrases.map((p) => p.toLowerCase());
  for (const [path, text] of learnerTexts(pkg)) {
    const lower = text.toLowerCase();
    for (const phrase of phrases) {
      if (lower.includes(phrase)) {
        issues.push({ path, code: 'tone_violation', message: `Contains the excluded phrase "${phrase}".` });
      }
    }
  }
}

function checkPoolAndTests(
  pkg: ExperiencePackage,
  activity: ActivityAdapter,
  evaluator: EvaluatorAdapter,
  params: unknown,
  config: unknown,
  issues: ValidationIssue[],
): PackageValidationSummary {
  const contextIds = new Set(pkg.contexts.map((c) => c.id));
  const reservedIdentities = new Set<string>();
  pkg.reserved_checks.forEach((check, i) => {
    const path = `/reserved_checks/${i}`;
    if (!contextIds.has(check.context_id)) {
      issues.push({
        path: `${path}/context_id`,
        code: 'unknown_context',
        message: `No context "${check.context_id}".`,
      });
    }
    const spec = activity.specSchema.safeParse(check.spec);
    if (!spec.success) {
      issues.push(...zodIssues(spec.error, ['reserved_checks', i, 'spec']));
      return;
    }
    const misfit = activity.checkSpecAgainstParams(params, spec.data);
    if (misfit) {
      issues.push({ ...misfit, path: `${path}/spec${misfit.path}` });
      return;
    }
    const identity = activity.specIdentity(spec.data);
    if (reservedIdentities.has(identity)) {
      issues.push({
        path: `${path}/spec`,
        code: 'duplicate_reserved_check',
        message: 'Another reserved check is the same problem (contexts do not make a problem new).',
      });
    }
    reservedIdentities.add(identity);
  });

  const candidates = activity.enumerateSpecs(params);
  const practicePool = candidates.filter(
    (spec) => !reservedIdentities.has(activity.specIdentity(spec)),
  ).length;
  const policy = pkg.session_policy;
  if (reservedIdentities.size < policy.independent_items) {
    issues.push({
      path: '/reserved_checks',
      code: 'not_enough_reserved_checks',
      message: `session_policy.independent_items is ${policy.independent_items} but only ${reservedIdentities.size} distinct reserved checks exist.`,
    });
  }
  // Practice items, the optional baseline item and one worked example must all come from unseen-safe problems.
  const needed = policy.practice_items + (policy.baseline ? 1 : 0) + 1;
  if (practicePool < needed) {
    issues.push({
      path: '/activity/params',
      code: 'practice_pool_too_small',
      message: `Only ${practicePool} practice problems remain after removing reserved checks; a session needs ${needed}.`,
      hint: 'Widen the totals range, add fractions or reserve fewer checks.',
    });
  }

  let passed = 0;
  pkg.tests.forEach((test, i) => {
    const path = `/tests/${i}`;
    const spec = activity.specSchema.safeParse(test.spec);
    const response = activity.responseSchema.safeParse(test.response);
    if (!spec.success) return issues.push(...zodIssues(spec.error, ['tests', i, 'spec']));
    if (!response.success) return issues.push(...zodIssues(response.error, ['tests', i, 'response']));
    const expectedCode = test.expect.error_code;
    if (expectedCode && !Object.hasOwn(evaluator.errorCodes, expectedCode)) {
      return issues.push({
        path: `${path}/expect/error_code`,
        code: 'unknown_error_code',
        message: `"${evaluator.ref}" never reports "${expectedCode}".`,
      });
    }
    const result = evaluator.evaluate(config, spec.data, response.data);
    const codeMatches = expectedCode === undefined || expectedCode === result.error_code;
    if (result.correct === test.expect.correct && codeMatches) {
      passed++;
    } else {
      issues.push({
        path,
        code: 'test_failed',
        message: `"${test.name}": expected correct=${test.expect.correct}${expectedCode !== undefined ? ` error_code=${expectedCode}` : ''}, got correct=${result.correct} error_code=${result.error_code}.`,
      });
    }
  });

  return {
    candidate_pool: candidates.length,
    practice_pool: practicePool,
    reserved_checks: reservedIdentities.size,
    tests_passed: passed,
    tests_total: pkg.tests.length,
    components: { activity: activity.revision, evaluator: evaluator.revision },
  };
}
