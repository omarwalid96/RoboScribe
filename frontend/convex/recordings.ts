import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Save a recording with explicit field validators
export const save = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    created_at: v.number(),
    duration_seconds: v.number(),
    frame_count: v.number(),
    frames: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("recordings", args);
    return { id: id.toString() };
  },
});

// Get all recordings - bounded to prevent unbounded queries
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("recordings").order("desc").take(100);
  },
});
