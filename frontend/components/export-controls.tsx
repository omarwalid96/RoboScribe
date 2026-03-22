'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { robotApi } from '@/lib/api-client';

const FORMATS = [
  { id: 'json' as const, label: '📄 JSON' },
  { id: 'csv'  as const, label: '📊 CSV'  },
  { id: 'hdf5' as const, label: '🗂 HDF5'  },
];

export function ExportControls() {
  const [exportFormat, setExportFormat] = useState<'json' | 'csv' | 'hdf5'>('json');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      await robotApi.exportTrajectories(exportFormat);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-[#060606]/40 p-5 shadow-xl backdrop-blur-xl ring-1 ring-white/5 relative overflow-hidden transition-all duration-300 hover:ring-white/10 group">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative z-10">
        <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-400 drop-shadow-md">
            Export Dataset
          </div>
        </div>

        <div className="flex gap-3 mb-4">
          {FORMATS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setExportFormat(id)}
              className={`flex-1 px-3 py-2.5 rounded-xl font-mono text-[11px] font-bold uppercase tracking-widest transition-all duration-300 ${
                exportFormat === id
                  ? 'bg-violet-500/10 border-2 border-violet-500/50 text-violet-300 shadow-[0_0_15px_rgba(139,92,246,0.15)] -translate-y-0.5'
                  : 'border-2 border-white/5 bg-black/20 text-slate-500 hover:border-violet-500/30 hover:bg-white/5 hover:text-violet-400'
              }`}
            >
              <span className="opacity-80 mr-1">{label.split(' ')[0]}</span>
              {label.split(' ')[1]}
            </button>
          ))}
        </div>

        {exportError && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-300 shadow-inner">
            {exportError}
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3.5 text-[11px] font-black uppercase tracking-[0.2em] text-white shadow-[0_4px_15px_rgba(139,92,246,0.3)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_6px_25px_rgba(139,92,246,0.4)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 flex items-center justify-center gap-2"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] hover:animate-[shimmer_1.5s_infinite]" />
          <Download className={`h-4 w-4 ${isExporting ? 'animate-bounce' : ''}`} />
          {isExporting ? 'EXPORTING DATA...' : 'EXPORT DATASET'}
        </button>
      </div>
    </div>
  );
}
