'use client';

import { useContext } from 'react';
import { RobotContext } from '@/context/robot-context';

export function useRobotState() {
  const context = useContext(RobotContext);
  if (!context) {
    throw new Error('useRobotState must be used within RobotProvider');
  }
  return context;
}
