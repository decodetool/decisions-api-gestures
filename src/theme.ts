import { DEFAULT_THEME } from "tldraw";

export const CANVAS_THEMES = {
  default: {
    ...DEFAULT_THEME,
    colors: {
      light: {
        ...DEFAULT_THEME.colors.light,
        yellow: { ...DEFAULT_THEME.colors.light.yellow, solid: "#facc15", fill: "#facc15" },
        blue: { ...DEFAULT_THEME.colors.light.blue, solid: "#1e40af", fill: "#1e40af", semi: "#1e40af" },
        "light-blue": { ...DEFAULT_THEME.colors.light["light-blue"], solid: "#93c5fd", fill: "#bfdbfe", semi: "#bfdbfe", linedFill: "#bfdbfe" },
      },
      dark: {
        ...DEFAULT_THEME.colors.dark,
        yellow: { ...DEFAULT_THEME.colors.dark.yellow, solid: "#facc15", fill: "#facc15" },
        blue: { ...DEFAULT_THEME.colors.dark.blue, solid: "#1e40af", fill: "#1e40af", semi: "#1e40af" },
        "light-blue": { ...DEFAULT_THEME.colors.dark["light-blue"], solid: "#93c5fd", fill: "#bfdbfe", semi: "#bfdbfe", linedFill: "#bfdbfe" },
      },
    },
  },
};
