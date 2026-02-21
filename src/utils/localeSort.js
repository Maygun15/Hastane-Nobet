export const sortStringsTR = (arr) =>
  [...arr].sort((a,b)=> a.localeCompare(b, "tr", { sensitivity:"base" }));

export const sortByKeyTR = (arr, key) =>
  [...arr].sort((a,b)=> (a?.[key]||"").toString()
    .localeCompare((b?.[key]||"").toString(), "tr", { sensitivity:"base" }));
