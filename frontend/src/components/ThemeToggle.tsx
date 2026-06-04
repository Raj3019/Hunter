import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      title="Toggle theme"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-panel)] text-[var(--text-primary)] hover:border-[var(--accent-primary)]"
    >
      <Icon size={16} />
    </button>
  );
}
