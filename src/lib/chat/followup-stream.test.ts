import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('@/components/credits/recharge-events', () => ({ requestRecharge: vi.fn(), RECHARGED_EVENT: 'recharged' }));
vi.mock('@/hooks/usePersistedArtifact', () => ({ broadcastPersistedArtifacts: vi.fn() }));
import { useChat } from '@/hooks/useChat';

describe('follow-ups arriving during an active chat stream', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('sends only a bounded fallback history as the client conversation grows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"content":"Answer"}\n\ndata: {"done":true,"final":true}\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    const chat = useChat(`bounded-${crypto.randomUUID()}`);
    chat.setMessages(Array.from({ length: 640 }, (_, i) => ({ id: `old-${i}`, role: i % 2 ? 'assistant' as const : 'user' as const, content: `Old ${i}`, timestamp: new Date().toISOString() })));
    await chat.sendMessage('Current question');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(3);
    expect(body.messages.at(-1).content).toBe('Current question');
    expect(useChat(`not-the-same-store`).messages).toHaveLength(0);
    vi.unstubAllGlobals();
  });
  it('continues updating the original response after another message arrives', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const project = `stream-test-${crypto.randomUUID()}`;
    const chat = useChat(project);
    const pending = chat.sendMessage('What next?');
    const emit = (content: string) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n\n`));
    emit('First');
    await new Promise((resolve) => setTimeout(resolve, 0));
    chat.appendFollowups([{ id: 'handoff', role: 'assistant', content: 'Run sizing', timestamp: new Date(Date.now() + 10).toISOString() }]);
    emit(' second');
    controller.close();
    await pending;
    const messages = useChat(project).messages;
    expect(messages.find((m) => m.id === 'handoff')?.content).toBe('Run sizing');
    expect(messages.filter((m) => m.role === 'assistant' && m.id !== 'handoff').map((m) => m.content)).toEqual(['First second']);
    vi.unstubAllGlobals();
  });
});
