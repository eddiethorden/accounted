// The floating assistant trigger's visibility decision, as a pure function so
// it can be tested as a table (the repo has no component tests).
//
// What is deliberately NOT an input: the agent profile. Until 2026-09-21 the
// chain ended with `if (!identity.isVerified) return null`, which hid the
// assistant from every company that had not walked through /onboarding/agent.
// The onboarding checklist stopped leading there on 2026-08-27 (#1971, its
// last step became "Anslut till Claude"), so the door stayed hidden for nearly
// nine in ten onboarded companies, payers and trials included. A gate of the
// form "hide the door until setup X" fails silently the day a journey skips X.
// The assistant runs fine without a profile row (every reader is a
// maybeSingle() with a null fallback: no profile summary, no vertical atoms,
// default name and avatar), so the profile is personalization, never a
// precondition for reaching the assistant. Do not add it back here.

export type AgentTriggerMode =
  // Render nothing.
  | 'hidden'
  // Fresh open for a company that holds the ai capability: opens the sheet.
  | 'ask'
  // Fresh open without the capability: the conversion pill, routes to billing
  // and carries its own per-session dismiss.
  | 'upsell'
  // A collapsed (minimized) session: the handle that brings it back.
  | 'resume'

export interface AgentTriggerInput {
  /** user_preferences.hide_assistant_fab (Inställningar > Assistenten). */
  hiddenByPreference: boolean
  /** useCapability(CAPABILITY.ai): the entitlement axis, payer or trial. */
  hasAi: boolean
  /** Non-payer dismissed the upsell pill (or closed the paywalled sheet) this browser session. */
  upsellDismissed: boolean
  /** The sheet has an active session (visible or collapsed). */
  isOpen: boolean
  /** The active session is minimized. */
  collapsed: boolean
  pathname: string | null
}

// /bookkeeping/[id] is the verifikation editor; the list, /new and /year-end
// are not.
function isVerifikationEditor(pathname: string | null): boolean {
  const segs = pathname?.split('/').filter(Boolean) ?? []
  return segs[0] === 'bookkeeping' && !!segs[1] && segs[1] !== 'year-end' && segs[1] !== 'new'
}

export function decideAgentTrigger(input: AgentTriggerInput): AgentTriggerMode {
  const { hiddenByPreference, hasAi, upsellDismissed, isOpen, collapsed, pathname } = input

  // User opt-out: the sidebar entry stays, the floating button goes. A
  // collapsed session keeps its handle even then: it is the only way back to a
  // minimized conversation, and its existence implies the assistant is in use.
  if (hiddenByPreference && !collapsed) return 'hidden'

  // Dismissed upsell: nothing for the rest of the browser session. A collapsed
  // session still shows its handle: its label is a resume action, not the ad.
  if (!hasAi && upsellDismissed && !collapsed) return 'hidden'

  // Sheet open AND visible: hide the trigger so the icon does not double up.
  if (isOpen && !collapsed) return 'hidden'

  // Page suppression, split by WHY the page suppresses. The split is the point:
  // one rule is about redundancy (the page already IS the conversation), the
  // other is about crowding (the page is dense and the pill would sit on top of
  // it). Only the redundancy rule survives into the collapsed state, because
  // only it leaves the user another route back to the conversation.
  //
  // /chat*: suppressed in BOTH states. Fresh open: the surface IS the chat, so
  // a floating "Fråga ..." pill is redundant and overlaps the input. Collapsed:
  // the /chat layout lists every conversation in its sidebar and renders the
  // selected one in the main pane, so navigating here IS the way back; a handle
  // that re-expands the panel on top of it would put two chats on one screen.
  // Safe because the session lives in AgentSheetProvider in the dashboard
  // layout, one level above the page: it stays mounted (messages, streaming,
  // pending approval cards intact) the whole time the user is on /chat, and the
  // handle reappears the moment they navigate anywhere else, bottom nav
  // included.
  if (pathname?.startsWith('/chat')) return 'hidden'

  // /bookkeeping/[id]: FRESH open only. The verifikation editor is a dense
  // regulatory surface (debits/credits, BAS codes, period locks) and a floating
  // pill on top of it adds noise without earning its place. A COLLAPSED session
  // keeps its handle here, and on every other page in the app: this page offers
  // no other route back to a minimized conversation, and stranding a
  // half-finished booking is a worse outcome than a pill over the editor.
  if (!collapsed && isVerifikationEditor(pathname)) return 'hidden'

  if (collapsed) return 'resume'
  return hasAi ? 'ask' : 'upsell'
}
