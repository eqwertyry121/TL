export function money(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " RSD";
}
