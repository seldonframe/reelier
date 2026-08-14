import { defineDynamic, defineInstructions } from "eve/instructions";
import { renderResumeMarkdown } from "reelier/continuity";
import { continuityRuntime } from "../lib/runtime.js";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const adapter = continuityRuntime(ctx);
      const actor = await adapter.identify();
      const projection = await adapter.open(actor.taskId);
      return defineInstructions({
        role: "system",
        content: renderResumeMarkdown(projection),
      });
    },
  },
});
