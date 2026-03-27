export interface CategoryOption {
  name: string;
  icon: string;
}

export const DEFAULT_CATEGORY_NAMES = [
  "Food",
  "Groceries",
  "Travel",
  "Transport",
  "Health",
  "Entertainment",
  "Shopping",
  "Bills",
  "Education",
  "Other",
] as const;

const DEFAULT_CATEGORY_ICONS: Record<(typeof DEFAULT_CATEGORY_NAMES)[number], string> = {
  Food: "🍔",
  Groceries: "🛒",
  Travel: "✈️",
  Transport: "🚌",
  Health: "💊",
  Entertainment: "🎬",
  Shopping: "🛍️",
  Bills: "💡",
  Education: "📚",
  Other: "📦",
};

export const DEFAULT_CATEGORIES: CategoryOption[] = DEFAULT_CATEGORY_NAMES.map((name) => ({
  name,
  icon: DEFAULT_CATEGORY_ICONS[name],
}));
