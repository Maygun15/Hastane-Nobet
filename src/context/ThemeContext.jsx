import React, { createContext, useContext, useState, useCallback } from "react";
import { getModuleTheme, DEFAULT_THEME } from "../styles/theme.js";

const ThemeContext = createContext(DEFAULT_THEME);
const SetThemeContext = createContext(null);

/**
 * ThemeProvider — uygulamayı veya modül kökünü sarar.
 *
 * @param {{ moduleId?: string, children: React.ReactNode }} props
 *
 * Kullanım:
 *   <ThemeProvider moduleId="hastane">...</ThemeProvider>
 *   <ThemeProvider moduleId="finans">...</ThemeProvider>
 */
export function ThemeProvider({ moduleId = "hastane", children }) {
  const [currentId, setCurrentId] = useState(moduleId);
  const theme = getModuleTheme(currentId);

  const switchModule = useCallback((id) => setCurrentId(id), []);

  return (
    <SetThemeContext.Provider value={switchModule}>
      <ThemeContext.Provider value={theme}>
        {children}
      </ThemeContext.Provider>
    </SetThemeContext.Provider>
  );
}

/** Aktif modülün tema nesnesini döner. */
export function useModuleTheme() {
  return useContext(ThemeContext);
}

/**
 * Modül geçiş fonksiyonunu döner.
 * switchModule('finans') → temayı anında değiştirir.
 */
export function useSwitchModule() {
  const fn = useContext(SetThemeContext);
  if (!fn) throw new Error("useSwitchModule must be inside <ThemeProvider>");
  return fn;
}

/**
 * Tema buton sınıfını kolayca almak için yardımcı hook.
 *
 * @param {'primary'|'secondary'|'danger'|'reset'} variant
 * @returns {string} Tailwind class string
 */
export function useButtonClass(variant = "secondary") {
  const theme = useModuleTheme();
  return theme.button[variant] ?? theme.button.secondary;
}
