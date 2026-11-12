import { DailyMealPlan, GeneratePlanResponse, MealType } from '../types/nutrition';
import { request } from './client';

export const mealPlanApi = {
  getPlans: async (date?: string) =>
    (await request<{date: string; data: DailyMealPlan[]}>('GET', '/meal-plans', {
      query: date ? { date } : undefined
    })).data,
  generate: (planDate: string, mealSplit?: Record<string, number>) =>
    request<GeneratePlanResponse>('POST', '/meal-plans/generate', {
      body: { plan_date: planDate, ...(mealSplit ? { meal_split: mealSplit } : {}) },
      timeoutMs: 60000
    }),
  regenerate: (planId: number, mealSplit?: Record<string, number>) =>
    request<GeneratePlanResponse>('POST', `/meal-plans/${planId}/regenerate`, {
      ...(mealSplit ? { body: { meal_split: mealSplit } } : {}), timeoutMs: 60000
    }),
  selectDish: (payload: {plan_date: string; meal_type: MealType; dish_id: string}) =>
    request<GeneratePlanResponse>('POST', '/meal-plans/select-dish', { body: payload, timeoutMs: 60000 }),
  history: (page = 1, pageSize = 20) =>
    request<{page: number; page_size: number; total: number; data: DailyMealPlan[]}>(
      'GET', '/meal-plans/history', { query: { page, page_size: pageSize } }
    )
};
