import { MealType } from '../types/nutrition';

const GUEST_SELECTION_KEY = 'nutriai.guest-selected-dish';

export interface GuestDishSelection {
  dish_id: string;
  meal_type: MealType;
  plan_date?: string;
  dish?: {
    name: string;
    food_group?: string | null;
    ingredients?: string[] | null;
    instructions?: string | null;
    image_url?: string | null;
    serving_grams?: number | null;
    calories?: number | null;
    protein?: number | null;
    carb?: number | null;
    fat?: number | null;
  };
}

export function setGuestDishSelection(selection: GuestDishSelection) {
  try { sessionStorage.setItem(GUEST_SELECTION_KEY, JSON.stringify(selection)); } catch { /* Selection remains optional if session storage is unavailable. */ }
}

export function getGuestDishSelection(): GuestDishSelection | null {
  try { return JSON.parse(sessionStorage.getItem(GUEST_SELECTION_KEY) ?? 'null') as GuestDishSelection | null; }
  catch { return null; }
}

export function clearGuestDishSelection() {
  sessionStorage.removeItem(GUEST_SELECTION_KEY);
}
