'use client';

import React from 'react';
import { StatsBar } from '@/components/stats-bar';
import { JointDataStream } from '@/components/joint-data-stream';
import { TrajectoryTable } from '@/components/trajectory-table';
import { ExportControls } from '@/components/export-controls';

export function DatasetPanel() {
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Stats Bar */}
      <StatsBar />

      {/* Joint Data Stream */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <JointDataStream />
      </div>

      {/* Trajectory Table */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <TrajectoryTable />
      </div>

      {/* Export Controls */}
      <ExportControls />
    </div>
  );
}
