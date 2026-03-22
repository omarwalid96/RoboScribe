'use client';

import React from 'react';
import { Menu, Wifi, AlertCircle, Clock, Play, Square } from 'lucide-react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Button } from '@/components/ui/button';

export function DashboardHeader() {
  const { robotState, toggleSidebar, alerts, clearAlerts, isRecording, startRecording, stopRecording, setActiveTab } = useRobotState();

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const criticalAlerts = alerts.filter(a => a.level === 'critical' && !a.resolved);

  return (
    <header className="flex h-[72px] items-center justify-between border-b border-white/5 bg-[#060606]/40 px-6 py-4 backdrop-blur-xl shadow-sm z-20 transition-all duration-300 relative">
      <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent shadow-[0_0_15px_rgba(255,255,255,0.1)]" />
      <div className="flex items-center gap-5">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="text-slate-400 hover:bg-white/[0.04] hover:text-white border border-transparent hover:border-white/5"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-3 rounded-full border border-white/5 bg-white/[0.02] px-4 py-2 shadow-inner backdrop-blur-md">
          <div className={`h-2.5 w-2.5 rounded-full shadow-[0_0_10px_currentColor] animate-pulse ${robotState?.status === 'connected' ? 'bg-emerald-400 text-emerald-400' : 'bg-red-400 text-red-400'}`} />
          <span className="text-[11px] font-black uppercase tracking-widest text-white drop-shadow-sm">
            {robotState?.name || 'Unitree H1 Core'} <span className="text-slate-500 mx-2">/</span> <span className={robotState?.status === 'connected' ? 'text-emerald-400' : 'text-red-400'}>{robotState?.status === 'connected' ? 'Connected' : 'Disconnected'}</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Recording Controls */}
        <div className="flex items-center gap-3 border-r border-white/5 pr-5">
          {!isRecording ? (
            <Button
              size="sm"
              variant="outline"
              onClick={startRecording}
              className="gap-2 border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold uppercase tracking-widest text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:bg-emerald-500/20 hover:border-emerald-400 hover:text-white"
            >
              <Play className="h-3.5 w-3.5 fill-emerald-300/50" />
              Start Recording
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                stopRecording();
                setActiveTab('datasets');
              }}
              className="gap-2 border-red-500/30 bg-red-500/10 text-[10px] font-bold uppercase tracking-widest text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.1)] hover:bg-red-500/20 hover:border-red-400 hover:text-white"
            >
              <Square className="h-3.5 w-3.5 fill-red-300/50" />
              Stop Recording
            </Button>
          )}
        </div>

        {/* Uptime */}
        {robotState && (
          <div className="flex items-center gap-2.5 rounded-full border border-white/5 bg-white/[0.02] px-4 py-2 shadow-inner backdrop-blur-md">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Uptime: <span className="text-white drop-shadow-sm ml-1">{formatUptime(robotState.uptime)}</span>
            </span>
          </div>
        )}

        {/* Alert Badge */}
        {criticalAlerts.length > 0 && (
          <button
            onClick={clearAlerts}
            className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-red-400 font-bold transition-colors hover:bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.15)] hover:shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-pulse"
          >
            <AlertCircle className="h-4 w-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">{criticalAlerts.length} Alert{criticalAlerts.length !== 1 ? 's' : ''}</span>
          </button>
        )}

        {/* Connection Status */}
        <div className="flex items-center gap-2.5 rounded-full border border-white/5 bg-white/[0.02] px-4 py-2 shadow-inner backdrop-blur-md">
          <Wifi
            className={`h-4 w-4 drop-shadow-[0_0_8px_currentColor] ${
              robotState?.status === 'connected'
                ? 'text-sky-400'
                : 'text-red-400'
            }`}
          />
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
            {robotState?.status === 'connected' ? 'Online' : 'Offline'}
          </span>
        </div>

        {/* Session ID */}
        <div className="rounded-full border border-white/5 bg-white/[0.02] px-4 py-2 text-[10px] font-black tracking-[0.2em] text-cyan-500 shadow-inner backdrop-blur-md">
          SESSION: <span className="text-white">ABC-1234</span>
        </div>
      </div>
    </header>
  );
}
