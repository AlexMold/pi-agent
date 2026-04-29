/**
 * Calendar Tool Extension for Pi-Agent.
 *
 * Registers calendar management tools so the agent can:
 *   - manage_calendar  → create events (with recurrence support)
 *   - list_events      → read upcoming events (collision detection)
 *   - update_event     → patch any field on an existing event
 *   - delete_event     → remove an event
 */

import { manageCalendarTool } from "./commands/manage.js";
import { listEventsTool } from "./commands/list.js";
import { updateEventTool } from "./commands/update.js";
import { deleteEventTool } from "./commands/delete.js";

export default function (pi) {
  pi.registerTool(manageCalendarTool);
  pi.registerTool(listEventsTool);
  pi.registerTool(updateEventTool);
  pi.registerTool(deleteEventTool);
}
