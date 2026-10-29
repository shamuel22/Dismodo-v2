import type {
  ActivityAdapter,
  ComponentRegistry,
  ContextOption,
  EvaluatorAdapter,
  ExperiencePackage,
} from '@dismodo/contracts';
import { validatePackage } from '../validate-package';

export const ENGINE_VERSION = '0.3.0';

export interface ReservedItem {
  id: string;
  spec: unknown;
  context_id: string;
  identity: string;
}

/** A validated package bound to its components, ready to run sessions. */
export interface PackageRuntime {
  pkg: ExperiencePackage;
  activity: ActivityAdapter;
  evaluator: EvaluatorAdapter;
  params: unknown;
  evaluatorConfig: unknown;
  practicePool: unknown[];
  reserved: ReservedItem[];
  contexts: Map<string, ContextOption>;
}

export function buildRuntime(input: unknown, registry: ComponentRegistry): PackageRuntime {
  const result = validatePackage(input, registry);
  if (!result.ok) throw new Error(`Package is not valid: ${result.issues.map((i) => i.code).join(', ')}`);
  const pkg = result.package;
  const activity = registry.activity(pkg.activity.ref)!;
  const evaluator = registry.evaluator(pkg.evaluator.ref)!;
  const params = activity.paramsSchema.parse(pkg.activity.params);
  const reserved = pkg.reserved_checks.map((check) => {
    const spec = activity.specSchema.parse(check.spec);
    return { id: check.id, spec, context_id: check.context_id, identity: activity.specIdentity(spec) };
  });
  const reservedIdentities = new Set(reserved.map((r) => r.identity));
  return {
    pkg,
    activity,
    evaluator,
    params,
    evaluatorConfig: evaluator.configSchema.parse(pkg.evaluator.config),
    practicePool: activity
      .enumerateSpecs(params)
      .filter((s) => !reservedIdentities.has(activity.specIdentity(s))),
    reserved,
    contexts: new Map(pkg.contexts.map((c) => [c.id, c])),
  };
}
