import { BodyStatusPrediction, BodyStatusRequest, NutritionCalculation, NutritionHistoryItem, ProfileUpdate } from '../types/nutrition';
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
  save: async (bodyStatusInput?: BodyStatusRequest) => (await request<{data: NutritionHistoryItem}>(
    'POST', '/nutrition/history', bodyStatusInput ? {body: {body_status_input: bodyStatusInput}} : {}
  )).data,
  history: async () => (await request<{data: NutritionHistoryItem[]}>('GET', '/nutrition/history')).data,
  predictBodyStatus: async (payload: BodyStatusRequest) =>
    (await request<{data: BodyStatusPrediction}>('POST', '/nutrition/body-status', { body: payload })).data
};
