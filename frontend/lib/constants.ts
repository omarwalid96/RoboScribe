import type { JointLimit, MotionPreset, RobotConfig } from './types';

// Unitree H1 joint configuration (19 DOF)
export const JOINTS = [
  { id: 'joint-0',  name: 'left_hip_yaw',           color: '#3B82F6' },
  { id: 'joint-1',  name: 'left_hip_roll',          color: '#2563EB' },
  { id: 'joint-2',  name: 'left_hip_pitch',         color: '#1D4ED8' },
  { id: 'joint-3',  name: 'left_knee',              color: '#1E40AF' },
  { id: 'joint-4',  name: 'left_ankle',             color: '#1E3A8A' },
  { id: 'joint-5',  name: 'right_hip_yaw',          color: '#10B981' },
  { id: 'joint-6',  name: 'right_hip_roll',         color: '#059669' },
  { id: 'joint-7',  name: 'right_hip_pitch',        color: '#047857' },
  { id: 'joint-8',  name: 'right_knee',             color: '#065F46' },
  { id: 'joint-9',  name: 'right_ankle',            color: '#064E3B' },
  { id: 'joint-10', name: 'torso',                   color: '#F59E0B' },
  { id: 'joint-11', name: 'left_shoulder_pitch',    color: '#8B5CF6' },
  { id: 'joint-12', name: 'left_shoulder_roll',     color: '#7C3AED' },
  { id: 'joint-13', name: 'left_shoulder_yaw',      color: '#6D28D9' },
  { id: 'joint-14', name: 'left_elbow',             color: '#5B21B6' },
  { id: 'joint-15', name: 'right_shoulder_pitch',   color: '#EC4899' },
  { id: 'joint-16', name: 'right_shoulder_roll',    color: '#DB2777' },
  { id: 'joint-17', name: 'right_shoulder_yaw',     color: '#06B6D4' },
  { id: 'joint-18', name: 'right_elbow',            color: '#6366F1' },
] as const;

export const JOINT_IDS = JOINTS.map(j => j.id);

// Default joint limits (degrees)
export const DEFAULT_JOINT_LIMITS: JointLimit[] = JOINTS.map(j => ({
  jointId: j.id,
  minAngle: -180,
  maxAngle: 180,
  maxVelocity: 180,
  maxTorque: 150,
}));

// Motion presets (19 DOF — H1 humanoid)
export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: 'preset-1',
    name: 'Home Position',
    description: 'Robot in neutral standing position',
    jointAngles: Array(19).fill(0),
    speed: 50,
  },
];

// Default robot configuration
export const DEFAULT_ROBOT_CONFIG: RobotConfig = {
  jointLimits: DEFAULT_JOINT_LIMITS,
  temperatureThreshold: 75, // Celsius
  torqueThreshold: 140, // N·m
  velocityThreshold: 170, // deg/s
  safetyMode: true,
  autoRecovery: false,
};

// Thresholds for status colors
export const STATUS_THRESHOLDS = {
  temperature: {
    warning: 60,
    critical: 75,
  },
  torque: {
    warning: 120,
    critical: 140,
  },
  velocity: {
    warning: 150,
    critical: 170,
  },
  current: {
    warning: 8,
    critical: 10,
  },
} as const;

// Chart colors for visualization (one per joint)
export const CHART_COLORS = JOINTS.map(j => j.color);

// Telemetry update interval (ms)
export const TELEMETRY_INTERVAL = 100;

// Dataset update interval (ms)
export const DATASET_INTERVAL = 50;

// Default initial values for new robot state
export const DEFAULT_JOINT_TELEMETRY = {
  position: 0,
  velocity: 0,
  torque: 0,
  temperature: 25,
  current: 0,
  status: 'healthy' as const,
};

// Local storage keys
export const STORAGE_KEYS = {
  ROBOT_STATE: 'roboscribe:robot-state',
  DATASETS: 'roboscribe:datasets',
  PRESETS: 'roboscribe:presets',
  CONFIG: 'roboscribe:config',
  ALERTS: 'roboscribe:alerts',
  UI_STATE: 'roboscribe:ui-state',
} as const;

// UI configuration
export const UI_CONFIG = {
  SIDEBAR_WIDTH: 250,
  HEADER_HEIGHT: 60,
  ANIMATION_DURATION: 200,
} as const;
