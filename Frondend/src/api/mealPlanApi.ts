import { DailyMealPlan, GeneratePlanResponse, MealType } from '../types/nutrition';
import { request } from './client';

export const mealPlanApi = {
  getPlans: async (date?: string) =>
    (await request<{date: string; data: DailyMealPlan[]}>('GET', '/meal-plans', {
      query: date ? { date } : undefined
    })).data,
  generate: (planDate: string, mealSplit?: Record<string, number>, counts?: {main_meals: number; side_meals: number}) =>
    request<GeneratePlanResponse>('POST', '/meal-plans/generate', {
      body: { plan_date: planDate, ...(mealSplit ? { meal_split: mealSplit } : {}), ...counts },
      timeoutMs: 120000
    }),
  regenerate: (planId: number, mealSplit?: Record<string, number>, counts?: {main_meals: number; side_meals: number}) =>
    request<GeneratePlanResponse>('POST', `/meal-plans/${planId}/regenerate`, {
      body: { ...(mealSplit ? { meal_split: mealSplit } : {}), ...counts }, timeoutMs: 120000
    }),
  setCooked: (itemId: number, isCooked: boolean) =>
    request<{id: number; is_cooked: boolean}>('PUT', `/meal-plans/items/${itemId}/cooked`, { body: { is_cooked: isCooked } }),
  setConsumption: (itemId: number, consumedRatio: number) =>
    request<{id: number; consumed_ratio: number}>('PUT', `/meal-plans/items/${itemId}/consumption`, { body: { consumed_ratio: consumedRatio } }),
  selectDish: (payload: {plan_date: string; meal_type: MealType; dish_id: string}) =>
    request<GeneratePlanResponse>('POST', '/meal-plans/select-dish', { body: payload, timeoutMs: 120000 }),
  history: (page = 1, pageSize = 20) =>
    request<{page: number; page_size: number; total: number; data: DailyMealPlan[]}>(
      'GET', '/meal-plans/history', { query: { page, page_size: pageSize } }
    )
};
