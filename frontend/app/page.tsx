'use client';

import React from 'react';
import { RobotProvider } from '@/context/robot-context';
import { DashboardHeader } from '@/components/dashboard-header';
import { SidebarNav } from '@/components/sidebar-nav';
import { MonitorTab } from '@/components/tabs/monitor-tab';
import { ControlTab } from '@/components/tabs/control-tab';
import { ChartTab } from '@/components/tabs/chart-tab';
import { DatasetsTab } from '@/components/tabs/datasets-tab';
import { SettingsTab } from '@/components/tabs/settings-tab';
import { CommandPanel } from '@/components/command-panel';
import { DatasetPanel } from '@/components/dataset-panel';
import { SplineSceneBasic } from '@/components/ui/demo';
import { useRobotState } from '@/hooks/use-robot-state';

function DashboardContent() {
  const { activeTab, setActiveTab } = useRobotState();

  // Command-first layout: Show command panel + dataset panel as primary interface
  if (activeTab === 'monitor') {
    return (
      <main className="flex flex-1 flex-col gap-5 overflow-hidden p-5 md:gap-6 md:p-6">
        <SplineSceneBasic />
        <div className="flex min-h-0 flex-1 gap-5 md:gap-6">
          {/* Command Panel - Left 45% */}
          <div className="flex w-[45%] flex-col">
            <CommandPanel />
          </div>

          {/* Dataset Panel - Right 55% */}
          <div className="flex w-[55%] flex-col overflow-hidden">
            <DatasetPanel />
          </div>
        </div>
      </main>
    );
  }

  // Other tabs use traditional view
  const renderTabContent = () => {
    switch (activeTab) {
      case 'control':
        return <ControlTab />;
      case 'chart':
        return <ChartTab />;
      case 'datasets':
        return <DatasetsTab />;
      case 'settings':
        return <SettingsTab />;
      default:
        return <MonitorTab />;
    }
  };

  return (
    <main className="flex-1 space-y-6 overflow-y-auto p-5 md:p-6">
      {renderTabContent()}
    </main>
  );
}

function DashboardLayout() {
  const { sidebarCollapsed } = useRobotState();

  return (
    <div className="relative flex h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute right-0 top-24 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>
      {/* Sidebar Navigation */}
      <aside className={`z-20 flex-shrink-0 overflow-y-auto overflow-x-hidden border-r border-white/5 bg-[#060606]/40 backdrop-blur-3xl shadow-[4px_0_24px_rgba(0,0,0,0.5)] transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-[88px]' : 'w-64'}`}>
        <SidebarNav />
      </aside>

      {/* Main Content Area */}
      <div className="z-10 flex flex-1 flex-col overflow-hidden transition-all duration-300 min-w-0">
        <DashboardHeader />
        <DashboardContent />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <RobotProvider>
      <DashboardLayout />
    </RobotProvider>
  );
}
