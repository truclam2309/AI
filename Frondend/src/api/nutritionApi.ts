import { NutritionCalculation, NutritionHistoryItem, ProfileUpdate } from '../types/nutrition';
import { request } from './client';

export const nutritionApi = {
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
