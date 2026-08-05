export const HTTP_VALIDATION_FAILED = 'http.validation_failed';
export const HTTP_BAD_REQUEST = 'http.bad_request';
export const HTTP_INVALID_JSON = 'http.invalid_json';
export const HTTP_REQUEST_ID_INVALID = 'http.request_id_invalid';
export const HTTP_IDEMPOTENCY_KEY_INVALID = 'http.idempotency_key_invalid';
export const HTTP_UNAUTHORIZED = 'http.unauthorized';
export const HTTP_FORBIDDEN = 'http.forbidden';
export const HTTP_NOT_FOUND = 'http.not_found';
export const HTTP_METHOD_NOT_ALLOWED = 'http.method_not_allowed';
export const HTTP_CONFLICT = 'http.conflict';
export const HTTP_UNSUPPORTED_MEDIA_TYPE = 'http.unsupported_media_type';
export const HTTP_PAYLOAD_TOO_LARGE = 'http.payload_too_large';
export const HTTP_TOO_MANY_REQUESTS = 'http.too_many_requests';
export const HTTP_UNAVAILABLE = 'http.unavailable';
export const HTTP_INTERNAL_ERROR = 'http.internal_error';

export type HttpErrorCode =
  | typeof HTTP_VALIDATION_FAILED
  | typeof HTTP_BAD_REQUEST
  | typeof HTTP_INVALID_JSON
  | typeof HTTP_REQUEST_ID_INVALID
  | typeof HTTP_IDEMPOTENCY_KEY_INVALID
  | typeof HTTP_UNAUTHORIZED
  | typeof HTTP_FORBIDDEN
  | typeof HTTP_NOT_FOUND
  | typeof HTTP_METHOD_NOT_ALLOWED
  | typeof HTTP_CONFLICT
  | typeof HTTP_UNSUPPORTED_MEDIA_TYPE
  | typeof HTTP_PAYLOAD_TOO_LARGE
  | typeof HTTP_TOO_MANY_REQUESTS
  | typeof HTTP_UNAVAILABLE
  | typeof HTTP_INTERNAL_ERROR;
