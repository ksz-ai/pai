import { ChatView } from "@/components/chat/ChatView";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ slot?: string; ask?: string }>;
}) {
  const { id } = await params;
  const { slot, ask } = await searchParams;
  return <ChatView convId={id} focusSlot={slot ? Number(slot) : null} initialInput={ask} />;
}
