
import { ApiError, errorFromResponse, toApiError } from './errors';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
  timeoutMs?: number;
}

const env = (
  import.meta as unknown as {
    env?: Record<string, string | undefined>;
  }
).env;

/**
 * API base URL:
 * - Local: http://127.0.0.1:8000/api/v1
 * - Production: https://ai-9kpu.onrender.com/api/v1
 *
 * VITE_API_URL có thể có hoặc không có /api/v1.
 * Tự động chuẩn hóa để tránh lặp đường dẫn.
 */
const API_BASE_URL = (
  env?.VITE_API_URL ?? 'https://ai-9kpu.onrender.com'
).replace(/\/+$/, '');

export const API_URL = API_BASE_URL.endsWith('/api/v1')
  ? API_BASE_URL
  : `${API_BASE_URL}/api/v1`;

const TOKEN_KEY = 'nutriai.token';
export const UNAUTHORIZED_EVENT = 'nutriai:unauthorized';
const DEFAULT_TIMEOUT_MS = 15000;

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),

  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),

  clear: () => localStorage.removeItem(TOKEN_KEY)
};

export async function request<T>(
  method: Method,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    body,
    query,
    auth = true,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = options;

  const normalizedPath = path.startsWith('/')
    ? path
    : `/${path}`;

  const url = normalizedPath + buildQuery(query);
  const token = auth ? tokenStore.get() : null;

  try {
    return await httpRequest<T>(
      method,
      url,
      body,
      token,
      timeoutMs
    );
  } catch (e) {
    const err = toApiError(e);

    if (err.kind === 'auth' && auth) {
      tokenStore.clear();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }

    throw err;
  }
}

async function httpRequest<T>(
  method: Method,
  url: string,
  body: unknown,
  token: string | null,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();

  const timer = window.setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  let res: Response;

  try {
    res = await fetch(`${API_URL}${url}`, {
      method,
      headers: {
        ...(body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),

        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {})
      },
      body: body !== undefined
        ? JSON.stringify(body)
        : undefined,
      signal: controller.signal
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new ApiError(
        'network',
        'Máy chủ phản hồi quá lâu. Vui lòng thử lại.'
      );
    }

    throw new ApiError(
      'network',
      `Không kết nối được máy chủ ${API_URL}. Hãy kiểm tra backend đang chạy và CORS cho phép nguồn ${window.location.origin}.`
    );
  } finally {
    window.clearTimeout(timer);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const data: unknown = await res.json().catch(() => null);

  if (res.ok) {
    return data as T;
  }

  throw errorFromResponse(res.status, data);
}

function buildQuery(
  query?: Record<string, string | number | undefined>
): string {
  if (!query) {
    return '';
  }

  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();

  return queryString ? `?${queryString}` : '';
}
