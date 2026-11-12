export function fmt(n: number, digits = 0): string {
  return n.toLocaleString('vi-VN', { maximumFractionDigits: digits });
}

export function fmtServings(n: number): string {
  return `${fmt(n, 1)} phần`;
}