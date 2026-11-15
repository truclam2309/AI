export type ApiErrorKind = 'network' | 'auth' | 'validation' | 'not_found' | 'server';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status: number;
  fieldErrors: Record<string, string>;

  constructor(kind: ApiErrorKind, message: string, status = 0, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError('server', 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.');
}

interface FastApiValidationItem {
  loc?: (string | number)[];
  msg?: string;
}

/** Maps a FastAPI error body ({ detail }) to a typed ApiError. */
export function errorFromResponse(status: number, data: unknown): ApiError {
  const detail = (data as {detail?: unknown;} | null)?.detail;

  if (status === 401 || status === 403) {
    return new ApiError('auth', typeof detail === 'string' ? detail : 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', status);
  }
  if (status === 422 || status === 400 || status === 409) {
    const fieldErrors: Record<string, string> = {};
    if (Array.isArray(detail)) {
      (detail as FastApiValidationItem[]).forEach((item) => {
        const field = item.loc?.[item.loc.length - 1];
        if (typeof field === 'string' && item.msg) fieldErrors[field] = item.msg;
      });
    }
    const detailMessage = (detail as {message?: unknown} | null)?.message;
    const message = typeof detail === 'string'
      ? detail
      : typeof detailMessage === 'string'
        ? detailMessage
        : 'Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại các trường.';
    return new ApiError('validation', message, status, fieldErrors);
  }
  if (status === 404) {
    return new ApiError('not_found', typeof detail === 'string' ? detail : 'Không tìm thấy dữ liệu.', status);
  }
  return new ApiError('server', typeof detail === 'string' ? detail : `Máy chủ gặp sự cố (HTTP ${status}). Vui lòng kiểm tra backend và thử lại.`, status);
}
