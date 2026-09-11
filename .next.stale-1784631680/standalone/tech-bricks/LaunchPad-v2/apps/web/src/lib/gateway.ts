import WebSocket from 'ws';
import { v4 as uuid } from 'uuid';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://localhost:19002';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || 'launchpad-local';

interface GatewayFrame {
  type: 'res' | 'event';
  id?: string;
  ok?: boolean;
  event?: string;
  payload?: Record<string, unknown>;
}

/**
 * Send a message to the OpenClaw Gateway via chat.send and yield streaming text chunks.
 * Follows the exact v3 protocol from OpenClaw source:
 *   - ConnectParams: client { id, version, platform, mode } + auth { token }
 *   - chat.send: { sessionKey, message, idempotencyKey }
 *   - ChatEvent: { state: "delta"|"final", message }
 */
export async function* sendToAgent(
  message: string,
  sessionKey: string,
): AsyncGenerator<string> {
  const ws = new WebSocket(GATEWAY_URL);

  try {
    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
      setTimeout(() => reject(new Error('Gateway connection timeout')), 5000);
    });

    // Step 1: Connect handshake (exact v3 protocol schema)
    const connectId = uuid();
    ws.send(JSON.stringify({
      type: 'req',
      id: connectId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'openclaw-tui',          // isOperatorUiClient=true, no browser origin check
          version: '0.1.0',
          platform: 'node',
          mode: 'ui',                 // operator UI mode
        },
        role: 'operator',
        scopes: ['operator.admin', 'operator.read', 'operator.write'],
        caps: ['tool-events'],
        auth: {
          token: GATEWAY_TOKEN,
        },
      },
    }));

    // Wait for connect response
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Gateway auth timeout')), 5000);
      const handler = (data: WebSocket.RawData) => {
        const frame: GatewayFrame = JSON.parse(data.toString());
        if (frame.type === 'res' && frame.id === connectId) {
          ws.off('message', handler);
          clearTimeout(timeout);
          if (frame.ok) {resolve();}
          else {reject(new Error(`Gateway auth failed: ${JSON.stringify(frame.payload)}`));}
        }
      };
      ws.on('message', handler);
    });

    // Step 2: Send chat message (ChatSendParamsSchema)
    const sendId = uuid();
    const idempotencyKey = uuid();
    ws.send(JSON.stringify({
      type: 'req',
      id: sendId,
      method: 'chat.send',
      params: {
        sessionKey,
        message,
        idempotencyKey,
      },
    }));

    // Step 3: Stream ChatEvent responses
    let done = false;
    const chunks: string[] = [];
    let resolveNext: (() => void) | null = null;

    ws.on('message', (data) => {
      const frame: GatewayFrame = JSON.parse(data.toString());

      // Agent text stream: { stream: "assistant", data: { delta: "text" } }
      if (frame.type === 'event' && frame.event === 'agent') {
        const payload = frame.payload || {};
        if (payload.stream === 'assistant') {
          const data = payload.data as Record<string, unknown> | undefined;
          const delta = data?.delta as string | undefined;
          if (delta) {
            chunks.push(delta);
            resolveNext?.();
          }
        }
        // Lifecycle error
        if (payload.stream === 'lifecycle') {
          const data = payload.data as Record<string, unknown> | undefined;
          if (data?.phase === 'error') {
            chunks.push(`[Error: ${data.error || 'agent error'}]`);
            done = true;
            resolveNext?.();
          }
        }
      }

      // Chat event: { state: "final"|"error", message }
      if (frame.type === 'event' && (frame.event === 'chat' || frame.event === 'chat.event')) {
        const payload = frame.payload || {};
        const state = payload.state as string;

        if (state === 'final' || state === 'aborted') {
          done = true;
          resolveNext?.();
        }
        if (state === 'error') {
          chunks.push(`[Error: ${payload.errorMessage || 'chat error'}]`);
          done = true;
          resolveNext?.();
        }
      }

      // Response error for chat.send
      if (frame.type === 'res' && frame.id === sendId && !frame.ok) {
        const errPayload = frame.payload;
        chunks.push(`[Error: ${errPayload?.message || 'chat.send failed'}]`);
        done = true;
        resolveNext?.();
      }
    });

    ws.on('error', () => {
      done = true;
      resolveNext?.();
    });

    ws.on('close', () => {
      done = true;
      resolveNext?.();
    });

    // Yield chunks as they arrive
    while (!done || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else if (!done) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    }
  } finally {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}

/**
 * Check if the Gateway is reachable via HTTP health endpoint.
 */
export async function isGatewayAvailable(): Promise<boolean> {
  try {
    const httpUrl = GATEWAY_URL.replace('ws://', 'http://').replace('wss://', 'https://');
    const res = await fetch(`${httpUrl}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
