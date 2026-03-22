"""Manual WebSocket test client for RoboScribe backend.

Usage:
    python test_ws.py                        # default: "walk forward 1 meter"
    python test_ws.py "turn left 90 degrees"
"""

import asyncio
import json
import argparse
import websockets

BACKEND_URL = "ws://localhost:8000/ws"


async def ask_user(prompt: str) -> str:
    """Non-blocking input() — runs in a thread so the event loop stays alive."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, input, prompt)


async def run_test(command: str):
    print(f"Connecting to {BACKEND_URL}...")
    async with websockets.connect(BACKEND_URL) as ws:
        print(f"\n>> Sending command: \"{command}\"\n")
        await ws.send(json.dumps({"type": "command", "text": command}))

        async for raw in ws:
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "command_parsed":
                print(f"\n[parsed]  {json.dumps(msg['parsed'], indent=2)}")
                print(f"[confirm] {msg['confirmation_text']}")

            elif msg_type == "awaiting_confirmation":
                cmd_id = msg["command_id"]
                answer = await ask_user("\nProceed? [y/n]: ")
                confirmed = answer.strip().lower() in ("y", "yes")
                await ws.send(json.dumps({
                    "type": "confirmation",
                    "command_id": cmd_id,
                    "confirmed": confirmed,
                }))
                print(f">> {'Confirmed' if confirmed else 'Rejected'}\n")

            elif msg_type == "execution_started":
                print(f"[executing] {msg.get('total_steps')} steps / {msg.get('total_duration')}s")

            elif msg_type == "result_text":
                print(f"\n[result] {msg['text']}")
                print("\nDone.")
                break

            elif msg_type == "status":
                status = msg.get("robot_status")
                print(f"[status] {status}")
                if status == "idle":
                    break

            else:
                print(f"[{msg_type}] {json.dumps(msg)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", default="walk forward 1 meter")
    args = parser.parse_args()

    asyncio.run(run_test(args.command))
