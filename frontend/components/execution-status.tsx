'use client';

import React from 'react';
import { useRobotState } from '@/hooks/use-robot-state';

export function ExecutionStatus() {
  const { executionProgress, robotStatus } = useRobotState();

  if (!executionProgress || robotStatus !== 'executing') return null;

  const { commandText, currentStep, totalSteps, distance } = executionProgress;
  const progress = totalSteps > 0 ? Math.min((currentStep / totalSteps) * 100, 100) : 0;
  
  // Estimate time based on 200Hz update rate (Isaac Sim bridge default)
  const elapsedTime = currentStep / 200;
  const totalTime = totalSteps / 200;

  return (
    <div className="rounded-2xl border border-white/5 bg-[#060606]/40 p-4 shadow-xl backdrop-blur-xl md:p-5 ring-1 ring-white/5 relative overflow-hidden group transition-all duration-300 hover:ring-white/10">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent pointer-events-none" />
      
      <div className="relative z-10">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
            <span className="text-xs font-bold uppercase tracking-widest text-cyan-300">Executing</span>
          </div>
          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-cyan-300">
            Live Pulse
          </span>
        </div>

        <div className="mb-4 rounded-xl border border-white/10 bg-[#060606]/60 px-4 py-3.5 text-sm font-bold italic text-white shadow-inner">
          "{commandText || 'Active Trajectory'}"
        </div>

        {/* Progress Bar */}
        <div className="mb-5">
          <div className="flex justify-between items-end mb-2 px-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Completion</span>
            <span className="text-xs font-mono font-bold text-cyan-400">{progress.toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full bg-[#060606]/60 rounded-full border border-white/5 p-0.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/5 bg-[#060606]/40 p-3 text-center transition-all hover:bg-[#060606]/60">
            <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1">Distance</div>
            <div className="text-sm font-mono font-bold text-cyan-300">{distance.toFixed(2)}m</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-[#060606]/40 p-3 text-center transition-all hover:bg-[#060606]/60">
            <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1">Time</div>
            <div className="text-sm font-mono font-bold text-cyan-300">{elapsedTime.toFixed(1)}s / {totalTime.toFixed(1)}s</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-[#060606]/40 p-3 text-center transition-all hover:bg-[#060606]/60">
            <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1">Steps</div>
            <div className="text-sm font-mono font-bold text-cyan-300">{currentStep} / {totalSteps}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
