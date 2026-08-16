import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";

export default defineEval({
  description: "Deterministic authenticated Eve continuity binding over the loopback Path C port.",
  async test(t) {
    const checkpoint = await t.send("checkpoint");
    checkpoint.calledTool("continuity_checkpoint", { count: 1 });
    checkpoint.noFailedActions();

    const sessionId = checkpoint.sessionId;
    const resume = await t.send("inspect resume");
    await t.require(resume.sessionId, equals(sessionId));
    t.check(resume.message, includes("resume context present"));

    const request = await t.send("request outcome");
    await t.require(request.sessionId, equals(sessionId));
    request.calledTool("reelier_outcome_request", { count: 1 });
    request.noFailedActions();

    const status = await t.send("read status");
    await t.require(status.sessionId, equals(sessionId));
    status.calledTool("reelier_outcome_status", { count: 1 });
    status.noFailedActions();

    t.toolOrder(["continuity_checkpoint", "reelier_outcome_request", "reelier_outcome_status"]);
    t.maxToolCalls(3);
    t.noFailedActions();
    t.succeeded();
  },
});
