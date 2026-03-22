'use client';

import React, { useState, useEffect } from 'react';
import { Send, Mic, Square, Loader2 } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';

interface CommandInputProps {
  onSubmit: (command: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function CommandInput({ onSubmit, disabled, isLoading }: CommandInputProps) {
  const [input, setInput] = useState('');
  const { isRecording, isTranscribing, startRecording, stopRecording } = useAudioRecorder();

  const handleSubmit = () => {
    if (input.trim() && !isLoading) {
      onSubmit(input);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      const transcription = await stopRecording();
      if (transcription) {
        setInput(prev => (prev.trim() ? `${prev} ${transcription}` : transcription));
      }
    } else {
      await startRecording();
    }
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-[#060606]/40 p-4 shadow-xl backdrop-blur-xl md:p-5 ring-1 ring-white/5 relative overflow-hidden group transition-all duration-300 hover:ring-white/10">
      <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-duration-500 pointer-events-none" />
      <div className="relative z-10">
        <div className="mb-4 flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-[0.15em] text-sky-400 drop-shadow-sm">
            Natural Language Command
          </label>
          <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-sky-300">
            {isLoading ? 'Processing...' : isTranscribing ? 'Transcribing...' : 'Enter to send'}
          </span>
        </div>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter command... e.g. walk forward 1 meter"
            disabled={disabled || isLoading || isTranscribing}
            className="flex-1 resize-none rounded-xl border border-white/10 bg-[#060606]/60 px-4 py-3.5 text-sm font-medium text-white placeholder:text-white/30 outline-none transition-all focus:border-sky-400/50 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-50 shadow-inner"
            rows={3}
          />
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={toggleRecording}
            disabled={disabled || isLoading || isTranscribing}
            className={`flex-1 rounded-xl border px-4 py-3 text-sm font-bold uppercase tracking-widest transition-all hover:-translate-y-0.5 flex items-center justify-center gap-3 ${
              isRecording 
                ? 'border-red-500/50 bg-red-500/20 text-red-300 hover:bg-red-500/30 hover:shadow-[0_0_20px_rgba(239,68,68,0.2)]' 
                : 'border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isTranscribing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                <span>Transcribing...</span>
              </>
            ) : isRecording ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <Square className="h-4 w-4 fill-red-500/50" />
                </div>
                <span>Stop Recording</span>
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                <span>Voice Input</span>
              </>
            )}
          </button>
          <button
            onClick={handleSubmit}
            disabled={disabled || !input.trim() || isLoading || isTranscribing}
            className="flex-[2] rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm font-bold uppercase tracking-widest text-sky-300 transition-all hover:-translate-y-0.5 hover:border-sky-400 hover:bg-sky-500/20 hover:text-white hover:shadow-[0_0_20px_rgba(14,165,233,0.2)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none flex items-center justify-center gap-3"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span>Send Command</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
