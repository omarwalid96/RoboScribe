import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Save a trajectory with explicit field validators
export const save = mutation({
  args: {
    trajectory_id: v.string(),
    natural_language_command: v.string(),
    parsed_command: v.any(),
    timestamp: v.string(),
    outcome: v.string(),
    total_steps: v.number(),
    duration_seconds: v.number(),
    distance_traveled: v.number(),
    validation: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("trajectories", args);
    return { id: id.toString() };
  },
});

// Get all trajectories (for export) - bounded to prevent unbounded queries
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("trajectories").order("desc").take(200);
  },
});

// Get aggregated stats - bounded query
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("trajectories").take(1000);
    const successful = all.filter((t) => t.outcome === "success");
    const commands = new Set(all.map((t) => t.natural_language_command));
    const totalSteps = all.reduce((sum, t) => sum + t.total_steps, 0);

    return {
      total_trajectories: all.length,
      success_rate: all.length > 0 ? Math.round((successful.length / all.length) * 100) : 0,
      total_timesteps: totalSteps,
      unique_commands: commands.size,
    };
  },
});
