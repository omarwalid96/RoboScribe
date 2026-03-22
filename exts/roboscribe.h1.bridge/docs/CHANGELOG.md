# Changelog

## [0.1.0] - 2026-03-21

### Added
- Initial release of RoboScribe H1 Bridge extension
- Unitree H1 humanoid spawning via H1FlatTerrainPolicy
- WebSocket bridge client connecting to FastAPI backend at ws://localhost:8000/sim
- 200Hz joint trajectory recording during command execution
- 20Hz throttled joint_update stream for dashboard visualization
- Keyboard control (NUMPAD/arrow keys) with bridge command coexistence
- Auto-reconnect with exponential backoff (1, 2, 4, 8, 16, 30s)
- Bridge status indicator in extension UI
