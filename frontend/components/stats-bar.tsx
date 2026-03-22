'use client';

import React from 'react';
import { useRobotState } from '@/hooks/use-robot-state';

export function StatsBar() {
  const { stats } = useRobotState();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
      <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-[#060606]/40 p-4 shadow-xl backdrop-blur-xl ring-1 ring-white/5 transition-all duration-300 hover:ring-white/10 hover:-translate-y-0.5">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100 mix-blend-screen pointer-events-none" />
        <div className="relative z-10">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Trajectories</div>
          <div className="bg-gradient-to-br from-cyan-300 to-cyan-600 bg-clip-text text-3xl font-extrabold text-transparent drop-shadow-sm">
            {stats.totalTrajectories}
          </div>
        </div>
      </div>
      <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-[#060606]/40 p-4 shadow-xl backdrop-blur-xl ring-1 ring-white/5 transition-all duration-300 hover:ring-white/10 hover:-translate-y-0.5">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100 mix-blend-screen pointer-events-none" />
        <div className="relative z-10">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Success</div>
          <div className="bg-gradient-to-br from-emerald-300 to-emerald-600 bg-clip-text text-3xl font-extrabold text-transparent drop-shadow-sm">
            {stats.successRate}%
          </div>
        </div>
      </div>
      <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-[#060606]/40 p-4 shadow-xl backdrop-blur-xl ring-1 ring-white/5 transition-all duration-300 hover:ring-white/10 hover:-translate-y-0.5">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100 mix-blend-screen pointer-events-none" />
        <div className="relative z-10">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Timesteps</div>
          <div className="bg-gradient-to-br from-cyan-300 to-cyan-600 bg-clip-text text-3xl font-extrabold text-transparent drop-shadow-sm">
            {stats.totalTimesteps.toLocaleString()}
          </div>
        </div>
      </div>
      <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-[#060606]/40 p-4 shadow-xl backdrop-blur-xl ring-1 ring-white/5 transition-all duration-300 hover:ring-white/10 hover:-translate-y-0.5">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100 mix-blend-screen pointer-events-none" />
        <div className="relative z-10">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Unique Cmds</div>
          <div className="bg-gradient-to-br from-violet-300 to-violet-600 bg-clip-text text-3xl font-extrabold text-transparent drop-shadow-sm">
            {stats.uniqueCommands}
          </div>
        </div>
      </div>
    </div>
  );
}
