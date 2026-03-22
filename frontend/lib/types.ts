// Joint telemetry data types
export interface JointTelemetry {
  id: string;
  name: string;
  position: number; // degrees
  velocity: number; // deg/s
  torque: number; // N·m
  temperature: number; // Celsius
  current: number; // Amperes
  status: 'healthy' | 'warning' | 'critical' | 'offline';
  timestamp: number;
}

// IMU-equivalent data from the robot base link
export interface ImuData {
  linearVelocity: [number, number, number]; // [vx, vy, vz] m/s in world frame
  angularVelocity: [number, number, number]; // [wx, wy, wz] rad/s in world frame
  timestamp: number;
}

// Robot state
export interface RobotState {
  id: string;
  name: string;
  model: string;
  status: 'connected' | 'disconnected' | 'error';
  mode: 'idle' | 'running' | 'teaching' | 'emergency_stop';
  joints: JointTelemetry[];
  imu?: ImuData;
  uptime: number; // seconds
  cpuUsage: number; // percentage
  memoryUsage: number; // percentage
  activeTask?: string;
  lastUpdated: number;
}

// Motion trajectory
export interface Trajectory {
  id: string;
  name: string;
  createdAt: number;
  frames: TrajectoryFrame[];
  duration: number; // seconds
  description?: string;
}

// Single frame in trajectory
export interface TrajectoryFrame {
  timestamp: number;
  jointAngles: number[];
  speed: number; // 0-100%
}

// Dataset recording
export interface Dataset {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  frames: number;
  duration: number; // seconds
  labels: string[];
  recordingType: 'manual' | 'autonomous' | 'replay';
  status: 'recording' | 'completed' | 'processing';
}

// System error/alert
export interface SystemAlert {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: number;
  jointId?: string;
  resolved: boolean;
}

// Motion preset
export interface MotionPreset {
  id: string;
  name: string;
  description: string;
  jointAngles: number[];
  speed: number;
}

// Settings/Configuration
export interface RobotConfig {
  jointLimits: JointLimit[];
  temperatureThreshold: number;
  torqueThreshold: number;
  velocityThreshold: number;
  safetyMode: boolean;
  autoRecovery: boolean;
}

export interface JointLimit {
  jointId: string;
  minAngle: number;
  maxAngle: number;
  maxVelocity: number;
  maxTorque: number;
}
