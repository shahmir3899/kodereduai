// Server-sent events parser. A network chunk can end in the middle of an event, so the
// unfinished tail is kept until the next chunk arrives.

export type AssistantEvent = { type: string; [key: string]: any };

export function createSseParser(onEvent: (event: AssistantEvent) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, '\n');
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        onEvent(JSON.parse(data));
      } catch {
        // A half-written or non-JSON event is skipped so one bad event cannot kill the stream.
      }
    }
  };
}
