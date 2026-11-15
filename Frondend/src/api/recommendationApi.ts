import { CatalogDishResponse, IngredientSearchRequest, IngredientSearchResponse } from '../types/recommendations';
import { request } from './client';

export const recommendationApi = {
  dishes: (query = '', goal = '', limit = 100, offset = 0) =>
    request<CatalogDishResponse>('GET', '/recommendations/dishes', {
      query: { query, goal, limit, offset }
    }),
  suggestIngredients: (query: string) =>
    request<{ suggestions: string[] }>('GET', '/recommendations/ingredients', { query: { query } }),
  byIngredients: (payload: IngredientSearchRequest) =>
    request<IngredientSearchResponse>('POST', '/recommendations/by-ingredients', { body: payload })
};
