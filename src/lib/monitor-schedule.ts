/** Calculate next run timestamp based on schedule */
export function calculateNextRun(schedule: string, from?: Date): string | null {
  if (schedule === 'manual') return null;
  const base = from || new Date();
  const ms: Record<string, number> = {
    hourly: 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };
  const interval = ms[schedule];
  if (!interval) return null;
  return new Date(base.getTime() + interval).toISOString();
}
