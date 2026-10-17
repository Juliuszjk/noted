// The default title of Settings > Editor (no dependencies: React Native uses it too).
const pad = (n: number) => String(n).padStart(2, '0');

// "$date$ $time$" -> "2026-10-10 23:40".
export const formatTitleTemplate = (template: string, at: Date): string =>
  template
    .replace(/\$date\$/g, `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`)
    .replace(/\$time\$/g, `${pad(at.getHours())}:${pad(at.getMinutes())}`)
    .trim();
