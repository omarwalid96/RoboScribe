'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { SystemAlert } from '@/lib/types';

function getAlertStyles(level: string) {
  switch (level) {
    case 'critical':
      return 'bg-red-500/10 border-red-500/20 text-red-100';
    case 'warning':
      return 'bg-amber-500/10 border-amber-500/20 text-amber-100';
    case 'info':
      return 'bg-blue-500/10 border-blue-500/20 text-blue-100';
    default:
      return 'bg-slate-500/10 border-slate-500/20 text-slate-100';
  }
}

function getAlertIcon(level: string) {
  switch (level) {
    case 'critical':
      return <AlertCircle className="h-5 w-5 flex-shrink-0" />;
    case 'warning':
      return <AlertTriangle className="h-5 w-5 flex-shrink-0" />;
    case 'info':
      return <Info className="h-5 w-5 flex-shrink-0" />;
    default:
      return <AlertCircle className="h-5 w-5 flex-shrink-0" />;
  }
}

export function AlertPanel() {
  const { alerts, resolveAlert } = useRobotState();
  const unresolved = alerts.filter(a => !a.resolved);

  if (unresolved.length === 0) {
    return (
      <Card className="p-6 bg-emerald-500/10 border-emerald-500/20">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-emerald-500 rounded-full" />
          <span className="text-sm text-emerald-100">All systems operational</span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {unresolved.map(alert => (
        <Card
          key={alert.id}
          className={`p-4 border flex items-start gap-3 group hover:shadow-lg transition-all ${getAlertStyles(alert.level)}`}
        >
          {getAlertIcon(alert.level)}
          <div className="flex-1">
            <h4 className="font-semibold text-sm capitalize">{alert.level} Alert</h4>
            <p className="text-sm mt-1">{alert.message}</p>
            <div className="text-xs opacity-75 mt-2">
              {alert.id.substring(0, 8)}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => resolveAlert(alert.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" />
          </Button>
        </Card>
      ))}
    </div>
  );
}
