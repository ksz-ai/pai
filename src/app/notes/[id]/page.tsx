import { NoteReader } from "@/components/notes/NoteReader";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NoteReader noteId={id} />;
}
