'use client';

import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { Dataset, MotionPreset, RobotConfig, RobotState, SystemAlert, Trajectory } from '@/lib/types';
import { DEFAULT_ROBOT_CONFIG, MOTION_PRESETS, STORAGE_KEYS, TELEMETRY_INTERVAL } from '@/lib/constants';
import { generateRobotState, generateSystemAlerts, setMotionTarget } from '@/lib/mock-data';
import { API_CONFIG, robotApi, robotWebSocket, type WebSocketMessage } from '@/lib/api-client';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

interface RobotStats {
  totalTrajectories: number;
  successRate: number;
  totalTimesteps: number;
  uniqueCommands: number;
}

interface NavigationState {
  target: string;
  distance?: number;
  bearing?: number;
  detected?: boolean;
  arrived?: boolean;
}

interface RobotContextType {
  // State
  robotState: RobotState | null;
  alerts: SystemAlert[];
  datasets: Dataset[];
  trajectories: Trajectory[];
  presets: MotionPreset[];
  config: RobotConfig;
  isRecording: boolean;
  activeTab: string;
  sidebarCollapsed: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  isUsingMockData: boolean;

  // RoboScribe-specific state
  robotStatus: 'idle' | 'executing' | 'error';
  pendingCommand: { commandId: string; confirmationText: string; parsed: Record<string, unknown> } | null;
  executionProgress: { commandId: string; commandText?: string; currentStep: number; totalSteps: number; distance: number } | null;
  lastResultText: string | null;
  stats: RobotStats;
  navigationState: NavigationState | null;

  // Actions
  updateRobotState: (state: RobotState) => void;
  clearAlerts: () => void;
  resolveAlert: (alertId: string) => void;
  moveToPreset: (presetId: string) => void;
  moveToAngles: (angles: number[]) => void;
  startRecording: () => void;
  stopRecording: () => void;
  saveDataset: (name: string, description: string) => void;
  addPreset: (preset: MotionPreset) => void;
  updateConfig: (config: Partial<RobotConfig>) => void;
  setActiveTab: (tab: string) => void;
  toggleSidebar: () => void;

  // API Actions
  sendCommand: (command: string) => void;
  confirmCommand: (commandId: string, confirmed: boolean) => void;
  emergencyStop: () => void;
}

export const RobotContext = createContext<RobotContextType | undefined>(undefined);

// Wires the Convex `recordings.save` mutation into a ref so RobotProvider
// can call it without violating Rules of Hooks (hooks can't be called
// conditionally, so this lives in a dedicated component rendered only when
// ConvexProvider is in the tree).
function ConvexRecordingBridge({
  saveRef,
}: {
  saveRef: React.MutableRefObject<((args: Record<string, unknown>) => Promise<any>) | null>;
}) {
  const saveMutation = useMutation(api.recordings.save) as any;

  useEffect(() => {
    saveRef.current = saveMutation;
    return () => { saveRef.current = null; };
  }, [saveMutation, saveRef]);

  return null;
}

export function RobotProvider({ children }: { children: React.ReactNode }) {
  const [robotState, setRobotState] = useState<RobotState | null>(null);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [trajectories, setTrajectories] = useState<Trajectory[]>([]);
  const [presets, setPresets] = useState<MotionPreset[]>(MOTION_PRESETS);
  const [config, setConfig] = useState<RobotConfig>(DEFAULT_ROBOT_CONFIG);
  const [isRecording, setIsRecording] = useState(false);
  const [activeTab, setActiveTab] = useState('monitor');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');

  // RoboScribe-specific state
  const [robotStatus, setRobotStatus] = useState<'idle' | 'executing' | 'error'>('idle');
  const [pendingCommand, setPendingCommand] = useState<{
    commandId: string;
    confirmationText: string;
    parsed: Record<string, unknown>;
  } | null>(null);
  const [executionProgress, setExecutionProgress] = useState<{ commandId: string; commandText?: string; currentStep: number; totalSteps: number; distance: number } | null>(null);
  const [lastResultText, setLastResultText] = useState<string | null>(null);
  const [stats, setStats] = useState<RobotStats>({
    totalTrajectories: 0,
    successRate: 0,
    totalTimesteps: 0,
    uniqueCommands: 0,
  });
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const latestJointMessageRef = useRef<WebSocketMessage | null>(null);
  const jointUpdateRafRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const recordingFramesRef = useRef<Array<{
    t: number;
    joint_positions: number[];
    joint_velocities: number[];
    base_position?: number[];
    base_orientation?: number[];
    linear_velocity?: number[];
    angular_velocity?: number[];
  }>>([]);
  const saveRecordingRef = useRef<((args: Record<string, unknown>) => Promise<any>) | null>(null);

  // Refs to avoid stale closures in the WebSocket handler
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

  // Load persisted state from localStorage
  useEffect(() => {
    try {
      const savedDatasets = localStorage.getItem(STORAGE_KEYS.DATASETS);
      const savedPresets = localStorage.getItem(STORAGE_KEYS.PRESETS);
      const savedConfig = localStorage.getItem(STORAGE_KEYS.CONFIG);
      const savedAlerts = localStorage.getItem(STORAGE_KEYS.ALERTS);
      const savedUIState = localStorage.getItem(STORAGE_KEYS.UI_STATE);

      if (savedDatasets) setDatasets(JSON.parse(savedDatasets));
      if (savedPresets) setPresets(JSON.parse(savedPresets));
      if (savedConfig) setConfig(JSON.parse(savedConfig));
      if (savedAlerts) setAlerts(JSON.parse(savedAlerts));
      if (savedUIState) {
        const uiState = JSON.parse(savedUIState);
        setActiveTab(uiState.activeTab || 'monitor');
        setSidebarCollapsed(uiState.sidebarCollapsed || false);
      }
    } catch (error) {
      console.error('[RobotProvider] Error loading persisted state:', error);
    }
  }, []);

  // WebSocket connection — runs ONCE on mount, no dependencies that would cause reconnect
  useEffect(() => {
    if (API_CONFIG.USE_MOCK_DATA) {
      // Mock WebSocket simulation - generate telemetry data
      setConnectionStatus('connected');
      let lastTime = Date.now();
      const interval = setInterval(() => {
        const now = Date.now();
        const deltaTime = now - lastTime;
        lastTime = now;
        const newState = generateRobotState(deltaTime);
        setRobotState(newState);
        const newAlerts = generateSystemAlerts(newState);
        setAlerts(prev => {
          const merged = [...prev];
          newAlerts.forEach(alert => {
            if (!merged.find(a => a.id === alert.id)) {
              merged.push(alert);
            }
          });
          return merged.slice(-10);
        });
      }, TELEMETRY_INTERVAL);

      return () => clearInterval(interval);
    }

    // ── Real WebSocket connection ──────────────────────────────────────
    robotWebSocket.connect();

    const flushJointUpdate = () => {
      jointUpdateRafRef.current = null;
      const msg = latestJointMessageRef.current;
      if (!msg) return;

      const positions = (msg.joint_positions as number[]) || [];
      const velocities = (msg.joint_velocities as number[]) || [];
      const torques = (msg.joint_torques as number[]) || [];
      const linearVel = (msg.linear_velocity as number[]) || [0, 0, 0];
      const angularVel = (msg.angular_velocity as number[]) || [0, 0, 0];
      const RAD2DEG = 180 / Math.PI;

      const JOINT_NAMES = [
        'left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
        'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle',
        'torso',
        'left_shoulder_pitch', 'left_shoulder_roll', 'left_shoulder_yaw', 'left_elbow',
        'right_shoulder_pitch', 'right_shoulder_roll', 'right_shoulder_yaw', 'right_elbow',
      ];

      const joints = JOINT_NAMES.map((name, i) => ({
        id: `joint-${i}`,
        name,
        position: (positions[i] ?? 0) * RAD2DEG,
        velocity: (velocities[i] ?? 0) * RAD2DEG,
        torque: torques[i] ?? 0,
        temperature: 0,
        current: 0,
        status: 'healthy' as const,
        timestamp: Date.now(),
      }));

      setRobotState({
        id: 'h1',
        name: 'Unitree H1',
        model: 'H1',
        status: 'connected',
        mode: 'running',
        joints,
        imu: {
          linearVelocity: [linearVel[0] ?? 0, linearVel[1] ?? 0, linearVel[2] ?? 0],
          angularVelocity: [angularVel[0] ?? 0, angularVel[1] ?? 0, angularVel[2] ?? 0],
          timestamp: Date.now(),
        },
        uptime: (msg.t as number) || 0,
        cpuUsage: 0,
        memoryUsage: 0,
        lastUpdated: Date.now(),
      });
    };

    const unsubMessage = robotWebSocket.onMessage((msg: WebSocketMessage) => {
      switch (msg.type) {
        // Backend sends parsed command + confirmation text
        case 'command_parsed': {
          const commandId = msg.command_id as string;
          const confirmationText = (msg.confirmation_text as string) || '';
          const parsed = (msg.parsed as Record<string, unknown>) || {};
          setPendingCommand({ commandId, confirmationText, parsed });
          console.log('[WS] command_parsed:', commandId, parsed);
          break;
        }

        // Backend is waiting for user to confirm
        case 'awaiting_confirmation': {
          // pendingCommand should already be set from command_parsed
          console.log('[WS] awaiting_confirmation:', msg.command_id);
          break;
        }

        // Robot status changes
        case 'status': {
          const status = msg.robot_status as string;
          if (status === 'idle' || status === 'executing' || status === 'error') {
            setRobotStatus(status);
          }
          if (status === 'idle') {
            setExecutionProgress(null);
          }
          break;
        }

        // Execution has started
        case 'execution_started': {
          const rawText = (msg.metadata as Record<string, unknown>)?.natural_language_command
                       || pendingCommand?.confirmationText;
          const text = typeof rawText === 'string' ? rawText.split('.')[0] : 'Executing command...';

          setExecutionProgress({
            commandId: msg.command_id as string,
            commandText: text,
            currentStep: 0,
            totalSteps: (msg.total_steps as number) || 0,
            distance: 0,
          });
          // Clear stale result text so the TTS effect doesn't re-speak the previous
          // command's result when pendingCommand is nulled out below.
          setLastResultText(null);
          setPendingCommand(null);
          console.log('[WS] execution_started:', msg.command_id);
          break;
        }

        // Progress updates during execution
        case 'execution_progress': {
          setExecutionProgress(prev => ({
            commandId: (msg.command_id as string) || prev?.commandId || '',
            currentStep: (msg.current_step as number) || 0,
            totalSteps: prev?.totalSteps || 0,
            distance: (msg.distance_traveled as number) || 0,
          }));
          break;
        }

        // Live joint updates from Isaac Sim (forwarded by backend)
        case 'joint_update': {
          latestJointMessageRef.current = msg;
          if (jointUpdateRafRef.current === null) {
            jointUpdateRafRef.current = window.requestAnimationFrame(flushJointUpdate);
          }
          // Capture frame when recording
          if (isRecordingRef.current) {
            recordingFramesRef.current.push({
              t: (msg.timestamp as number) || Date.now(),
              joint_positions: (msg.joint_positions as number[]) || [],
              joint_velocities: (msg.joint_velocities as number[]) || [],
              base_position: (msg.base_position as number[]) || undefined,
              base_orientation: (msg.base_orientation as number[]) || undefined,
              linear_velocity: (msg.linear_velocity as number[]) || undefined,
              angular_velocity: (msg.angular_velocity as number[]) || undefined,
            });
          }
          break;
        }

        // Trajectory saved after execution complete
        case 'trajectory_saved': {
          const meta = msg.metadata as Record<string, unknown>;
          if (meta) {
            setTrajectories(prev => [...prev, {
              id: (msg.trajectory_id as string) || '',
              name: (meta.natural_language_command as string) || '',
              createdAt: Date.now(),
              frames: [],
              duration: (meta.duration_seconds as number) || 0,
              description: `${meta.total_steps} steps, ${(meta.distance_traveled as number)?.toFixed(2) || 0}m`,
              // Extra fields for the trajectory table
              _command: (meta.natural_language_command as string) || '',
              _timestamp: (meta.timestamp as string) || '',
              _steps: (meta.total_steps as number) || 0,
              _outcome: (meta.outcome as string) || 'unknown',
              _distance: (meta.distance_traveled as number) || 0,
              _validation: (meta.validation as Record<string, unknown>) || null,
            } as Trajectory & Record<string, unknown>]);
          }
          console.log('[WS] trajectory_saved:', msg.trajectory_id, meta);
          break;
        }

        // Result text (speech text for frontend to speak via ElevenLabs)
        case 'result_text': {
          const text = msg.text as string;
          setLastResultText(text);
          console.log('[WS] result_text:', text);
          break;
        }

        // Stats update
        case 'stats_update': {
          setStats({
            totalTrajectories: (msg.total_trajectories as number) || 0,
            successRate: (msg.success_rate as number) || 0,
            totalTimesteps: (msg.total_timesteps as number) || 0,
            uniqueCommands: (msg.unique_commands as number) || 0,
          });
          console.log('[WS] stats_update:', msg);
          break;
        }

        // Visual navigation messages
        case 'navigation_started': {
          setNavigationState({ target: msg.target as string });
          console.log('[WS] navigation_started:', msg.target);
          break;
        }

        case 'navigation_progress': {
          setNavigationState(prev => prev ? {
            ...prev,
            distance: msg.distance as number | undefined,
            bearing: msg.bearing as number | undefined,
            detected: msg.detected as boolean,
          } : null);
          break;
        }

        case 'navigation_arrived': {
          setNavigationState(prev => prev ? { ...prev, arrived: true } : null);
          // Auto-clear after 3 seconds
          setTimeout(() => setNavigationState(null), 3000);
          console.log('[WS] navigation_arrived:', msg.target);
          break;
        }

        default:
          console.log('[WS] Unhandled message type:', msg.type, msg);
      }
    });

    const unsubConnection = robotWebSocket.onConnectionChange((status) => {
      setConnectionStatus(status);
    });

    return () => {
      if (jointUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(jointUpdateRafRef.current);
        jointUpdateRafRef.current = null;
      }
      unsubMessage();
      unsubConnection();
      robotWebSocket.disconnect();
    };
  }, []); // Empty deps — connect once, stay connected

  // Persist state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.DATASETS, JSON.stringify(datasets));
      localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(presets));
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
      localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
      localStorage.setItem(
        STORAGE_KEYS.UI_STATE,
        JSON.stringify({ activeTab, sidebarCollapsed })
      );
    } catch (error) {
      console.error('[RobotProvider] Error persisting state:', error);
    }
  }, [datasets, presets, config, alerts, activeTab, sidebarCollapsed]);

  const updateRobotState = useCallback((state: RobotState) => {
    setRobotState(state);
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const resolveAlert = useCallback((alertId: string) => {
    setAlerts(prev =>
      prev.map(alert =>
        alert.id === alertId ? { ...alert, resolved: true } : alert
      )
    );
  }, []);

  const moveToPreset = useCallback((presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setMotionTarget(preset.jointAngles);
    }
  }, [presets]);

  const moveToAngles = useCallback((angles: number[]) => {
    setMotionTarget(angles);
  }, []);

  const startRecording = useCallback(() => {
    const timestamp = Date.now();
    const newDataset: Dataset = {
      id: `dataset-${timestamp}`,
      name: `Recording #${datasets.length + 1}`,
      description: 'New recording session',
      createdAt: timestamp,
      frames: 0,
      duration: 0,
      labels: [],
      recordingType: 'manual',
      status: 'recording',
    };
    setDatasets(prev => [...prev, newDataset]);
    recordingStartTimeRef.current = Date.now();
    recordingFramesRef.current = [];
    setIsRecording(true);
  }, [datasets.length]);

  const stopRecording = useCallback(() => {
    const duration = recordingStartTimeRef.current > 0
      ? (Date.now() - recordingStartTimeRef.current) / 1000
      : 0;
    const frameCount = recordingFramesRef.current.length;
    const frames = [...recordingFramesRef.current]; // snapshot before clearing

    setIsRecording(false);

    // Find the active dataset name/description before state update (state updates are async)
    const activeDataset = datasets.find(d => d.status === 'recording');

    setDatasets(prev =>
      prev.map(d =>
        d.status === 'recording'
          ? { ...d, status: 'completed', duration, frames: frameCount }
          : d
      )
    );

    // Persist to Convex if configured and we have frames
    if (saveRecordingRef.current && frames.length > 0 && activeDataset) {
      saveRecordingRef.current({
        name: activeDataset.name,
        description: activeDataset.description,
        created_at: recordingStartTimeRef.current,
        duration_seconds: duration,
        frame_count: frameCount,
        frames,
      }).catch(err => console.error('[Convex] Failed to save recording:', err));
    }

    recordingFramesRef.current = [];
  }, [datasets]);

  const saveDataset = useCallback((name: string, description: string) => {
    const duration = recordingStartTimeRef.current > 0
      ? (Date.now() - recordingStartTimeRef.current) / 1000
      : 0;
    const frameCount = recordingFramesRef.current.length;
    const frames = [...recordingFramesRef.current]; // snapshot before clearing

    setDatasets(prev =>
      prev.map(d =>
        d.status === 'recording'
          ? { ...d, name, description, status: 'completed', duration, frames: frameCount }
          : d
      )
    );
    setIsRecording(false);

    // Persist to Convex if configured and we have frames
    if (saveRecordingRef.current && frames.length > 0) {
      saveRecordingRef.current({
        name,
        description,
        created_at: recordingStartTimeRef.current,
        duration_seconds: duration,
        frame_count: frameCount,
        frames,
      }).catch(err => console.error('[Convex] Failed to save recording:', err));
    }

    recordingFramesRef.current = [];
  }, []);

  const addPreset = useCallback((preset: MotionPreset) => {
    setPresets(prev => [...prev, preset]);
  }, []);

  const updateConfig = useCallback((updates: Partial<RobotConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // API Actions — now synchronous, WebSocket-only
  const sendCommand = useCallback((command: string) => {
    robotApi.sendCommand(command);
  }, []);

  const confirmCommand = useCallback((commandId: string, confirmed: boolean) => {
    robotApi.confirmCommand(commandId, confirmed);
    setPendingCommand(null);
  }, []);

  const emergencyStop = useCallback(() => {
    robotWebSocket.send({ type: 'stop' });
    setIsRecording(false);
    setPendingCommand(null);
    setExecutionProgress(null);
  }, []);

  const value: RobotContextType = {
    robotState,
    alerts,
    datasets,
    trajectories,
    presets,
    config,
    isRecording,
    activeTab,
    sidebarCollapsed,
    connectionStatus,
    isUsingMockData: API_CONFIG.USE_MOCK_DATA,
    robotStatus,
    pendingCommand,
    executionProgress,
    lastResultText,
    stats,
    navigationState,
    updateRobotState,
    clearAlerts,
    resolveAlert,
    moveToPreset,
    moveToAngles,
    startRecording,
    stopRecording,
    saveDataset,
    addPreset,
    updateConfig,
    setActiveTab,
    toggleSidebar: () => setSidebarCollapsed(prev => !prev),
    sendCommand,
    confirmCommand,
    emergencyStop,
  };

  return (
    <RobotContext.Provider value={value}>
      {process.env.NEXT_PUBLIC_CONVEX_URL && (
        <ConvexRecordingBridge saveRef={saveRecordingRef} />
      )}
      {children}
    </RobotContext.Provider>
  );
}
