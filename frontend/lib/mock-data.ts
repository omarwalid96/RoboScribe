import type { JointTelemetry, RobotState, SystemAlert } from './types';
import { JOINTS, DEFAULT_JOINT_TELEMETRY, STATUS_THRESHOLDS } from './constants';

// Simulated motion curves using sine waves
class MotionSimulator {
  private time = 0;
  private baseAngles: number[] = JOINTS.map(() => 0);
  private targetAngles: number[] = JOINTS.map(() => 0);

  setTargetAngles(angles: number[]) {
    this.targetAngles = angles;
  }

  getJointPosition(jointIndex: number, deltaTime: number): number {
    this.time += deltaTime;
    
    // Smooth interpolation toward target
    const current = this.baseAngles[jointIndex];
    const target = this.targetAngles[jointIndex];
    const diff = target - current;
    
    // Smooth movement with velocity limit
    const maxVelocity = 180; // deg/s
    const moveAmount = Math.min(Math.abs(diff), maxVelocity * (deltaTime / 1000));
    
    if (Math.abs(diff) > 1) {
      this.baseAngles[jointIndex] += Math.sign(diff) * moveAmount;
    }

    // Add slight oscillation for realistic motion
    const oscillation = Math.sin(this.time * 0.05) * 2;
    return this.baseAngles[jointIndex] + (Math.random() - 0.5) * 3 + oscillation;
  }

  getJointVelocity(jointIndex: number): number {
    const diff = this.targetAngles[jointIndex] - this.baseAngles[jointIndex];
    return Math.min(Math.abs(diff), 180) * (0.5 + Math.random() * 0.5);
  }
}

const motionSimulator = new MotionSimulator();

/**
 * Generate realistic mock telemetry data for a joint
 */
export function generateJointTelemetry(
  jointId: string,
  index: number,
  deltaTime: number
): JointTelemetry {
  const position = motionSimulator.getJointPosition(index, deltaTime);
  const velocity = motionSimulator.getJointVelocity(index);
  
  // Torque increases with velocity
  const baseTorque = Math.random() * 30 + 20;
  const torque = baseTorque + velocity * 0.3;
  
  // Temperature based on torque (heat generation)
  const temperature = 25 + Math.random() * 10 + (torque * 0.2);
  
  // Current proportional to torque
  const current = 0.5 + torque * 0.05 + Math.random() * 0.5;

  // Determine status based on thresholds
  let status: 'healthy' | 'warning' | 'critical' | 'offline' = 'healthy';
  
  if (
    temperature > STATUS_THRESHOLDS.temperature.critical ||
    torque > STATUS_THRESHOLDS.torque.critical ||
    velocity > STATUS_THRESHOLDS.velocity.critical ||
    current > STATUS_THRESHOLDS.current.critical
  ) {
    status = 'critical';
  } else if (
    temperature > STATUS_THRESHOLDS.temperature.warning ||
    torque > STATUS_THRESHOLDS.torque.warning ||
    velocity > STATUS_THRESHOLDS.velocity.warning ||
    current > STATUS_THRESHOLDS.current.warning
  ) {
    status = 'warning';
  }

  return {
    id: jointId,
    name: JOINTS.find(j => j.id === jointId)?.name || `Joint ${index + 1}`,
    position: Math.round(position * 10) / 10,
    velocity: Math.round(velocity * 10) / 10,
    torque: Math.round(torque * 10) / 10,
    temperature: Math.round(temperature * 10) / 10,
    current: Math.round(current * 100) / 100,
    status,
    timestamp: Date.now(),
  };
}

/**
 * Generate complete robot state with all joint telemetry
 */
export function generateRobotState(deltaTime: number): RobotState {
  const joints = JOINTS.map((joint, index) =>
    generateJointTelemetry(joint.id, index, deltaTime)
  );

  // Calculate system metrics
  const avgTemperature = joints.reduce((sum, j) => sum + j.temperature, 0) / joints.length;
  const avgTorque = joints.reduce((sum, j) => sum + j.torque, 0) / joints.length;
  
  // System uptime (mock: increases each update)
  const uptime = Math.floor(Date.now() / 1000) % (24 * 3600); // cycles daily
  
  // CPU/Memory usage with some variation
  const cpuUsage = 25 + Math.sin(Date.now() * 0.0001) * 15 + Math.random() * 10;
  const memoryUsage = 40 + Math.cos(Date.now() * 0.00015) * 10 + Math.random() * 5;

  // IMU mock data
  const time = Date.now() * 0.001;
  const imu = {
    linearVelocity: [
      Math.sin(time * 0.5) * 0.2 + (Math.random() - 0.5) * 0.05,
      Math.cos(time * 0.3) * 0.1 + (Math.random() - 0.5) * 0.03,
      Math.sin(time * 1.2) * 0.05 + (Math.random() - 0.5) * 0.02,
    ] as [number, number, number],
    angularVelocity: [
      Math.cos(time * 0.8) * 0.1 + (Math.random() - 0.5) * 0.02,
      Math.sin(time * 0.6) * 0.1 + (Math.random() - 0.5) * 0.02,
      Math.cos(time * 1.5) * 0.05 + (Math.random() - 0.5) * 0.01,
    ] as [number, number, number],
    timestamp: Date.now(),
  };

  return {
    id: 'h1',
    name: 'Unitree H1',
    model: 'H1',
    status: 'connected',
    mode: 'idle',
    joints,
    imu,
    uptime: Math.round(uptime),
    cpuUsage: Math.round(cpuUsage),
    memoryUsage: Math.round(memoryUsage),
    lastUpdated: Date.now(),
  };
}

/**
 * Generate system alerts based on current robot state
 */
export function generateSystemAlerts(robotState: RobotState): SystemAlert[] {
  const alerts: SystemAlert[] = [];

  // Check each joint for issues
  robotState.joints.forEach((joint, index) => {
    if (joint.status === 'critical') {
      if (joint.temperature > STATUS_THRESHOLDS.temperature.critical) {
        alerts.push({
          id: `alert-temp-${joint.id}`,
          level: 'critical',
          message: `Critical: ${joint.name} temperature is ${joint.temperature}°C`,
          timestamp: Date.now(),
          jointId: joint.id,
          resolved: false,
        });
      }
      if (joint.torque > STATUS_THRESHOLDS.torque.critical) {
        alerts.push({
          id: `alert-torque-${joint.id}`,
          level: 'critical',
          message: `Critical: ${joint.name} torque exceeds limit (${joint.torque} N·m)`,
          timestamp: Date.now(),
          jointId: joint.id,
          resolved: false,
        });
      }
    } else if (joint.status === 'warning') {
      if (joint.temperature > STATUS_THRESHOLDS.temperature.warning) {
        alerts.push({
          id: `alert-warn-temp-${joint.id}`,
          level: 'warning',
          message: `Warning: ${joint.name} temperature rising (${joint.temperature}°C)`,
          timestamp: Date.now(),
          jointId: joint.id,
          resolved: false,
        });
      }
    }
  });

  // Connection status
  if (robotState.status === 'disconnected') {
    alerts.push({
      id: 'alert-connection',
      level: 'critical',
      message: 'Robot connection lost',
      timestamp: Date.now(),
      resolved: false,
    });
  }

  return alerts;
}

/**
 * Set target joint angles for the motion simulator
 */
export function setMotionTarget(angles: number[]) {
  motionSimulator.setTargetAngles(angles);
}

/**
 * Get the current motion simulator state (for testing)
 */
export function getMotionSimulatorState() {
  return motionSimulator;
}
