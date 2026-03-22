import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// Public endpoint for the Python backend to POST trajectory metadata.
// Called without auth — backend controls the data, no user identity needed.
http.route({
  path: "/save-trajectory",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate required fields before inserting
    const required = [
      "trajectory_id", "natural_language_command", "parsed_command",
      "timestamp", "outcome", "total_steps", "duration_seconds", "distance_traveled",
    ];
    for (const field of required) {
      if (body[field] === undefined) {
        return new Response(JSON.stringify({ error: `Missing field: ${field}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const result = await ctx.runMutation(api.trajectories.save, {
      trajectory_id: body.trajectory_id as string,
      natural_language_command: body.natural_language_command as string,
      parsed_command: body.parsed_command,
      timestamp: body.timestamp as string,
      outcome: body.outcome as string,
      total_steps: body.total_steps as number,
      duration_seconds: body.duration_seconds as number,
      distance_traveled: body.distance_traveled as number,
      validation: body.validation ?? undefined,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
