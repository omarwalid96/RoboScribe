import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Trajectories saved by the backend after Isaac Sim execution completes
  trajectories: defineTable({
    trajectory_id: v.string(),
    natural_language_command: v.string(),
    parsed_command: v.any(),
    timestamp: v.string(),
    outcome: v.string(),
    total_steps: v.number(),
    duration_seconds: v.number(),
    distance_traveled: v.number(),
    validation: v.optional(v.any()),
  }),

  // Manual recordings captured by the frontend's record button
  recordings: defineTable({
    name: v.string(),
    description: v.string(),
    created_at: v.number(),
    duration_seconds: v.number(),
    frame_count: v.number(),
    frames: v.array(v.any()),
  }),
});
