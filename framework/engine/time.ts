// Local time with its offset, so a timestamp reads the same as the clock where the run
// happened, and it still says which zone that was.
export function localTimestamp(date: Date = new Date()): string {
  const pad = (value: number, size = 2) =>
    String(Math.abs(value)).padStart(size, "0");
  const offset = -date.getTimezoneOffset();
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${day}T${time}${zone}`;
}
