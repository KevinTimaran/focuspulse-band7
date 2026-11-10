import { encodePeerPacket, decodeMessage } from '../shared/transport';
import { createCloudBridge } from './cloud';
let bridge = null, pollTimer = null, listener = null, configListener = null;
AppSideService({
  onInit() {
    bridge = createCloudBridge({
      request: (options) => fetch(options),
      storage: settings.settingsStorage,
      send: (message) => {
        try { messaging.peerSocket.send(encodePeerPacket(message)); return true; }
        catch (_error) { return false; }
      },
    });
    listener = (payload) => { try { bridge.receive(decodeMessage(payload)); } catch (_error) {} };
    messaging.peerSocket.addListener('message', listener);
    configListener = () => bridge.reset();
    settings.settingsStorage.addListener('change', configListener);
    pollTimer = setInterval(() => bridge.poll(), 10000);
    bridge.poll();
  },
  onRun() { if (bridge) bridge.poll(); },
  onDestroy() {
    if (pollTimer) clearInterval(pollTimer);
    if (listener && typeof messaging.peerSocket.removeListener === 'function') messaging.peerSocket.removeListener('message', listener);
    if (configListener && typeof settings.settingsStorage.removeListener === 'function') settings.settingsStorage.removeListener('change', configListener);
    if (bridge) bridge.destroy();
    bridge=null; listener=null; configListener=null; pollTimer=null;
  },
});
