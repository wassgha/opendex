// Read-only configuration handshake. No audio, screenshots, or user text sent.
const { app } = require('electron');
const { join } = require('node:path');
const { homedir } = require('node:os');
require('tsx/cjs');
app.setName('opendex');
app.setPath('userData', join(homedir(), 'Library/Application Support/opendex'));
app.whenReady().then(async () => {
  let ws;
  const finish = code => { try { ws?.close(); } catch {} app.exit(code); };
  setTimeout(() => { console.error('Configuration probe timed out.'); finish(1); }, 20000);
  try {
    const { initConfig, getConfig } = require('../src/main/config/store.ts');
    const { confirmedTurnOptions } = require('../src/main/agent/realtime/confirmed-turn-config.ts');
    const { gateway } = require('@ai-sdk/gateway');
    initConfig();
    const cfg = getConfig();
    const model = gateway.experimental_realtime(cfg.realtime.model);
    const token = await gateway.experimental_realtime.getToken({ model: cfg.realtime.model });
    const connection = model.getWebSocketConfig(token);
    ws = new WebSocket(connection.url, connection.protocols);
    ws.addEventListener('open', async () => ws.send(JSON.stringify(await model.serializeClientEvent({ type: 'session-update', config: {
      inputAudioFormat: { type: 'audio/pcm', rate: 24000 }, outputAudioFormat: { type: 'audio/pcm', rate: 24000 },
      turnDetection: { type: 'semantic-vad' }, providerOptions: confirmedTurnOptions(cfg.realtime.voice),
    } }))));
    ws.addEventListener('message', event => {
      const raw = JSON.parse(String(event.data));
      const health = model.getHealthCheckResponse?.(raw);
      if (health) { ws.send(JSON.stringify(health)); return; }
      const parsed = model.parseServerEvent(raw);
      for (const e of Array.isArray(parsed) ? parsed : [parsed]) {
        if (e.type === 'error') { console.error('Provider rejected the configuration.', { code: e.code }); finish(1); }
        if (e.type === 'session-updated') {
          const session = e.raw?.session ?? raw.session ?? raw.raw?.session;
          const td = session?.audio?.input?.turn_detection ?? session?.turn_detection;
          console.log('Provider turn detection:', td ?? 'No acknowledged settings returned');
          finish(td?.create_response === false && td?.interrupt_response === false ? 0 : 1);
        }
      }
    });
  } catch { console.error('Configuration probe failed. No credentials logged.'); finish(1); }
});
