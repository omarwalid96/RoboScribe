'use client';

import React from 'react';
import { useRobotState } from '@/hooks/use-robot-state';

function BearingArrow({ bearing }: { bearing: number }) {
  // bearing: -1.0 (far left) ... 0 (center) ... +1.0 (far right)
  const clampedBearing = Math.max(-1, Math.min(1, bearing));
  const rotation = clampedBearing * 60; // ±60° visual tilt

  let label = 'CENTER';
  let color = 'text-cyan-400';
  if (clampedBearing < -0.15) { label = 'LEFT'; color = 'text-yellow-400'; }
  else if (clampedBearing > 0.15) { label = 'RIGHT'; color = 'text-yellow-400'; }

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`text-2xl transition-transform duration-200 ${color}`}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        ↑
      </div>
      <div className={`text-xs font-mono ${color}`}>{label}</div>
    </div>
  );
}

export function NavigationStatus() {
  const { navigationState } = useRobotState();

  if (!navigationState) return null;

  const { target, distance, bearing, detected, arrived } = navigationState;

  if (arrived) {
    return (
      <div className="bg-card border border-green-500/50 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <div className="text-xs text-green-400 font-mono tracking-widest">ARRIVED</div>
        </div>
        <div className="mt-2 text-sm font-mono text-green-300">
          ✓ Reached the {target}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <div className="text-xs text-muted-foreground tracking-widest">NAVIGATING</div>
        </div>
        <div className="text-xs font-mono text-cyan-400 uppercase">{target}</div>
      </div>

      {/* Detection status */}
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-1.5 h-1.5 rounded-full ${detected ? 'bg-green-400' : 'bg-yellow-400'}`} />
        <span className="text-xs font-mono text-muted-foreground">
          {detected ? 'Target acquired' : 'Searching…'}
        </span>
      </div>

      {detected && (
        <div className="grid grid-cols-2 gap-3">
          {/* Distance */}
          <div className="bg-input border border-border rounded p-2">
            <div className="text-xs text-muted-foreground font-mono mb-1">DISTANCE</div>
            <div className="text-cyan-400 font-mono font-bold text-lg">
              {distance !== undefined ? `${distance.toFixed(1)}m` : '—'}
            </div>
            {distance !== undefined && distance < 1.5 && (
              <div className="text-xs text-green-400 font-mono mt-0.5">almost there</div>
            )}
          </div>

          {/* Bearing */}
          <div className="bg-input border border-border rounded p-2 flex flex-col items-center justify-center">
            <div className="text-xs text-muted-foreground font-mono mb-1">BEARING</div>
            {bearing !== undefined ? (
              <BearingArrow bearing={bearing} />
            ) : (
              <div className="text-cyan-400 font-mono">—</div>
            )}
          </div>
        </div>
      )}

      {/* Progress bar — distance based (0-5m range) */}
      {detected && distance !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 bg-input rounded-full overflow-hidden border border-border">
            <div
              className="h-full bg-cyan-400 rounded-full transition-all duration-300 shadow-sm shadow-cyan-400/50"
              style={{ width: `${Math.max(0, Math.min(100, (1 - distance / 5) * 100))}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-mono text-muted-foreground mt-1">
            <span>5m</span>
            <span>0m</span>
          </div>
        </div>
      )}
    </div>
  );
}
