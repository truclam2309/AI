
import { LoginRequest, RegisterRequest, RegisterResponse, TokenResponse } from '../types/auth';
import { request } from './client';

export const authApi = {
  login: (payload: LoginRequest) =>
    request<TokenResponse>('POST', '/auth/login', {
      body: payload,
      auth: false
    }),

  register: (payload: RegisterRequest) =>
    request<RegisterResponse>('POST', '/auth/register', {
      body: payload,
      auth: false,
      timeoutMs: 60000
    })
};
