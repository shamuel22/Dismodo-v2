import type { ExperiencePackage, LearnerAction } from '@dismodo/contracts';
import { DismodoApiError } from './errors';
import type {
  AttestationResponse,
  CatalogComponents,
  DecisionMetrics,
  ExperienceSchema,
  GetPackageResponse,
  ImportPackageResponse,
  LearnerHistoryResponse,
  ListPackagesResponse,
  PublishOptions,
  PublishPackageResponse,
  ResetHistoryOptions,
  ResetHistoryResponse,
  SearchExperiencesResponse,
  SessionEventsResponse,
  SessionEvidence,
  SessionViewResponse,
  StartSessionInput,
  StartSessionResponse,
  SubmitOptions,
  SubmitSessionResponse,
  ValidatePackageResponse,
} from './types';

/** Fetch implementation to use; defaults to the global `fetch` so the SDK stays dependency-free. */
export type FetchLike = typeof fetch;

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: FetchLike;
}

export interface RuntimeClientOptions {
  baseUrl: string;
  sessionToken: string;
  fetch?: FetchLike;
}

type Method = 'GET' | 'POST';

interface Requester {
  request<T>(method: Method, path: string, body?: unknown): Promise<T>;
}

function createRequester(baseUrl: string, fetchFn: FetchLike, authorization: () => string | undefined) {
  const base = baseUrl.replace(/\/+$/, '');
  const request = async <T>(method: Method, path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = {};
    const auth = authorization();
    if (auth) headers.Authorization = auth;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchFn(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      let code: string | undefined;
      let message: string | undefined;
      let details: unknown;
      try {
        const data = (await response.json()) as {
          error?: { code?: string; message?: string; details?: unknown };
        } | null;
        code = data?.error?.code;
        message = data?.error?.message;
        details = data?.error?.details;
      } catch {
        // Non-JSON error body: fall through to the status-based error below.
      }
      throw new DismodoApiError(
        response.status,
        code ?? (response.status === 429 ? 'rate_limited' : 'http_error'),
        message ?? `Request failed with status ${response.status}.`,
        details,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      return undefined as T;
    }
  };
  return { request } satisfies Requester;
}

// Why dashes are removed: the API accepts `^[A-Za-z0-9_-]{8,64}$`, and a bare UUID satisfies it.
function generateClientEventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function submitBody(action: LearnerAction, options?: SubmitOptions) {
  return { client_event_id: options?.clientEventId ?? generateClientEventId(), action };
}

/** Reads the session token from a learner link: the token lives after `#` so it never reaches server logs. */
export function tokenFromSessionUrl(url: string): string | null {
  const hash = url.indexOf('#');
  if (hash === -1) return null;
  const token = url.slice(hash + 1);
  return token ? token : null;
}

export interface DismodoClient {
  packages: {
    validate(pkg: ExperiencePackage): Promise<ValidatePackageResponse>;
    import(pkg: ExperiencePackage): Promise<ImportPackageResponse>;
    list(): Promise<ListPackagesResponse>;
    get(experienceId: string, version: string): Promise<GetPackageResponse>;
    publish(experienceId: string, version: string, options: PublishOptions): Promise<PublishPackageResponse>;
  };
  experiences: {
    search(q?: string): Promise<SearchExperiencesResponse>;
  };
  sessions: {
    start(input: StartSessionInput): Promise<StartSessionResponse>;
    get(id: string): Promise<SessionViewResponse>;
    submit(id: string, action: LearnerAction, options?: SubmitOptions): Promise<SubmitSessionResponse>;
    evidence(id: string): Promise<SessionEvidence>;
    events(id: string): Promise<SessionEventsResponse>;
  };
  learners: {
    history(learnerRef: string): Promise<LearnerHistoryResponse>;
    resetHistory(learnerRef: string, options?: ResetHistoryOptions): Promise<ResetHistoryResponse>;
  };
  metrics: {
    decisions(): Promise<DecisionMetrics>;
  };
  catalog: {
    experienceSchema(): Promise<ExperienceSchema>;
    components(): Promise<CatalogComponents>;
  };
}

/** Creates a client for the tenant API. Send the API key as a Bearer token; catalog routes need no key. */
export function createClient(options: ClientOptions): DismodoClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const authed = createRequester(
    options.baseUrl,
    fetchFn,
    () => (options.apiKey ? `Bearer ${options.apiKey}` : undefined),
  );
  // Catalog and attestation are public: they must work for clients created without an API key.
  const publicClient = createRequester(options.baseUrl, fetchFn, () => undefined);

  return {
    packages: {
      validate: (pkg) => authed.request('POST', '/v1/packages/validate', pkg),
      import: (pkg) => authed.request('POST', '/v1/packages', pkg),
      list: () => authed.request('GET', '/v1/packages'),
      get: (experienceId, version) =>
        authed.request(
          'GET',
          `/v1/packages/${encodeURIComponent(experienceId)}/${encodeURIComponent(version)}`,
        ),
      publish: async (experienceId, version, publishOptions) => {
        // The reviewer must send the statement verbatim, so fetch the server's exact wording.
        const { statement } = await publicClient.request<AttestationResponse>(
          'GET',
          '/v1/packages/attestation',
        );
        return authed.request(
          'POST',
          `/v1/packages/${encodeURIComponent(experienceId)}/${encodeURIComponent(version)}/publish`,
          {
            attestation: { reviewer: publishOptions.reviewer, statement },
            ...(publishOptions.contentHash ? { content_hash: publishOptions.contentHash } : {}),
          },
        );
      },
    },
    experiences: {
      search: (q) =>
        authed.request(
          'GET',
          q === undefined ? '/v1/experiences' : `/v1/experiences?q=${encodeURIComponent(q)}`,
        ),
    },
    sessions: {
      start: (input) =>
        authed.request('POST', '/v1/sessions', {
          experience: input.experience,
          learner_ref: input.learnerRef,
          ...(input.declared !== undefined ? { declared: input.declared } : {}),
          ...(input.policy !== undefined ? { policy: input.policy } : {}),
        }),
      get: (id) => authed.request('GET', `/v1/sessions/${encodeURIComponent(id)}`),
      submit: (id, action, submitOptions) =>
        authed.request(
          'POST',
          `/v1/sessions/${encodeURIComponent(id)}/events`,
          submitBody(action, submitOptions),
        ),
      evidence: (id) => authed.request('GET', `/v1/sessions/${encodeURIComponent(id)}/evidence`),
      events: (id) => authed.request('GET', `/v1/sessions/${encodeURIComponent(id)}/events`),
    },
    learners: {
      history: (learnerRef) =>
        authed.request('GET', `/v1/learners/${encodeURIComponent(learnerRef)}/history`),
      resetHistory: (learnerRef, resetOptions) =>
        authed.request('POST', `/v1/learners/${encodeURIComponent(learnerRef)}/history/reset`, {
          ...(resetOptions?.skillKey ? { skill_key: resetOptions.skillKey } : {}),
        }),
    },
    metrics: {
      decisions: () => authed.request('GET', '/v1/metrics/decisions'),
    },
    catalog: {
      experienceSchema: () => publicClient.request('GET', '/v1/schemas/experience.json'),
      components: () => publicClient.request('GET', '/v1/components'),
    },
  };
}

export interface RuntimeClient {
  view(): Promise<SessionViewResponse>;
  submit(action: LearnerAction, options?: SubmitOptions): Promise<SubmitSessionResponse>;
  tokenFromSessionUrl(url: string): string | null;
}

/** Creates a client for one learner link, authenticated by its session token (`Authorization: Session ...`). */
export function createRuntimeClient(options: RuntimeClientOptions): RuntimeClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const requester = createRequester(
    options.baseUrl,
    fetchFn,
    () => `Session ${options.sessionToken}`,
  );
  return {
    view: () => requester.request('GET', '/v1/runtime/session'),
    submit: (action, submitOptions) =>
      requester.request('POST', '/v1/runtime/events', submitBody(action, submitOptions)),
    tokenFromSessionUrl,
  };
}
