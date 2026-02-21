import { http } from "./http";

export const apiLogin    = (email, password)       => http.post("/auth/login", { email, password }).then(r=>r.data);
export const apiRegister = (email, password, name) => http.post("/auth/register", { email, password, name }).then(r=>r.data);
export const apiMe       = ()                      => http.get("/auth/me").then(r=>r.data);
export const apiLogout   = ()                      => http.post("/auth/logout").then(r=>r.data).catch(()=>({}));
