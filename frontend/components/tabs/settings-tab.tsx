'use client';

import React, { useState } from 'react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export function SettingsTab() {
  const { config, updateConfig, clearAlerts } = useRobotState();
  const [tempThreshold, setTempThreshold] = useState(config.temperatureThreshold);
  const [torqueThreshold, setTorqueThreshold] = useState(config.torqueThreshold);
  const [velocityThreshold, setVelocityThreshold] = useState(config.velocityThreshold);
  const [safetyMode, setSafetyMode] = useState(config.safetyMode);
  const [autoRecovery, setAutoRecovery] = useState(config.autoRecovery);

  const handleSave = () => {
    updateConfig({
      temperatureThreshold: tempThreshold,
      torqueThreshold: torqueThreshold,
      velocityThreshold: velocityThreshold,
      safetyMode: safetyMode,
      autoRecovery: autoRecovery,
    });
  };

  return (
    <div className="space-y-6">
      {/* System Configuration */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-6">System Configuration</h2>

        <div className="space-y-6">
          {/* Temperature Threshold */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Temperature Threshold</label>
              <span className="text-sm font-mono text-primary">{tempThreshold}°C</span>
            </div>
            <input
              type="range"
              min="40"
              max="90"
              value={tempThreshold}
              onChange={(e) => setTempThreshold(Number(e.target.value))}
              className="w-full h-2 bg-input rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Alert when joint temperature exceeds this value
            </p>
          </div>

          {/* Torque Threshold */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Torque Threshold</label>
              <span className="text-sm font-mono text-primary">{torqueThreshold} N·m</span>
            </div>
            <input
              type="range"
              min="80"
              max="150"
              value={torqueThreshold}
              onChange={(e) => setTorqueThreshold(Number(e.target.value))}
              className="w-full h-2 bg-input rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Alert when joint torque exceeds this value
            </p>
          </div>

          {/* Velocity Threshold */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Velocity Threshold</label>
              <span className="text-sm font-mono text-primary">{velocityThreshold}°/s</span>
            </div>
            <input
              type="range"
              min="100"
              max="200"
              value={velocityThreshold}
              onChange={(e) => setVelocityThreshold(Number(e.target.value))}
              className="w-full h-2 bg-input rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Alert when joint velocity exceeds this value
            </p>
          </div>

          {/* Safety Mode Toggle */}
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <label className="text-sm font-medium">Safety Mode</label>
            <button
              onClick={() => setSafetyMode(!safetyMode)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                safetyMode ? 'bg-accent' : 'bg-input'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                  safetyMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Auto Recovery Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Auto Recovery</label>
            <button
              onClick={() => setAutoRecovery(!autoRecovery)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoRecovery ? 'bg-accent' : 'bg-input'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                  autoRecovery ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <Button onClick={handleSave} className="w-full mt-6">
            Save Configuration
          </Button>
        </div>
      </Card>

      {/* System Health */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">System Health</h2>

        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <div className="w-3 h-3 bg-emerald-500 rounded-full" />
            <span className="text-sm">All systems operational</span>
          </div>

          <Button onClick={clearAlerts} variant="outline" className="w-full">
            Clear All Alerts
          </Button>
        </div>
      </Card>

      {/* About */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">About</h2>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Application</span>
            <span className="font-mono">RoboScribe Control</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Robot Model</span>
            <span className="font-mono">H1</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Uptime</span>
            <span className="font-mono">120h 45m</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
