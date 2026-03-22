'use client';

import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useRobotState } from '@/hooks/use-robot-state';
import { Card } from '@/components/ui/card';
import { JOINTS } from '@/lib/constants';

interface RealtimeDataPoint {
  time: number;
  [key: string]: number;
}

export function RealtimeChart() {
  const { robotState } = useRobotState();
  const [data, setData] = useState<RealtimeDataPoint[]>([]);
  const [startTime] = useState<number>(() => Date.now());
  const [selectedMetric, setSelectedMetric] = useState<'position' | 'velocity' | 'torque' | 'temperature'>('position');

  useEffect(() => {
    if (!robotState) return;

    setData(prev => {
      const now = Date.now();
      const newPoint: RealtimeDataPoint = {
        time: Math.round((now - startTime) / 100) / 10, // time in deciseconds
      };

      switch (selectedMetric) {
        case 'position':
          robotState.joints.forEach(joint => {
            newPoint[`${joint.name} (°)`] = joint.position;
          });
          break;
        case 'velocity':
          robotState.joints.forEach(joint => {
            newPoint[`${joint.name} (°/s)`] = joint.velocity;
          });
          break;
        case 'torque':
          robotState.joints.forEach(joint => {
            newPoint[`${joint.name} (Nm)`] = joint.torque;
          });
          break;
        case 'temperature':
          robotState.joints.forEach(joint => {
            newPoint[`${joint.name} (°C)`] = joint.temperature;
          });
          break;
      }

      const updated = [...prev, newPoint];
      return updated.slice(-150); // Keep 150 points (~25 seconds)
    });
  }, [robotState, startTime, selectedMetric]);

  return (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Real-time Telemetry</h3>
        <div className="flex gap-2">
          {(['position', 'velocity', 'torque', 'temperature'] as const).map(metric => (
            <button
              key={metric}
              onClick={() => setSelectedMetric(metric)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                selectedMetric === metric
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-input text-muted-foreground hover:bg-input/80'
              }`}
            >
              {metric.charAt(0).toUpperCase() + metric.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-muted-foreground">
          Waiting for data...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="time"
              label={{ value: 'Time (s)', position: 'insideRight', offset: -5 }}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              label={{
                value:
                  selectedMetric === 'position'
                    ? '° (degrees)'
                    : selectedMetric === 'velocity'
                      ? '°/s'
                      : selectedMetric === 'torque'
                        ? 'N·m'
                        : '°C',
                angle: -90,
                position: 'insideLeft',
              }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#111927', border: '1px solid #1e293b' }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Legend />
            {JOINTS.map((joint, index) => (
              <Line
                key={joint.id}
                type="monotone"
                dataKey={`${joint.name} ${selectedMetric === 'position' ? '(°)' : selectedMetric === 'velocity' ? '(°/s)' : selectedMetric === 'torque' ? '(Nm)' : '(°C)'}`}
                stroke={joint.color}
                isAnimationActive={false}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
