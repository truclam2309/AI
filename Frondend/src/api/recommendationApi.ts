import { IngredientSearchRequest, IngredientSearchResponse } from '../types/recommendations';
import { request } from './client';

export const recommendationApi = {
  suggestIngredients: (query: string) =>
    request<{ suggestions: string[] }>('GET', '/recommendations/ingredients', { query: { query } }),
  byIngredients: (payload: IngredientSearchRequest) =>
    request<IngredientSearchResponse>('POST', '/recommendations/by-ingredients', { body: payload })
};
