import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import {
  DEFAULT_STATUS_CODES,
  METHODS,
  routeDescription,
  type ErasedMethodConfig,
} from '../core/engine.js';
import { PROBLEM_CONTENT_TYPE } from '../core/errors.js';
import type { HttpMethod } from '../core/types.js';

/**
 * routerplate/openapi: an OpenAPI 3.1 document from `route()` results.
 *
 * ```typescript
 * import { openapi } from 'routerplate/openapi';
 *
 * const doc = openapi({
 *   info: { title: 'Items', version: '1.0.0' },
 *   paths: { '/items': itemsRoute, '/items/{id}': itemRoute },
 * });
 * ```
 *
 * Schemas become JSON Schema through their own Standard JSON Schema
 * converter (`~standard.jsonSchema`). Validators without one need
 * `toJsonSchema`. Framework-free and validator-free, like the core.
 */

export type JsonSchema = Record<string, unknown>;

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
  [member: string]: unknown;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

/** What `route()` returns, on any adapter. */
export type RouteLike = (...args: never[]) => unknown;

export type SchemaUse = 'input' | 'output';

export interface OpenApiOptions {
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  /** Path templates to routes: `'/items/{id}'` (Express's `'/items/:id'` works too). */
  paths: Record<string, RouteLike>;
  /**
   * Convert a schema to JSON Schema (draft 2020-12). `use` is `'input'`
   * for `body`, `query` and `params` (what the client sends) and
   * `'output'` for `response` (what goes on the wire). Defaults to the
   * schema's own `~standard.jsonSchema`.
   */
  toJsonSchema?: (schema: StandardSchemaV1, use: SchemaUse) => JsonSchema;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  schema: JsonSchema;
}

export interface OpenApiMediaType {
  schema: JsonSchema;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: { required: true; content: Record<string, OpenApiMediaType> };
  responses: Record<string, OpenApiResponse>;
}

export type OpenApiPathItem = Partial<Record<Lowercase<HttpMethod>, OpenApiOperation>>;

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  paths: Record<string, OpenApiPathItem>;
  components: { schemas: Record<string, JsonSchema> };
}

const SUCCESS_DESCRIPTIONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
};

/** The RFC 9457 body every error response carries. Mirrors `Problem` in core/errors. */
function problemSchemas(): Record<string, JsonSchema> {
  return {
    Problem: {
      type: 'object',
      description: 'RFC 9457 Problem Details.',
      properties: {
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        instance: { type: 'string', description: 'The request path.' },
        code: { type: 'string', description: 'Machine-readable error code.' },
        errors: { type: 'array', items: { $ref: '#/components/schemas/ProblemError' } },
      },
      required: ['title', 'status', 'detail', 'instance', 'code'],
    },
    ProblemError: {
      type: 'object',
      properties: {
        pointer: { type: 'string', description: 'JSON Pointer (RFC 6901) to the failing field.' },
        detail: { type: 'string' },
      },
      required: ['pointer', 'detail'],
    },
  };
}

function problemResponse(description: string): OpenApiResponse {
  return {
    description,
    content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/Problem' } } },
  };
}

type Slot = 'query' | 'params' | 'body' | 'response';
type Convert = (schema: StandardSchemaV1, use: SchemaUse, slot: Slot, where: string) => JsonSchema;

function makeConvert(custom: OpenApiOptions['toJsonSchema']): Convert {
  return (schema, use, slot, where) => {
    let json: JsonSchema;
    if (custom) {
      json = custom(schema, use);
    } else {
      const std = schema['~standard'] as StandardSchemaV1.Props &
        Partial<StandardJSONSchemaV1.Props>;
      if (!std.jsonSchema) {
        throw new Error(
          `routerplate: openapi(): the ${slot} schema for ${where} (${std.vendor}) does not ` +
            'implement Standard JSON Schema; pass `toJsonSchema`.',
        );
      }
      json = std.jsonSchema[use]({ target: 'draft-2020-12' });
    }
    // The document's dialect is 2020-12 already; a per-schema `$schema` is noise.
    const copy = { ...json };
    delete copy.$schema;
    return copy;
  };
}

function isRecord(value: unknown): value is Record<string, JsonSchema> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Express `:id` → `{id}`. */
function normalizePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function templateParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * One parameter per property of an object schema. `params` properties are
 * path parameters; so is any `query` property named in the path template,
 * which is how Next's dynamic segments (merged into `req.query`) come out.
 */
function toParameters(
  schema: JsonSchema,
  slot: 'query' | 'params',
  declared: string[],
  where: string,
): OpenApiParameter[] {
  if (!isRecord(schema.properties)) {
    throw new Error(
      `routerplate: openapi(): the ${slot} schema for ${where} must describe an object ` +
        'with properties.',
    );
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).map(([name, propertySchema]) => {
    const inPath = slot === 'params' || declared.includes(name);
    if (slot === 'params' && !declared.includes(name)) {
      throw new Error(
        `routerplate: openapi(): ${where} declares path parameter "${name}" but the path ` +
          `template has no {${name}}.`,
      );
    }
    return {
      name,
      in: inPath ? 'path' : 'query',
      required: inPath || required.has(name),
      schema: propertySchema,
    };
  });
}

function toOperation(
  method: HttpMethod,
  path: string,
  config: ErasedMethodConfig,
  authenticates: boolean,
  convert: Convert,
): OpenApiOperation {
  const where = `${method} ${path}`;
  const declared = templateParams(path);

  const parameters: OpenApiParameter[] = [];
  if (config.params) {
    const schema = convert(config.params, 'input', 'params', where);
    parameters.push(...toParameters(schema, 'params', declared, where));
  }
  if (config.query) {
    const schema = convert(config.query, 'input', 'query', where);
    parameters.push(...toParameters(schema, 'query', declared, where));
  }
  // OpenAPI requires every template variable to be declared.
  for (const name of declared) {
    if (!parameters.some((parameter) => parameter.name === name)) {
      parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
    }
  }

  const operation: OpenApiOperation = { responses: {} };
  if (parameters.length > 0) operation.parameters = parameters;
  if (config.body) {
    const schema = convert(config.body, 'input', 'body', where);
    operation.requestBody = { required: true, content: { 'application/json': { schema } } };
  }

  const status = DEFAULT_STATUS_CODES[method];
  const success: OpenApiResponse = { description: SUCCESS_DESCRIPTIONS[status] ?? 'Success' };
  if (config.response && status !== 204) {
    const schema = convert(config.response, 'output', 'response', where);
    success.content = { 'application/json': { schema } };
  }

  const { responses } = operation;
  responses[status] = success;
  if (config.body || config.query || config.params) {
    responses[400] = problemResponse('Validation failed');
  }
  if (authenticates && config.requireAuth !== false) {
    responses[401] = problemResponse('Authentication required');
  }
  if (config.authorize) responses[403] = problemResponse('Forbidden');
  responses[500] = problemResponse('Internal server error');
  return operation;
}

/** Build an OpenAPI 3.1 document from `route()` results. Nothing is written; that is your script's job. */
export function openapi(options: OpenApiOptions): OpenApiDocument {
  const convert = makeConvert(options.toJsonSchema);
  const paths: Record<string, OpenApiPathItem> = {};

  for (const [rawPath, handler] of Object.entries(options.paths)) {
    const description = routeDescription(handler);
    if (!description) {
      throw new Error(`routerplate: openapi(): "${rawPath}" is not a route() result.`);
    }
    const path = normalizePath(rawPath);
    const item: OpenApiPathItem = {};
    for (const method of METHODS) {
      const config = description.config[method];
      if (!config) continue;
      item[method.toLowerCase() as Lowercase<HttpMethod>] = toOperation(
        method,
        path,
        config,
        description.authenticates,
        convert,
      );
    }
    paths[path] = item;
  }

  return {
    openapi: '3.1.0',
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
    components: { schemas: problemSchemas() },
  };
}
