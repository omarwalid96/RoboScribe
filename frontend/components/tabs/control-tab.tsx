'use client';

import React, { useState } from 'react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { JOINTS } from '@/lib/constants';

export function ControlTab() {
  const { moveToAngles, presets, moveToPreset } = useRobotState();
  const [angles, setAngles] = useState<number[]>(JOINTS.map(() => 0));

  const handleSliderChange = (index: number, value: number) => {
    const newAngles = [...angles];
    newAngles[index] = value;
    setAngles(newAngles);
  };

  const handleMoveToTarget = () => {
    moveToAngles(angles);
  };

  return (
    <div className="space-y-6">
      {/* Presets */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Motion Presets</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map(preset => (
            <Card
              key={preset.id}
              className="p-4 cursor-pointer hover:bg-card/80 transition-colors"
              onClick={() => moveToPreset(preset.id)}
            >
              <h3 className="font-semibold text-sm">{preset.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">{preset.description}</p>
              <div className="mt-3">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => moveToPreset(preset.id)}
                >
                  Move to Preset
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Joint Sliders */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Joint Control</h2>
        <Card className="p-6">
          <div className="space-y-6">
            {JOINTS.map((joint, index) => (
              <div key={joint.id} className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">{joint.name}</label>
                  <span className="text-sm font-mono text-primary">
                    {angles[index].toFixed(0)}°
                  </span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={angles[index]}
                  onChange={(e) => handleSliderChange(index, Number(e.target.value))}
                  className="w-full h-2 bg-input rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>
            ))}

            <div className="pt-4 flex gap-3">
              <Button onClick={handleMoveToTarget} className="flex-1">
                Move to Target
              </Button>
              <Button
                variant="outline"
                onClick={() => setAngles(JOINTS.map(() => 0))}
                className="flex-1"
              >
                Home
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
