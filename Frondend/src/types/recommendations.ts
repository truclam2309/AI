import { NutritionGoal } from './nutrition';

export interface IngredientSearchRequest {
  ingredients: string[];
  limit?: number;
  max_calories?: number;
  min_protein?: number;
  goal?: NutritionGoal;
}

export interface IngredientRecommendation {
  dish_id: string;
  name: string;
  image_url: string | null;
  ingredients: string[];
  matched_ingredients: string[];
  missing_ingredients: string[];
  matched_count: number;
  required_count: number;
  ingredient_match_ratio: number;
  similarity_score: number;
  calories: number | null;
  protein: number | null;
  carb: number | null;
  fat: number | null;
  serving_grams: number | null;
  instructions: string | null;
  food_group: string | null;
  nutrition_label: string | null;
  nutrition_label_note: string | null;
}

export interface IngredientSearchResponse {
  ingredients: string[];
  total: number;
  results: IngredientRecommendation[];
  warnings: string[];
}
