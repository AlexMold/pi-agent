import { z } from "zod";

export const ManageCalendarSchema = z.object({
  summary: z.string().min(1, "Title (summary) is required"),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  description: z.string().optional(),
  location: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
});

export const ListEventsSchema = z.object({
  timeMin: z.string().datetime({ offset: true }).optional(),
  timeMax: z.string().datetime({ offset: true }).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
});

export const UpdateEventSchema = z.object({
  eventId: z.string().min(1, "Event ID is required"),
  summary: z.string().optional(),
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
});

export const DeleteEventSchema = z.object({
  eventId: z.string().min(1, "Event ID is required"),
});

export function formatZodError(err) {
  return err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
}
