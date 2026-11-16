export type SexForCalculation = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type NutritionGoal = 'lose_weight' | 'gain_weight' | 'gain_muscle' | 'maintain_weight';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type NutritionHistoryItem = NutritionCalculation & { id: number };

export interface UserProfile {
  full_name?: string | null;
  date_of_birth: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  sex_for_calculation: SexForCalculation | null;
  activity_level: ActivityLevel | null;
  goal: NutritionGoal | null;
  target_weight_kg: number | null;
  allergies: string[];
  avoid_ingredients: string[];
  disliked_dishes: string[];
  favorite_dishes: string[];
  updated_at?: string | null;
}

export type ProfileUpdate = Partial<UserProfile>;

export interface NutritionCalculation {
  height_cm: number;
  weight_kg: number;
  age_years: number;
  bmi: number;
  bmi_comment: string;
  bmr_kcal: number;
  tdee_kcal: number;
  target_calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  macro_energy_kcal: number;
  sex_for_calculation: SexForCalculation;
  activity_level: ActivityLevel;
  goal: NutritionGoal;
  medical_review_required: boolean;
  formula: {
    bmi: string;
    bmr: string;
    sex_constant: number;
    activity_factor: number;
    tdee: string;
    goal_adjustment_fraction: number;
    target: string;
    protein: string;
    protein_factor_g_per_kg: number;
    fat: string;
    fat_energy_fraction: number;
    carb: string;
    macro_calories: string;
    calorie_safety_bounds: { minimum: number; maximum: number };
  };
  warnings: string[];
  calculated_at: string;
}

export interface MealPlanDish {
  dish_id: string;
  name: string;
  food_group: string | null;
  ingredients: string | null;
  instructions: string | null;
  image_url: string | null;
  meal_type: MealType;
  serving_grams: number;
  calories: number;
  protein: number;
  carb: number;
  fat: number;
  position: number;
  id?: number;
  is_cooked?: boolean;
  reason: string;
}

export interface DailyMealPlan {
  id: number;
  plan_date: string;
  version: number;
  bmi: number;
  bmr_kcal: number;
  tdee_kcal: number;
  target_calories: number;
  total_calories: number;
  goal: NutritionGoal;
  algorithm_version: string;
  warnings: string[];
  created_at: string;
  meals: MealPlanDish[];
  nutrition_totals: { protein: number; carb: number; fat: number };
}

export interface GeneratePlanResponse {
  data: DailyMealPlan;
  created?: boolean;
}
