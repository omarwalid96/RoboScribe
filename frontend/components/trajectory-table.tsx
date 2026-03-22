'use client';

import React from 'react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ValidationData {
  overall_accuracy: number | null;
  distance_accuracy: number | null;
  duration_accuracy: number | null;
  heading_drift_deg: number | null;
  lateral_drift_m: number | null;
  commanded_distance_m: number | null;
  actual_distance_m: number | null;
  commanded_duration_s: number | null;
  actual_duration_s: number | null;
}

function AccuracyCell({ validation }: { validation: ValidationData | null }) {
  if (!validation || validation.overall_accuracy === null) {
    return <div className="text-right text-slate-500 font-bold">—</div>;
  }

  const pct = validation.overall_accuracy;
  const color = pct >= 90 ? 'text-emerald-400' : pct >= 70 ? 'text-amber-400' : 'text-red-400';
  const shadow = pct >= 90 ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]' : pct >= 70 ? 'drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]' : 'drop-shadow-[0_0_8px_rgba(248,113,113,0.4)]';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`text-right cursor-help font-bold ${color} ${shadow}`}>
            {pct}%
          </div>
        </TooltipTrigger>
        <TooltipContent className="font-mono text-xs space-y-2 p-4 max-w-[240px] bg-[#060606]/95 border-white/10 text-white backdrop-blur-xl rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.8)]">
          <div className="font-black text-sky-400 uppercase tracking-widest mb-2 border-b border-white/10 pb-2">Execution Accuracy</div>
          {validation.distance_accuracy !== null && (
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 uppercase tracking-wider text-[10px]">Distance</span>
              <span className="font-bold text-sky-300">{validation.distance_accuracy}%</span>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <span className="text-slate-400 uppercase tracking-wider text-[10px]">Duration</span>
            <span className="font-bold text-sky-300">{validation.duration_accuracy}%</span>
          </div>
          {validation.heading_drift_deg !== null && (
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 uppercase tracking-wider text-[10px]">Heading drift</span>
              <span className="font-bold text-amber-300">{validation.heading_drift_deg > 0 ? '+' : ''}{validation.heading_drift_deg}°</span>
            </div>
          )}
          {validation.lateral_drift_m !== null && (
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 uppercase tracking-wider text-[10px]">Lateral drift</span>
              <span className="font-bold text-amber-300">{validation.lateral_drift_m > 0 ? '+' : ''}{validation.lateral_drift_m}m</span>
            </div>
          )}
          <div className="border-t border-white/10 mt-2 pt-2">
            {validation.commanded_distance_m !== null && (
              <div className="flex justify-between gap-4">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">Dist cmd/act</span>
                <span className="font-bold text-emerald-300">{validation.commanded_distance_m}m / {validation.actual_distance_m}m</span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 uppercase tracking-wider text-[10px]">Time cmd/act</span>
              <span className="font-bold text-emerald-300">{validation.commanded_duration_s}s / {validation.actual_duration_s}s</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function TrajectoryTable() {
  const { trajectories } = useRobotState();

  const rows = trajectories.map((t, idx) => {
    const traj = t as unknown as Record<string, unknown>;
    return {
      id: idx + 1,
      command: (traj._command as string) || t.name || '',
      timestamp: (traj._timestamp as string) || new Date(t.createdAt).toISOString(),
      steps: (traj._steps as number) || 0,
      duration: (traj._duration as number) || t.duration || 0,
      outcome: ((traj._outcome as string) || 'success') as 'success' | 'failed',
      distance: (traj._distance as number) || 0,
      validation: (traj._validation as ValidationData) || null,
    };
  });

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/5 bg-[#060606]/40 p-5 shadow-xl backdrop-blur-xl ring-1 ring-white/5 transition-all duration-300 hover:ring-white/10 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-sky-500/5 to-transparent pointer-events-none" />
      <div className="relative z-10 flex flex-col h-full">
        <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-400 drop-shadow-md">
            Trajectory History
          </div>
          <span className="rounded-full border border-slate-500/30 bg-white/5 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-slate-300">
            {rows.length} Trajectories
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="rounded-full border border-white/5 bg-white/5 p-4 mb-3 shadow-inner">
              <div className="h-5 w-5 rounded-md border-2 border-slate-600/50 border-dashed"></div>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 max-w-[200px]">
              No trajectories recorded. Send a command to start collecting data.
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            <div className="font-mono text-xs space-y-1">
              <div className="grid grid-cols-7 gap-2 sticky top-0 bg-[#060606]/80 backdrop-blur-md pb-2 pt-1 border-b border-white/5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 z-10 text-right">
                <div className="text-left">#</div>
                <div className="text-left col-span-2">COMMAND</div>
                <div>STEPS</div>
                <div>DURATION</div>
                <div>DISTANCE</div>
                <div>ACCURACY</div>
              </div>

              {rows.map((traj) => (
                <div key={traj.id} className="grid grid-cols-7 gap-2 py-2.5 border-b border-white/5 hover:bg-white/[0.04] transition-colors text-xs group">
                  <div className="text-slate-500 font-bold ml-1">{traj.id}</div>
                  <div className="text-sky-300 font-medium truncate col-span-2 group-hover:text-white transition-colors">&quot;{traj.command}&quot;</div>
                  <div className="text-right text-slate-300 font-mono">{traj.steps}</div>
                  <div className="text-right text-slate-300 font-mono">{traj.duration.toFixed(2)}s</div>
                  <div className="text-right text-slate-300 font-mono">{traj.distance.toFixed(2)}m</div>
                  <AccuracyCell validation={traj.validation} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
