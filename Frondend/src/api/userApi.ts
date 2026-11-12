import { User } from '../types/auth';
import { ProfileUpdate, UserProfile } from '../types/nutrition';
import { request } from './client';

export const userApi = {
  getMe: async () => (await request<{data: User}>('GET', '/users/me')).data,
  updateProfile: async (profile: ProfileUpdate) =>
    (await request<{data: UserProfile}>('PUT', '/users/me/profile', { body: profile })).data
};
