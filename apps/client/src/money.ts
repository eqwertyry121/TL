export function money(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " RSD";
}

export function maskPhone(value?: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5) return value;
  return `${value.slice(0, 4)} *** ${digits.slice(-3)}`;
}
