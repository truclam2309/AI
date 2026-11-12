import { UserProfile } from './nutrition';

export interface User {
  id: number;
  username: string | null;
  email: string | null;
  created_at: string;
  profile: Partial<UserProfile> | null;
}

export interface LoginRequest {
  username_or_email: string;
  password: string;
}

export interface RegisterRequest {
  username?: string;
  email?: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'bearer';
}

export interface RegisterResponse extends TokenResponse {
  user: User;
}
