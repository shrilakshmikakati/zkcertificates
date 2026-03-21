export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}
