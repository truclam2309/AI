import { LoginRequest, RegisterRequest, RegisterResponse, TokenResponse } from '../types/auth';
import { request } from './client';

export const authApi = {
  login: (payload: LoginRequest) => request<TokenResponse>('POST', '/auth/login', { body: payload, auth: false }),
  // Registration hashes the password and commits a new user/profile row. Give
  // a cold local backend more time to finish startup and its first DB write.
  register: (payload: RegisterRequest) => request<RegisterResponse>('POST', '/auth/register', {
    body: payload,
    auth: false,
    timeoutMs: 60000
  })
};
