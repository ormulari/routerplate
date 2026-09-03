import http from 'node:http';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

/** Lightweight mock response capturing what routerplate writes. */
export interface MockRes {
  statusCode: number | undefined;
  /** Parsed body, whether it came through json() or send(). */
  jsonBody: unknown;
  ended: boolean;
  headers: Record<string, string>;
  headersSent: boolean;
  writableEnded: boolean;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
  send(payload: string): MockRes;
  end(): MockRes;
  setHeader(name: string, value: string): void;
}

export function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: undefined,
    jsonBody: undefined,
    ended: false,
    headers: {},
    headersSent: false,
    writableEnded: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.jsonBody = payload;
      if (!res.headers['content-type']) res.headers['content-type'] = 'application/json';
      return res.end();
    },
    send(payload) {
      res.jsonBody = JSON.parse(payload);
      return res.end();
    },
    end() {
      res.headersSent = true;
      res.writableEnded = true;
      res.ended = true;
      return res;
    },
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = String(value);
    },
  };
  return res;
}

export function nextReq(
  init: { method?: string; url?: string; body?: unknown; query?: Record<string, unknown> } = {},
): NextApiRequest {
  return {
    method: init.method ?? 'GET',
    url: init.url ?? '/api/test',
    body: init.body,
    query: init.query ?? {},
  } as unknown as NextApiRequest;
}

export function asNextRes(res: MockRes): NextApiResponse {
  return res as unknown as NextApiResponse;
}

/**
 * Minimal stand-in for Next's apiResolver: parses the JSON body and query
 * string, decorates node's req/res with the NextApi surface routerplate
 * touches, and invokes the handler. Good enough for supertest.
 */
export function shimServer(handler: NextApiHandler): http.Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const apiRes = Object.assign(res, {
        status(code: number) {
          res.statusCode = code;
          return apiRes;
        },
        json(payload: unknown) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
          return apiRes;
        },
        send(payload: unknown) {
          res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
          return apiRes;
        },
      });
      const apiReq = Object.assign(req, {
        query: Object.fromEntries(url.searchParams),
        body,
        cookies: {},
        env: {},
      });
      void handler(apiReq as never, apiRes as never);
    });
  });
}
