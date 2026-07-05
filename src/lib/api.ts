const base = import.meta.env.VITE_SERVER_URL || "";

export function apiUrl(path: string): string {
  return base + path;
}
