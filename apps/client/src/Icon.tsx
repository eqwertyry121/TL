type IconName =
  | "alert"
  | "arrow-left"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "location"
  | "minus"
  | "more"
  | "phone"
  | "plus"
  | "receipt"
  | "cart"
  | "trash";

type Props = {
  name: IconName;
  size?: number;
  className?: string;
};

const paths: Record<IconName, string[]> = {
  alert: ["M12 8v4", "M12 16h.01", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  "arrow-left": ["m15 18-6-6 6-6", "M9 12h12"],
  check: ["m5 12 4 4L19 6"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  location: ["M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z", "M12 10h.01"],
  minus: ["M5 12h14"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  phone: ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9a16 16 0 0 0 7 7l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"],
  plus: ["M12 5v14", "M5 12h14"],
  receipt: ["M6 2h12v20l-3-2-3 2-3-2-3 2V2Z", "M9 7h6", "M9 11h6"],
  cart: ["M3 3h2l2.4 11.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6", "M10 21h.01", "M18 21h.01"],
  trash: ["M3 6h18", "M8 6V4h8v2", "m19 6-1 14H6L5 6", "M10 11v5", "M14 11v5"],
};

export function Icon({ name, size = 24, className }: Props) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
