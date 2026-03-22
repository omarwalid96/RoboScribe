'use client';

import React from 'react';
import './voice-status-block.css';

interface VoiceStatusBlockProps {
  state: 'idle' | 'speaking' | 'awaiting_confirmation' | 'confirmed' | 'rejected' | 'processing';
  onConfirm: (confirmed: boolean) => void;
  spokenText?: string;
  isProcessing?: boolean;
}

export function VoiceStatusBlock({ state, onConfirm, spokenText }: VoiceStatusBlockProps) {
  const stateConfig = {
    idle: { label: 'Voice Ready', color: 'text-violet-300', dotClass: 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.6)]' },
    speaking: { label: 'Speaking', color: 'text-violet-300', dotClass: 'bg-violet-400 animate-pulse shadow-[0_0_12px_rgba(167,139,250,0.8)]' },
    processing: { label: 'Processing', color: 'text-sky-300', dotClass: 'bg-sky-400 animate-pulse shadow-[0_0_12px_rgba(56,189,248,0.8)]' },
    awaiting_confirmation: { label: 'Awaiting Confirmation', color: 'text-amber-300', dotClass: 'bg-amber-400 animate-pulse shadow-[0_0_12px_rgba(251,191,36,0.8)]' },
    confirmed: { label: 'Confirmed', color: 'text-emerald-300', dotClass: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' },
    rejected: { label: 'Cancelled', color: 'text-red-300', dotClass: 'bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]' },
  };

  const config = stateConfig[state];

  return (
    <div className="rounded-2xl border border-white/5 bg-[#060606]/40 p-4 shadow-xl backdrop-blur-xl md:p-5 ring-1 ring-white/5 transition-all duration-300 hover:ring-white/10 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
      <div className="relative z-10">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${config.dotClass}`} />
            <span className={`text-xs font-bold uppercase tracking-widest ${config.color}`}>{config.label}</span>
          </div>
          <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-violet-300">
            Voice
          </span>
        </div>

        {/* Waveform Animation */}
        {(state === 'speaking' || state === 'awaiting_confirmation' || state === 'processing') && (
          <div className="flex items-end justify-center gap-1.5 h-10 mb-4 bg-[#060606]/40 rounded-xl border border-white/5 py-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="waveform-bar bg-violet-400 rounded-sm shadow-[0_0_8px_rgba(167,139,250,0.5)]"
                style={{ '--delay': `${i * 100}ms` } as React.CSSProperties}
              />
            ))}
          </div>
        )}

        {/* Spoken Text or Processing Message */}
        {(spokenText || state === 'processing') && (state === 'speaking' || state === 'awaiting_confirmation' || state === 'processing') && (
          <div className="mb-4 rounded-xl border border-white/10 bg-[#060606]/60 px-4 py-3.5 text-sm font-medium italic text-slate-300 shadow-inner">
            {state === 'processing' ? "Analyzing command..." : `"${spokenText}"`}
          </div>
        )}

        {/* Confirmation Buttons */}
        {state === 'awaiting_confirmation' && (
          <div className="flex gap-3">
            <button
              onClick={() => onConfirm(true)}
              className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-xs font-bold uppercase tracking-widest text-emerald-300 transition-all hover:-translate-y-0.5 hover:bg-emerald-500/20 hover:border-emerald-400 hover:text-white hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]"
            >
              Yes, Proceed
            </button>
            <button
              onClick={() => onConfirm(false)}
              className="flex-1 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-xs font-bold uppercase tracking-widest text-red-300 transition-all hover:-translate-y-0.5 hover:bg-red-500/20 hover:border-red-400 hover:text-white hover:shadow-[0_0_15px_rgba(239,68,68,0.2)]"
            >
              Cancel
            </button>
          </div>
        )}

        {state === 'confirmed' && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-3 text-center text-xs font-bold uppercase tracking-widest text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
            Command confirmed
          </div>
        )}

        {state === 'rejected' && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 py-3 text-center text-xs font-bold uppercase tracking-widest text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
            Command cancelled
          </div>
        )}
      </div>
    </div>
  );
}
