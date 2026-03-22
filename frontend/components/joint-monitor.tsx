'use client';

import React, { useMemo } from 'react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function getStatusColor(status: string) {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    case 'warning':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'critical':
      return 'bg-red-500/20 text-red-300 border-red-500/30';
    case 'offline':
      return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  }
}

export function JointMonitor() {
  const { robotState } = useRobotState();

  if (!robotState) return null;

  const sortedJoints = useMemo(
    () => [...robotState.joints].sort((a, b) => a.id.localeCompare(b.id)),
    [robotState.joints]
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {sortedJoints.map(joint => (
        <Card key={joint.id} className="p-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-sm">{joint.name}</h3>
                <p className="text-xs text-muted-foreground">{joint.id}</p>
              </div>
              <Badge className={cn('border', getStatusColor(joint.status))}>
                {joint.status}
              </Badge>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="space-y-1">
                <div className="text-muted-foreground">Position</div>
                <div className="font-mono font-bold text-primary">
                  {joint.position.toFixed(1)}°
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-muted-foreground">Velocity</div>
                <div className="font-mono font-bold text-accent">
                  {joint.velocity.toFixed(1)}°/s
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-muted-foreground">Torque</div>
                <div
                  className="font-mono font-bold"
                  style={{
                    color: joint.torque > 120 ? '#f59e0b' : joint.torque > 140 ? '#ef4444' : '#3b82f6',
                  }}
                >
                  {joint.torque.toFixed(1)} N·m
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-muted-foreground">Temp</div>
                <div
                  className="font-mono font-bold"
                  style={{
                    color: joint.temperature > 60 ? '#f59e0b' : joint.temperature > 75 ? '#ef4444' : '#10b981',
                  }}
                >
                  {joint.temperature.toFixed(1)}°C
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-muted-foreground">Current</div>
                <div className="font-mono font-bold text-purple-400">
                  {joint.current.toFixed(2)} A
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-muted-foreground">Updated</div>
                <div className="text-muted-foreground">
                  {((Date.now() - joint.timestamp) / 1000).toFixed(1)}s ago
                </div>
              </div>
            </div>

            {/* Status Bar */}
            <div className="pt-2 border-t border-border">
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1">Torque Load</div>
                  <div className="h-2 bg-input rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.min((joint.torque / 150) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1">Temp</div>
                  <div className="h-2 bg-input rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${Math.min((joint.temperature / 80) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
