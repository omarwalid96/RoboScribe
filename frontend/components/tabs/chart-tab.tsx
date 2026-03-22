'use client';

import React, { useEffect, useState } from 'react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { JOINTS, CHART_COLORS } from '@/lib/constants';

interface ChartDataPoint {
  time: number;
  [key: string]: number;
}

export function ChartTab() {
  const { robotState } = useRobotState();
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [startTime] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!robotState) return;

    setChartData(prev => {
      const now = Date.now();
      const newPoint: ChartDataPoint = {
        time: (now - startTime) / 1000,
      };

      robotState.joints.forEach(joint => {
        newPoint[joint.name] = joint.position;
      });

      // Add IMU data if available
      if (robotState.imu) {
        newPoint.lx = robotState.imu.linearVelocity[0];
        newPoint.ly = robotState.imu.linearVelocity[1];
        newPoint.lz = robotState.imu.linearVelocity[2];
        newPoint.ax = robotState.imu.angularVelocity[0];
        newPoint.ay = robotState.imu.angularVelocity[1];
        newPoint.az = robotState.imu.angularVelocity[2];
      }

      const updated = [...prev, newPoint];
      return updated.slice(-120); // Keep last 120 data points (~12 seconds at 10Hz)
    });
  }, [robotState, startTime]);

  if (!robotState) {
    return <div className="flex items-center justify-center h-96 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Position Chart */}
      <Card className="p-6 border-white/10 bg-[#060606]/40 backdrop-blur-xl">
        <h2 className="text-lg font-bold mb-4 uppercase tracking-wider text-white">Joint Positions Over Time</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="time" 
              stroke="rgba(255,255,255,0.3)" 
              fontSize={10} 
              tickFormatter={(val) => `${val.toFixed(0)}s`}
            />
            <YAxis 
              stroke="rgba(255,255,255,0.3)" 
              fontSize={10}
              label={{ value: 'Pos (°)', angle: -90, position: 'insideLeft', style: { fill: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 'bold' } }} 
            />
            <Tooltip 
              contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
              itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
            />
            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
            {JOINTS.map((joint, index) => (
              <Line
                key={joint.id}
                type="monotone"
                dataKey={joint.name}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                isAnimationActive={false}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* IMU Linear Velocity Chart */}
        <Card className="p-6 border-white/10 bg-[#060606]/40 backdrop-blur-xl">
          <h2 className="text-lg font-bold mb-4 uppercase tracking-wider text-white">Base Linear Velocity</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={10} hide />
              <YAxis 
                stroke="rgba(255,255,255,0.3)" 
                fontSize={10}
                label={{ value: 'm/s', angle: -90, position: 'insideLeft', style: { fill: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 'bold' } }} 
              />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(8px)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
              />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              <Line name="VX" type="monotone" dataKey="lx" stroke="#22d3ee" isAnimationActive={false} strokeWidth={2} dot={false} />
              <Line name="VY" type="monotone" dataKey="ly" stroke="#8b5cf6" isAnimationActive={false} strokeWidth={2} dot={false} />
              <Line name="VZ" type="monotone" dataKey="lz" stroke="#10b981" isAnimationActive={false} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* IMU Angular Velocity Chart */}
        <Card className="p-6 border-white/10 bg-[#060606]/40 backdrop-blur-xl">
          <h2 className="text-lg font-bold mb-4 uppercase tracking-wider text-white">Base Angular Velocity</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={10} hide />
              <YAxis 
                stroke="rgba(255,255,255,0.3)" 
                fontSize={10}
                label={{ value: 'rad/s', angle: -90, position: 'insideLeft', style: { fill: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 'bold' } }} 
              />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(8px)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
              />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              <Line name="WX" type="monotone" dataKey="ax" stroke="#22d3ee" isAnimationActive={false} strokeWidth={2} dot={false} />
              <Line name="WY" type="monotone" dataKey="ay" stroke="#8b5cf6" isAnimationActive={false} strokeWidth={2} dot={false} />
              <Line name="WZ" type="monotone" dataKey="az" stroke="#10b981" isAnimationActive={false} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Temperature Chart */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Joint Temperatures</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {robotState.joints.map(joint => (
            <div key={joint.id} className="p-4 bg-input rounded-lg">
              <div className="text-sm font-medium text-muted-foreground mb-2">{joint.name}</div>
              <div className="text-2xl font-bold">{joint.temperature.toFixed(1)}°C</div>
              <div className="mt-3 h-2 bg-background rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${Math.min((joint.temperature / 80) * 100, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Torque Chart */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Joint Torques</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {robotState.joints.map(joint => (
            <div key={joint.id} className="p-4 bg-input rounded-lg">
              <div className="text-sm font-medium text-muted-foreground mb-2">{joint.name}</div>
              <div className="text-2xl font-bold">{joint.torque.toFixed(1)} N·m</div>
              <div className="mt-3 h-2 bg-background rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min((joint.torque / 150) * 100, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
