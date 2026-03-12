import React, { createContext, useContext } from "react";

const AppDataContext = createContext({});

export function AppDataProvider({ value, children }) {
  return <AppDataContext.Provider value={value || {}}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  return useContext(AppDataContext) || {};
}

