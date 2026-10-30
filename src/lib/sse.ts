import type { SSEEvent } from "@/lib/types";

/** 把 AsyncGenerator<SSEEvent> 包装为 text/event-stream 响应 */
export function sseResponse(gen: AsyncGenerator<SSEEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of gen) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", code: "internal", message })}\n\n`),
          );
        } catch {
          /* 客户端已断开 */
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
