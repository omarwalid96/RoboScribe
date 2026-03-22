'use client';

import React from 'react';
import { useRobotState } from '@/hooks/use-robot-state';

const JOINT_NAMES = [
  'left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
  'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle',
  'torso',
  'left_shoulder_pitch', 'left_shoulder_roll', 'left_shoulder_yaw', 'left_elbow',
  'right_shoulder_pitch', 'right_shoulder_roll', 'right_shoulder_yaw', 'right_elbow',
];

export function JointDataStream() {
  const { robotState } = useRobotState();

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/5 bg-[#060606]/40 p-5 shadow-xl backdrop-blur-xl ring-1 ring-white/5 transition-all duration-300 hover:ring-white/10 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-sky-500/5 to-transparent pointer-events-none" />
      <div className="relative z-10 flex flex-col h-full">
        <div className="mb-4 flex items-center gap-2 border-b border-white/5 pb-3">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-400 drop-shadow-md">
            Joint State Stream <span className="text-slate-500 mx-2">//</span> <span className="text-sky-200">Live</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <div className="font-mono text-xs space-y-1">
            <div className="grid grid-cols-4 gap-2 sticky top-0 bg-[#060606]/80 backdrop-blur-md pb-2 pt-1 border-b border-white/5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 z-10">
              <div>JOINT</div>
              <div>POSITION</div>
              <div>VELOCITY</div>
              <div>TORQUE</div>
            </div>

            {JOINT_NAMES.map((joint, idx) => {
              const jointData = robotState?.joints[idx] || { position: 0, velocity: 0, torque: 0 };
              return (
                <div key={joint} className="grid grid-cols-4 gap-2 py-1.5 border-b border-white/5 hover:bg-white/[0.04] transition-colors group">
                  <div className="truncate text-slate-300 font-medium group-hover:text-white transition-colors">{joint}</div>
                  <div className="text-cyan-400 font-bold">{jointData.position.toFixed(2)}°</div>
                  <div className="text-violet-400 font-bold">{jointData.velocity.toFixed(2)}°/s</div>
                  <div className="text-amber-400 font-bold">{jointData.torque.toFixed(2)}Nm</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
