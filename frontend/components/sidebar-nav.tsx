'use client';

import React from 'react';
import { BarChart3, Zap, Database, Settings, Activity } from 'lucide-react';
import { useRobotState } from '@/hooks/use-robot-state';
import { cn } from '@/lib/utils';

export function SidebarNav() {
  const { activeTab, setActiveTab, sidebarCollapsed } = useRobotState();

  const navItems = [
    {
      id: 'monitor',
      label: 'Monitor',
      icon: Activity,
      description: 'Real-time policy analytics',
    },
    {
      id: 'control',
      label: 'Control',
      icon: Zap,
      description: 'Episode & command bridge',
    },
    {
      id: 'chart',
      label: 'Charts',
      icon: BarChart3,
      description: 'Telemetry charts',
    },
    {
      id: 'datasets',
      label: 'Datasets',
      icon: Database,
      description: 'Trajectory data repository',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      description: 'Configuration',
    },
  ];

  return (
    <nav className="flex h-full flex-col">
      {/* Logo/Brand */}
      <div className="flex-shrink-0 border-b border-white/5 px-5 py-6">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 shadow-[0_4px_15px_rgba(6,182,212,0.4)]">
            <Activity className="h-5 w-5 text-white drop-shadow-md" />
          </div>
          {!sidebarCollapsed && (
            <div>
              <h1 className="text-[15px] font-black tracking-wider text-white drop-shadow-sm uppercase">RoboScribe</h1>
              <p className="text-[10px] font-bold text-cyan-300 uppercase tracking-widest mt-0.5">Research & Analytics</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Items */}
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-5 custom-scrollbar">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                'group w-full rounded-xl px-4 py-3.5 transition-all duration-300 relative overflow-hidden',
                'flex items-center gap-4 border',
                isActive
                  ? 'border-cyan-400/30 bg-gradient-to-r from-cyan-500/20 to-violet-500/10 text-white shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                  : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white'
              )}
              title={sidebarCollapsed ? item.label : undefined}
            >
              {isActive && <div className="absolute inset-y-0 left-0 w-1 bg-cyan-400 rounded-r shadow-[0_0_10px_rgba(34,211,238,0.8)]" />}
              <Icon className={cn('h-5 w-5 flex-shrink-0 transition-all duration-300', isActive ? 'text-cyan-300 scale-110 drop-shadow-[0_0_8px_rgba(103,232,249,0.5)]' : 'group-hover:text-slate-300 group-hover:scale-105')} />
              {!sidebarCollapsed && (
                <div className="text-left flex-1">
                  <div className={cn("text-xs font-bold uppercase tracking-wider", isActive ? 'text-white' : 'group-hover:text-white')}>{item.label}</div>
                  <div className={cn("text-[10px] font-medium tracking-wide mt-0.5", isActive ? 'text-cyan-100/70' : 'text-slate-500 group-hover:text-slate-400')}>{item.description}</div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-white/5 px-5 py-5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center justify-between">
          {!sidebarCollapsed && <span>RoboScribe Core</span>}
          <span className="text-slate-400">v1.0</span>
        </div>
      </div>
    </nav>
  );
}
