/**
 * "Gör till rutin": a flow or an analysis run on a schedule by the user's own
 * Claude. Claude Desktop schedules recurring Cowork tasks that run in the
 * cloud with the user's connectors (support.claude.com, "Schedule recurring
 * tasks in Claude Cowork"), and opens a Cowork task with text filled in from
 * claude://cowork/new?q= ("Open Claude Desktop with a link"). Accounted only
 * writes the request; Claude asks the user to confirm the schedule.
 */
export type RoutineCadence = 'daily' | 'weekdays' | 'weekly'
export const ROUTINE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type RoutineDay = (typeof ROUTINE_DAYS)[number]

/** Cowork's composer takes about 14 000 characters; a request is far shorter, but never send more. */
const MAX_PROMPT = 14000

export interface RoutineCopy {
  /** "varje dag kl {time}" etc., already filled in by the caller's translations. */
  when: string
  /** The page's own start prompt: what one run does. */
  run: string
  /** The whole request, with {when} and {run} filled in. */
  wrap: (when: string, run: string) => string
}

export function routinePrompt(copy: RoutineCopy): string {
  return copy.wrap(copy.when, copy.run).slice(0, MAX_PROMPT)
}

/** The link that opens Claude Desktop in a new Cowork task with the request filled in. */
export function coworkLink(prompt: string): string {
  return `claude://cowork/new?q=${encodeURIComponent(prompt)}`
}

/** A time the time input can hold: HH:MM, else the default. */
export function routineTime(value: string, fallback = '07:00'): string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback
}
