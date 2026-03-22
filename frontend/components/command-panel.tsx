'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { CommandInput } from '@/components/command-input';
import { VoiceStatusBlock } from '@/components/voice-status-block';
import { ExecutionStatus } from '@/components/execution-status';
import { NavigationStatus } from '@/components/navigation-status';
import { CommandHistory } from '@/components/command-history';
import { useRobotState } from '@/hooks/use-robot-state';
import { voiceApi } from '@/lib/api-client';

interface CommandHistoryItem {
  id: string;
  text: string;
  status: 'success' | 'failed';
  timestamp: string;
  duration: number;
  distance?: number;
}

export function CommandPanel() {
  const {
    sendCommand,
    confirmCommand,
    isUsingMockData,
    pendingCommand,
    robotStatus,
    executionProgress,
    lastResultText,
    trajectories,
    navigationState,
  } = useRobotState();

  // Track commands rejected by user (never reach trajectory_saved)
  const [rejectedCommands, setRejectedCommands] = useState<CommandHistoryItem[]>([]);
  const [currentCommand, setCurrentCommand] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const lastSpokenTextRef = useRef<string | null>(null);

  // Merge successful trajectories + rejected commands into one sorted history
  const commandHistory = useMemo<CommandHistoryItem[]>(() => {
    const fromTrajectories: CommandHistoryItem[] = (trajectories as any[]).map(t => ({
      id: t.id as string,
      text: (t._command as string) || (t.name as string) || '',
      status: (t._outcome as string) === 'success' ? 'success' : 'failed',
      timestamp: (t._timestamp as string) || new Date(t.createdAt as number).toISOString(),
      duration: (t.duration as number) || 0,
      distance: (t._distance as number) || undefined,
    }));
    const all = [...fromTrajectories, ...rejectedCommands];
    // Sort most-recent first by timestamp string (ISO sorts lexicographically)
    return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [trajectories, rejectedCommands]);

  // Derive voice state from backend-driven state
  const voiceState = isProcessing && !pendingCommand
    ? 'processing'
    : pendingCommand
      ? 'awaiting_confirmation'
      : robotStatus === 'executing'
        ? 'confirmed'
        : 'idle';

  const isExecuting = robotStatus === 'executing';

  // Clear processing state when we get a response or state changes
  useEffect(() => {
    if (pendingCommand || robotStatus === 'executing' || robotStatus === 'error') {
      setIsProcessing(false);
    }
  }, [pendingCommand, robotStatus]);

  const handleCommandSubmit = useCallback((command: string) => {
    setCurrentCommand(command);
    setIsProcessing(true);
    sendCommand(command);
    // State transitions are now driven by WebSocket messages:
    // backend will send command_parsed → awaiting_confirmation
  }, [sendCommand]);

  const handleConfirm = useCallback((confirmed: boolean) => {
    if (!pendingCommand) return;

    confirmCommand(pendingCommand.commandId, confirmed);

    if (!confirmed) {
      setRejectedCommands(prev => [...prev, {
        id: pendingCommand.commandId,
        text: currentCommand,
        status: 'failed',
        timestamp: new Date().toISOString(),
        duration: 0,
      }]);
    }
    // If confirmed, execution_started will come from backend,
    // and trajectory_saved / result_text will signal completion
  }, [confirmCommand, pendingCommand, currentCommand]);

  // Track when execution finishes via lastResultText changing
  // (a simple approach — could also listen for status→idle transition)
  useEffect(() => {
    const textToSpeak = pendingCommand?.confirmationText || lastResultText;
    if (!textToSpeak) return;
    if (lastSpokenTextRef.current === textToSpeak) return;

    lastSpokenTextRef.current = textToSpeak;
    let objectUrl: string | null = null;

    const playVoice = async () => {
      try {
        const audioBuffer = await voiceApi.speak(textToSpeak);
        const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        objectUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(objectUrl);
        audio.volume = 1;

        audio.onended = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        };
        audio.onerror = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        };

        await audio.play();
      } catch (error) {
        console.warn('[Voice] ElevenLabs playback failed, falling back to browser TTS:', error);
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(textToSpeak);
          utterance.rate = 1;
          utterance.pitch = 1;
          utterance.volume = 1;
          window.speechSynthesis.speak(utterance);
        }
      }
    };

    void playVoice();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pendingCommand?.confirmationText, lastResultText]);

  const spokenText = pendingCommand?.confirmationText
    || lastResultText
    || 'Awaiting command...';

  return (
    <div className="relative flex h-full flex-col gap-4">
      {/* Mock Data Indicator */}
      {isUsingMockData && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 shadow-sm">
          Using mock data. Simulation active for command parsing and execution.
        </div>
      )}

      {/* Command Input */}
      <CommandInput onSubmit={handleCommandSubmit} disabled={voiceState !== 'idle' && voiceState !== 'processing'} isLoading={isProcessing} />

      {/* Voice Status */}
      <VoiceStatusBlock
        state={voiceState}
        onConfirm={handleConfirm}
        spokenText={spokenText}
      />

      {/* Execution Status */}
      {isExecuting && !navigationState && <ExecutionStatus />}

      {/* Navigation Status — shown during visual navigation */}
      <NavigationStatus />

      {/* Command History */}
      <div className="flex-1 overflow-hidden">
        <CommandHistory commands={commandHistory} />
      </div>
    </div>
  );
}
