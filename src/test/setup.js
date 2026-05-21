import "@testing-library/jest-dom";
import { vi } from "vitest";

// jsdom v29 may not auto-initialize localStorage — stub it
const store = Object.create(null);
vi.stubGlobal("localStorage", {
  getItem:    (k)    => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: (k)    => { delete store[k]; },
  clear:      ()     => { for (const k of Object.keys(store)) delete store[k]; },
  get length()       { return Object.keys(store).length; },
  key:        (i)    => Object.keys(store)[i] ?? null,
});
