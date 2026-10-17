// Date formats shared by the desktop components and the mobile screens (no DOM, no React).

const pad = (n: number) => String(n).padStart(2, '0');

// "10-10-2026 13:10"
export const formatDateTime = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
