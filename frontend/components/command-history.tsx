'use client';

import React from 'react';

interface Command {
  id: string;
  text: string;
  timestamp: string; // ISO string
  duration: number;
  status: 'success' | 'failed';
  distance?: number;
}

interface CommandHistoryProps {
  commands: Command[];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

export function CommandHistory({ commands }: CommandHistoryProps) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/5 bg-[#060606]/40 p-4 shadow-xl backdrop-blur-xl md:p-5 ring-1 ring-white/5 transition-all duration-300 hover:ring-white/10 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-sky-500/5 to-transparent pointer-events-none" />
      <div className="relative z-10 flex h-full flex-col">
        <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
          <div className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
            Command History
          </div>
          <span className="rounded-full border border-slate-500/30 bg-white/5 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-slate-300">
            {commands.length} items
          </span>
        </div>
        <div className="flex-1 space-y-2.5 overflow-y-auto pr-2 custom-scrollbar">
          {commands.length === 0 ? (
            <div className="mt-8 flex flex-col items-center justify-center text-center">
              <div className="rounded-full border border-white/5 bg-white/5 p-3 mb-3">
                <div className="h-4 w-4 rounded-full bg-slate-600/50"></div>
              </div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-widest">
                No commands yet
              </div>
            </div>
          ) : (
            commands.map((cmd) => (
              <div
                key={cmd.id}
                className="group cursor-pointer rounded-xl border border-white/5 bg-[#060606]/60 p-3.5 transition-all duration-300 hover:-translate-y-0.5 hover:border-sky-500/30 hover:bg-[#0a0a0f]/80 hover:shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border ${
                    cmd.status === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.2)]' : 'border-red-500/30 bg-red-500/10 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.2)]'
                  }`}>
                    <span className="text-[10px] font-bold">{cmd.status === 'success' ? '✓' : '✗'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium text-slate-200 group-hover:text-white transition-colors">"{cmd.text}"</div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <span>{relativeTime(cmd.timestamp)}</span>
                      <div className="flex items-center gap-3">
                        {cmd.duration > 0 && <span className="text-sky-500/80">{cmd.duration.toFixed(1)}s</span>}
                        {cmd.distance != null && cmd.distance > 0 && <span className="text-emerald-500/80">{cmd.distance.toFixed(2)}m</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
