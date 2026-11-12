import { addDays, format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
export function todayISO(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values: Record<string, string> = {};
  parts.forEach(({ type, value }) => { values[type] = value; });
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftDate(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), 'yyyy-MM-dd');
}

export function formatLongDate(iso: string): string {
  return format(parseISO(iso), "EEEE, d 'tháng' M", { locale: vi });
}

