const DUE_API_BASE = 'https://api.due.network/v1';

export async function dueRequest<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    accountId?: string;
  } = {},
): Promise<{ data: T; status: number }> {
  const apiKey = process.env.DUE_API_KEY;
  if (!apiKey) {
    throw new Error('DUE_API_KEY environment variable is not set');
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (options.accountId) {
    headers['Due-Account-Id'] = options.accountId;
  }

  const res = await fetch(`${DUE_API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json() as T;

  if (!res.ok) {
    return { data, status: res.status };
  }

  return { data, status: res.status };
}

export function errorResponse(message: string, status: number = 400): Response {
  return Response.json({ error: true, message }, { status });
}
