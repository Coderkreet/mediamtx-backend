// utils/mediamtx.js
const WebSocket = require('ws');

class MediaMTXManager {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.connections = new Map();
  }

  async createStream(studentId, streamType) {
    try {
      const streamPath = `${studentId}_${streamType}`;
      const wsUrl = `${this.serverUrl}/${streamPath}`;
      
      const ws = new WebSocket(wsUrl);
      this.connections.set(`${studentId}_${streamType}`, ws);
      
      return {
        success: true,
        streamPath: streamPath,
        wsUrl: wsUrl
      };
    } catch (error) {
      console.error('Failed to create MediaMTX stream:', error);
      return { success: false, error: error.message };
    }
  }

  async stopStream(studentId, streamType) {
    try {
      const connectionKey = `${studentId}_${streamType}`;
      const ws = this.connections.get(connectionKey);
      
      if (ws) {
        ws.close();
        this.connections.delete(connectionKey);
        return { success: true };
      }
      
      return { success: false, error: 'Stream not found' };
    } catch (error) {
      console.error('Failed to stop MediaMTX stream:', error);
      return { success: false, error: error.message };
    }
  }

  getActiveStreams() {
    return Array.from(this.connections.keys());
  }
}

module.exports = MediaMTXManager;
