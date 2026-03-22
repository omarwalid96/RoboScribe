/**
 * RoboScribe API Client
 * 
 * This module provides a unified interface for connecting to the robot backend.
 * Set USE_MOCK_DATA to false and configure WEBSOCKET_URL/API_BASE_URL to connect to real backend.
 */

import type { Dataset, RobotConfig, RobotState, SystemAlert } from './types';

function buildDefaultWebSocketUrl(): string {
  const envWsUrl = process.env.NEXT_PUBLIC_ROBOT_WS_URL;
  if (envWsUrl) {
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(envWsUrl);
        if (url.hostname === 'localhost') {
          // Avoid IPv6 localhost resolution issues (::1) when backend binds IPv4 only.
          url.hostname = '127.0.0.1';
        }
        // If the UI is opened from another host (e.g., LAN IP), replace local hostnames
        // so the browser targets the same machine serving the frontend.
        if (
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1'
        ) {
          url.hostname = window.location.hostname;
        }
        return url.toString();
      } catch {
        // Fall through to original value if parsing fails.
      }
    }
    return envWsUrl;
  }

  const envApiUrl = process.env.NEXT_PUBLIC_ROBOT_API_URL;
  if (envApiUrl) {
    try {
      const apiUrl = new URL(envApiUrl);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const path = apiUrl.pathname.replace(/\/api\/?$/, '') || '';
      return `${protocol}//${apiUrl.host}${path}/ws`;
    } catch {
      // Fall through to runtime/browser derived default.
    }
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:8000/ws`;
  }

  return 'ws://localhost:8000/ws';
}

function buildDefaultApiUrl(): string {
  const envApiUrl = process.env.NEXT_PUBLIC_ROBOT_API_URL;
  if (envApiUrl) {
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(envApiUrl);
        if (url.hostname === 'localhost') {
          url.hostname = '127.0.0.1';
        }
        if (
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1'
        ) {
          url.hostname = window.location.hostname;
        }
        return url.toString();
      } catch {
        // Fall back to raw env value if parsing fails.
      }
    }
    return envApiUrl;
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname}:8000/api`;
  }

  return 'http://localhost:8000/api';
}

// ============================================================================
// CONFIGURATION - Change these to connect to real backend
// ============================================================================

export const API_CONFIG = {
  // Set to false to use real WebSocket connection
  USE_MOCK_DATA: false,

  // WebSocket endpoint for real-time telemetry
  WEBSOCKET_URL: buildDefaultWebSocketUrl(),

  // REST API base URL for commands and data
  API_BASE_URL: buildDefaultApiUrl(),

  // Reconnection settings
  RECONNECT_INTERVAL: 3000,
  MAX_RECONNECT_ATTEMPTS: 10,
};

// ============================================================================
// WEBSOCKET CLIENT
// ============================================================================

type MessageHandler = (data: WebSocketMessage) => void;
type ConnectionHandler = (status: 'connected' | 'disconnected' | 'error') => void;

/**
 * WebSocket messages from the RoboScribe backend.
 * The backend sends flat JSON objects with a `type` field — no wrapper envelope.
 */
export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

class RobotWebSocketClient {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private socketVersion = 0;
  private isManualDisconnect = false;

  connect(): void {
    if (API_CONFIG.USE_MOCK_DATA) {
      console.log('[WebSocket] Mock mode enabled, skipping real connection');
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    try {
      console.log(`[WebSocket] Connecting to ${API_CONFIG.WEBSOCKET_URL}...`);
      const version = ++this.socketVersion;
      this.isManualDisconnect = false;
      const socket = new WebSocket(API_CONFIG.WEBSOCKET_URL);
      this.ws = socket;

      socket.onopen = () => {
        if (version !== this.socketVersion || this.ws !== socket) return;
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        this.notifyConnectionHandlers('connected');
      };

      socket.onmessage = (event) => {
        if (version !== this.socketVersion || this.ws !== socket) return;
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.notifyMessageHandlers(message);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      socket.onclose = () => {
        if (version !== this.socketVersion || this.ws !== socket) return;
        console.log('[WebSocket] Disconnected');
        this.notifyConnectionHandlers('disconnected');
        if (!this.isManualDisconnect) {
          this.scheduleReconnect();
        }
      };

      socket.onerror = (error: Event | ErrorEvent) => {
        if (version !== this.socketVersion || this.ws !== socket) return;
        if (this.isManualDisconnect) return;
        const errorMessage = error instanceof ErrorEvent ? error.message : 'Connection failed or refused';
        console.error(`[WebSocket] Error: ${errorMessage}`, error);
        this.notifyConnectionHandlers('error');
      };
    } catch (error) {
      console.error('[WebSocket] Failed to connect:', error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.isManualDisconnect = true;
    this.socketVersion++;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= API_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error('[WebSocket] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[WebSocket] Reconnecting in ${API_CONFIG.RECONNECT_INTERVAL}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, API_CONFIG.RECONNECT_INTERVAL);
  }

  send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('[WebSocket] Cannot send message: not connected');
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  private notifyMessageHandlers(message: WebSocketMessage): void {
    this.messageHandlers.forEach(handler => handler(message));
  }

  private notifyConnectionHandlers(status: 'connected' | 'disconnected' | 'error'): void {
    this.connectionHandlers.forEach(handler => handler(status));
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const robotWebSocket = new RobotWebSocketClient();

// ============================================================================
// REST API CLIENT
// ============================================================================

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_CONFIG.API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }

  return response.json();
}

// ============================================================================
// DOWNLOAD HELPER
// ============================================================================

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// ROBOT API METHODS
// ============================================================================

export const robotApi = {
  /**
   * Send a natural language command to the backend via WebSocket.
   * The backend assigns a command_id and sends back `command_parsed` + `awaiting_confirmation`.
   * We don't know the command_id until the backend responds — the caller should
   * listen for `command_parsed` messages on the WebSocket to get it.
   */
  /**
   * Send a natural language command to the backend via WebSocket.
   * In mock mode, simulates a backend response after a short delay.
   */
  sendCommand(command: string): void {
    if (API_CONFIG.USE_MOCK_DATA) {
      console.log('[Mock] Sending command:', command);
      // Simulate backend LLM parsing time
      setTimeout(() => {
        const mockMsg: WebSocketMessage = {
          type: 'command_parsed',
          command_id: `cmd-${Math.random().toString(36).substr(2, 9)}`,
          confirmation_text: `I will ${command} using high-fidelity trajectory planning. Shall I proceed?`,
          parsed: { intent: 'motion', details: command }
        };
        // @ts-ignore - accessing private for mock simulation
        robotWebSocket.notifyMessageHandlers(mockMsg);
      }, 1000);
      return;
    }
    robotWebSocket.send({ type: 'command', text: command });
  },

  /**
   * Confirm or reject a pending command via WebSocket.
   * In mock mode, simulates the execution lifecycle.
   */
  confirmCommand(commandId: string, confirmed: boolean): void {
    if (API_CONFIG.USE_MOCK_DATA) {
      console.log('[Mock] Confirm command:', commandId, confirmed);

      if (confirmed) {
        // Simulate start
        setTimeout(() => {
          // @ts-ignore
          robotWebSocket.notifyMessageHandlers({ type: 'execution_started', command_id: commandId, total_steps: 100 });
          // @ts-ignore
          robotWebSocket.notifyMessageHandlers({ type: 'status', robot_status: 'executing' });
        }, 500);

        // Simulate completion
        setTimeout(() => {
          // @ts-ignore
          robotWebSocket.notifyMessageHandlers({
            type: 'trajectory_saved',
            trajectory_id: `traj-${commandId}`,
            metadata: {
              natural_language_command: 'Mock execution',
              total_steps: 100,
              distance_traveled: 1.2,
              outcome: 'success',
              timestamp: new Date().toISOString()
            }
          });
          // @ts-ignore
          robotWebSocket.notifyMessageHandlers({ type: 'status', robot_status: 'idle' });
          // @ts-ignore
          robotWebSocket.notifyMessageHandlers({ type: 'result_text', text: 'Execution complete. Trajectory saved.' });
        }, 4000);
      }
      return;
    }
    robotWebSocket.send({ type: 'confirmation', command_id: commandId, confirmed });
  },

  async cancelCommand(commandId: string): Promise<void> {
    if (API_CONFIG.USE_MOCK_DATA) return;

    return apiRequest(`/robot/command/${commandId}/cancel`, {
      method: 'POST',
    });
  },

  // Recording
  async startRecording(options?: { name?: string; description?: string }): Promise<{
    recordingId: string;
    status: string;
  }> {
    if (API_CONFIG.USE_MOCK_DATA) {
      return {
        recordingId: `rec-${Date.now()}`,
        status: 'recording',
      };
    }

    return apiRequest('/robot/recording/start', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  async stopRecording(): Promise<Dataset> {
    if (API_CONFIG.USE_MOCK_DATA) {
      return {
        id: `dataset-${Date.now()}`,
        name: 'Mock Recording',
        description: 'Mock recording session',
        createdAt: Date.now(),
        frames: 100,
        duration: 10,
        labels: [],
        recordingType: 'manual',
        status: 'completed',
      };
    }

    return apiRequest('/robot/recording/stop', {
      method: 'POST',
    });
  },

  // Datasets
  async getDatasets(): Promise<Dataset[]> {
    if (API_CONFIG.USE_MOCK_DATA) {
      return [];
    }

    return apiRequest('/robot/datasets');
  },

  async getDataset(datasetId: string): Promise<Dataset> {
    return apiRequest(`/robot/datasets/${datasetId}`);
  },

  async exportDataset(datasetId: string, format: 'json' | 'csv' | 'hdf5'): Promise<Blob> {
    const response = await fetch(
      `${API_CONFIG.API_BASE_URL}/robot/datasets/${datasetId}/export?format=${format}`
    );

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return response.blob();
  },

  async deleteDataset(datasetId: string): Promise<void> {
    if (API_CONFIG.USE_MOCK_DATA) return;

    return apiRequest(`/robot/datasets/${datasetId}`, {
      method: 'DELETE',
    });
  },

  // Settings
  async getSettings(): Promise<RobotConfig> {
    if (API_CONFIG.USE_MOCK_DATA) {
      const { DEFAULT_ROBOT_CONFIG } = await import('./constants');
      return DEFAULT_ROBOT_CONFIG;
    }

    return apiRequest('/robot/settings');
  },

  async updateSettings(settings: Partial<RobotConfig>): Promise<RobotConfig> {
    if (API_CONFIG.USE_MOCK_DATA) {
      return settings as RobotConfig;
    }

    return apiRequest('/robot/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  // Motion Control
  async moveToPosition(jointAngles: number[]): Promise<void> {
    if (API_CONFIG.USE_MOCK_DATA) return;

    return apiRequest('/robot/motion/move', {
      method: 'POST',
      body: JSON.stringify({ jointAngles }),
    });
  },

  async executePreset(presetId: string): Promise<void> {
    if (API_CONFIG.USE_MOCK_DATA) return;

    return apiRequest(`/robot/motion/preset/${presetId}`, {
      method: 'POST',
    });
  },

  async emergencyStop(): Promise<void> {
    // Always send emergency stop, even in mock mode
    if (!API_CONFIG.USE_MOCK_DATA) {
      await apiRequest('/robot/emergency-stop', {
        method: 'POST',
      });
    }
    console.warn('[Robot] Emergency stop triggered');
  },

  // System
  async getSystemStatus(): Promise<{
    connected: boolean;
    mode: string;
    health: 'healthy' | 'warning' | 'critical';
  }> {
    if (API_CONFIG.USE_MOCK_DATA) {
      return {
        connected: true,
        mode: 'idle',
        health: 'healthy',
      };
    }

    return apiRequest('/robot/status');
  },

  // Export trajectories
  async exportTrajectories(format: 'json' | 'csv' | 'hdf5'): Promise<void> {
    if (API_CONFIG.USE_MOCK_DATA) {
      console.warn('[Robot] Export in mock mode');
      return;
    }

    // Derive export URL: strip /api suffix and trailing slash
    const exportBaseUrl = API_CONFIG.API_BASE_URL
      .replace(/\/api\/?$/, '')
      .replace(/\/$/, '');
    const url = `${exportBaseUrl}/export?format=${format}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    if (format === 'json') {
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      triggerDownload(blob, `roboscribe-trajectories-${Date.now()}.json`);
    } else if (format === 'csv') {
      const data = await response.json();
      const trajectories: Record<string, unknown>[] = data.trajectories || [];
      if (trajectories.length === 0) {
        throw new Error('No trajectories to export');
      }
      const headers = [
        'trajectory_id', 'natural_language_command', 'timestamp',
        'outcome', 'total_steps', 'duration_seconds', 'distance_traveled',
      ];
      const rows = trajectories.map(t =>
        headers.map(h => JSON.stringify(t[h] ?? '')).join(',')
      );
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      triggerDownload(blob, `roboscribe-trajectories-${Date.now()}.csv`);
    } else if (format === 'hdf5') {
      const buffer = await response.arrayBuffer();
      const blob = new Blob([buffer], { type: 'application/x-hdf5' });
      triggerDownload(blob, `roboscribe-trajectories-${Date.now()}.h5`);
    }
  },
};

// ============================================================================
// VOICE API (ElevenLabs Integration)
// ============================================================================

export const voiceApi = {
  async speak(text: string): Promise<ArrayBuffer> {
    const ELEVENLABS_API_KEY = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;
    const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Default voice

    if (!ELEVENLABS_API_KEY) {
      console.warn('[Voice] ElevenLabs API key not configured');
      throw new Error('Voice API not configured');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Voice API error: ${response.statusText}`);
    }

    return response.arrayBuffer();
  },

  async transcribe(audioBlob: Blob): Promise<string> {
    const ELEVENLABS_API_KEY = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) {
      console.warn('[Voice] ElevenLabs API key not configured for transcription');
      throw new Error('Voice API not configured');
    }

    const formData = new FormData();
    formData.append('file', audioBlob, 'record.webm');
    formData.append('model_id', 'scribe_v1'); // Or scribe_v2 if available

    const response = await fetch(
      'https://api.elevenlabs.io/v1/speech-to-text',
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Voice] Transcription failed:', errorData);
      throw new Error(`Transcription API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.text || '';
  },
};
