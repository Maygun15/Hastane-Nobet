import axios from "axios";
import { getApiBase, assertProdWriteAllowed } from "./apiConfig.js";

export const http = axios.create({
  baseURL: getApiBase(),
  headers: { "Content-Type": "application/json" },
});

http.interceptors.request.use((config) => {
  try {
    const path = config?.url || "";
    const method = (config?.method || "GET").toUpperCase();
    assertProdWriteAllowed(path, method);
  } catch (err) {
    return Promise.reject(err);
  }
  return config;
});
