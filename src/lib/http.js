import axios from "axios";

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE, // .env: VITE_API_BASE=http://localhost:3000/api
  headers: { "Content-Type": "application/json" },
});
