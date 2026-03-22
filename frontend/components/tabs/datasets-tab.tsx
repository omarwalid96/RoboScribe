'use client';

import React, { useState } from 'react';
import { useRobotState } from '@/hooks/use-robot-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Save, Trash2 } from 'lucide-react';

export function DatasetsTab() {
  const { datasets, isRecording, startRecording, stopRecording, saveDataset } = useRobotState();
  const [recordingName, setRecordingName] = useState('');
  const [recordingDescription, setRecordingDescription] = useState('');

  const handleStopAndSave = () => {
    if (recordingName) {
      saveDataset(recordingName, recordingDescription);
      setRecordingName('');
      setRecordingDescription('');
    } else {
      stopRecording();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6">
      {/* Recording Controls */}
      <Card className="p-6 bg-card border-primary/20">
        <h2 className="text-lg font-semibold mb-4">Recording Controls</h2>

        {!isRecording ? (
          <Button
            onClick={startRecording}
            className="w-full bg-primary hover:bg-primary/90"
            size="lg"
          >
            <Play className="h-4 w-4 mr-2" />
            Start Recording
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-4 bg-destructive/20 rounded-lg border border-destructive/30">
              <div className="h-2 w-2 bg-destructive rounded-full animate-pulse" />
              <span className="text-sm font-medium">Recording in progress...</span>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Dataset Name"
                value={recordingName}
                onChange={(e) => setRecordingName(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm"
              />
              <textarea
                placeholder="Description (optional)"
                value={recordingDescription}
                onChange={(e) => setRecordingDescription(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm resize-none h-20"
              />
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleStopAndSave}
                variant="destructive"
                className="flex-1"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop & Save
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Datasets List */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Datasets ({datasets.length})
        </h2>

        {datasets.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">No datasets yet. Start a recording to create one.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {datasets.map(dataset => (
              <Card key={dataset.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold">{dataset.name}</h3>
                      <Badge
                        className={
                          dataset.status === 'recording'
                            ? 'bg-destructive/20 text-destructive border-destructive/30'
                            : dataset.status === 'completed'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                        }
                      >
                        {dataset.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{dataset.description}</p>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Frames:</span>
                        <div className="font-mono font-bold text-primary">{dataset.frames}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Duration:</span>
                        <div className="font-mono font-bold text-accent">
                          {formatTime(dataset.duration)}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Type:</span>
                        <div className="font-mono font-bold capitalize text-purple-400">
                          {dataset.recordingType}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Created:</span>
                        <div className="font-mono font-bold text-slate-400">
                          {dataset.id.substring(0, 8)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-4 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
