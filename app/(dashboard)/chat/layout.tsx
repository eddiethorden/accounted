import { redirect } from 'next/navigation'
import ChatSidebar from '@/components/agent/ChatSidebar'
import { getDashboardAuthContext, getDashboardCompanyId } from '../request-context'

export const dynamic = 'force-dynamic'

// Two-pane chat layout: sidebar with conversations on the left, active
// conversation (or empty state) in the main panel. Both /chat and /chat/[id]
// share this layout so the sidebar doesn't unmount on conversation switches.
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const [{ supabase, user }, companyId] = await Promise.all([
    getDashboardAuthContext(),
    getDashboardCompanyId(),
  ])
  if (!user) redirect('/login')
  if (!companyId) redirect('/onboarding')

  // No agent-profile gate here. This layout used to bounce every company
  // without a verified agent_profiles row to /, on the theory that Hem would
  // walk them through the build flow; the checklist stopped doing that
  // (#1971) and the bounce became a silent dead end for most companies. The
  // chat runs without a profile (default name and avatar, no profile summary,
  // no vertical atoms), and ChatEmptyState already handles the sandbox and
  // non-payer states on its own.

  const { data: conversations } = await supabase
    .from('agent_conversations')
    .select(
      'id, intent_id, context_ref, title, pinned, archived, last_message_at, last_message_preview, created_at',
    )
    .eq('company_id', companyId)
    .eq('archived', false)
    .order('pinned', { ascending: false })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)

  return (
    // MainContainer hands /chat a full-bleed h-full wrapper, so we don't
    // need negative margins to break out of any chrome padding.
    //
    // dvh handles mobile browser chrome shrinking on scroll. Mobile: subtract
    // the bottom nav (--bottom-nav-h, globals.css) so the chat pane fills the
    // visible viewport exactly. Desktop: fill the frame panel (<main> has an
    // explicit height there, so h-full resolves).
    <div className="flex h-[calc(100dvh-var(--bottom-nav-h))] md:h-full">
      <ChatSidebar initialConversations={conversations ?? []} />
      <div className="flex-1 min-w-0 flex flex-col bg-background">{children}</div>
    </div>
  )
}
