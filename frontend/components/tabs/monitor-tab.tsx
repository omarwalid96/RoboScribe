'use client';

import React from 'react';
import { AlertCircle, Zap } from 'lucide-react';
import { useRobotState } from '@/hooks/use-robot-state';
import { JointMonitor } from '@/components/joint-monitor';
import { RealtimeChart } from '@/components/realtime-chart';
import { AlertPanel } from '@/components/alert-panel';
import { ImuPanel } from '@/components/imu-panel';
import { Card } from '@/components/ui/card';

export function MonitorTab() {
  const { robotState, alerts } = useRobotState();

  if (!robotState) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin mb-4">
            <Zap className="h-8 w-8 text-primary mx-auto" />
          </div>
          <p className="text-muted-foreground">Connecting to robot...</p>
        </div>
      </div>
    );
  }

  const criticalAlerts = alerts.filter(a => a.level === 'critical' && !a.resolved);

  return (
    <div className="space-y-6">
      {/* Alert Panel */}
      <div>
        <h2 className="text-lg font-semibold mb-4">System Alerts</h2>
        <AlertPanel />
      </div>

      {/* System Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Mode</div>
          <div className="text-lg font-bold capitalize text-accent">
            {robotState.mode}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">CPU Usage</div>
          <div className="text-lg font-bold text-primary">
            {Math.round(robotState.cpuUsage)}%
          </div>
          <div className="h-1.5 bg-primary/20 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${robotState.cpuUsage}%` }}
            />
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Memory Usage</div>
          <div className="text-lg font-bold text-accent">
            {Math.round(robotState.memoryUsage)}%
          </div>
          <div className="h-1.5 bg-accent/20 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${robotState.memoryUsage}%` }}
            />
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Joints Healthy</div>
          <div className="text-lg font-bold text-emerald-400">
            {robotState.joints.filter(j => j.status === 'healthy').length}/{robotState.joints.length}
          </div>
        </Card>
      </div>

      {/* IMU / Base Velocity */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Base Velocity (IMU-equivalent)</h2>
        <ImuPanel />
      </div>

      {/* Real-time Chart */}
      <RealtimeChart />

      {/* Joint Monitor */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Joint Telemetry</h2>
        <JointMonitor />
      </div>
    </div>
  );
}
