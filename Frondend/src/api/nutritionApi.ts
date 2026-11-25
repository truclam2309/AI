import { NutritionCalculation, NutritionHistoryItem, ProfileUpdate } from '../types/nutrition';
import { request } from './client';

export const nutritionApi = {
  calculatePreview: async (payload: ProfileUpdate) =>
    (await request<{data: NutritionCalculation}>('POST', '/nutrition/calculate-preview', { body: payload, auth: false })).data,
  calculate: async (profile?: ProfileUpdate) => {
    const result = await request<{data: NutritionCalculation}>(
      'POST',
      '/nutrition/calculate',
      profile ? { body: profile } : {}
    );
    return result.data;
  },
  save: async () => (await request<{data: NutritionHistoryItem}>(
    'POST', '/nutrition/history'
  )).data,
  history: async () => (await request<{data: NutritionHistoryItem[]}>('GET', '/nutrition/history')).data
};
