import { z } from "zod";

export const AssignmentRowSchema = z.object({
  personId: z.string().min(1, "personId zorunlu"),
  fullName: z.string().min(2, "ad-soyad eksik"),
  service: z.string().min(1, "servis zorunlu"),
  shiftCode: z.string().min(1, "vardiya kodu zorunlu"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "tarih biçimi YYYY-MM-DD olmalı"),
});

export const AssignmentSheetSchema = z.array(AssignmentRowSchema);
