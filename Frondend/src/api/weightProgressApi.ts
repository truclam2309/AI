import { WeightLog } from '../types/nutrition';
import { request } from './client';

export const weightProgressApi = {
  list: async () => (await request<{data: WeightLog[]}>('GET', '/weight-progress')).data,
  save: async (payload: {measured_on: string; weight_kg: number; note?: string}) =>
    (await request<{data: WeightLog}>('POST', '/weight-progress', {body: payload})).data,
};
