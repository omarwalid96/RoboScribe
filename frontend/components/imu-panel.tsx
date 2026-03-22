'use client';

import React from 'react';
import { Activity } from 'lucide-react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Card } from '@/components/ui/card';

function MetricRow({ label, values, unit, colorClass }: {
  label: string;
  values: [number, number, number];
  unit: string;
  colorClass: string;
}) {
  const axes = ['X', 'Y', 'Z'] as const;
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {axes.map((axis, i) => (
          <div key={axis} className="bg-background/50 rounded px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">{axis}</div>
            <div className={`font-mono text-sm font-bold ${colorClass}`}>
              {values[i].toFixed(3)}
            </div>
            <div className="text-[10px] text-muted-foreground">{unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpeedBar({ value, max, colorClass }: { value: number; max: number; colorClass: string }) {
  const pct = Math.min(Math.abs(value) / max * 100, 100);
  return (
    <div className="h-1.5 bg-input rounded-full overflow-hidden">
      <div className={`h-full ${colorClass} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ImuPanel() {
  const { robotState } = useRobotState();

  if (!robotState?.imu) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">IMU / Base Velocity</h3>
        </div>
        <p className="text-xs text-muted-foreground">Waiting for IMU data...</p>
      </Card>
    );
  }

  const { linearVelocity, angularVelocity } = robotState.imu;
  const speed = Math.sqrt(linearVelocity[0] ** 2 + linearVelocity[1] ** 2);
  const yawRate = Math.abs(angularVelocity[2]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">IMU / Base Velocity</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">world frame</span>
      </div>

      <div className="space-y-4">
        <MetricRow
          label="Linear Velocity"
          values={linearVelocity}
          unit="m/s"
          colorClass="text-primary"
        />
        <MetricRow
          label="Angular Velocity"
          values={angularVelocity}
          unit="rad/s"
          colorClass="text-accent"
        />

        {/* Summary bars */}
        <div className="pt-2 border-t border-border space-y-2">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Ground Speed</span>
              <span className="font-mono text-primary">{speed.toFixed(3)} m/s</span>
            </div>
            <SpeedBar value={speed} max={1.0} colorClass="bg-primary" />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Yaw Rate</span>
              <span className="font-mono text-accent">{yawRate.toFixed(3)} rad/s</span>
            </div>
            <SpeedBar value={yawRate} max={1.0} colorClass="bg-accent" />
          </div>
        </div>
      </div>
    </Card>
  );
}
