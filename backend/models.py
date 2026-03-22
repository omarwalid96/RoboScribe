from pydantic import BaseModel
from typing import Optional, List
from enum import Enum


class RobotStatus(str, Enum):
    idle = "idle"
    executing = "executing"
    error = "error"


class VoiceState(str, Enum):
    idle = "idle"
    speaking = "speaking"
    awaiting_confirmation = "awaiting_confirmation"


class ParsedCommand(BaseModel):
    vx: float        # forward/backward velocity, -1.0 to 1.0 m/s
    vy: float        # lateral velocity, -1.0 to 1.0 m/s
    wz: float        # yaw angular velocity, -1.0 to 1.0 rad/s
    duration: float  # seconds
    description: str  # human readable


class CommandRequest(BaseModel):
    text: str


class ConfirmationRequest(BaseModel):
    command_id: str
    confirmed: bool


class TrajectoryMetadata(BaseModel):
    trajectory_id: str
    natural_language_command: str
    parsed_command: dict
    timestamp: str
    outcome: str
    total_steps: int
    duration_seconds: float
    distance_traveled: float
