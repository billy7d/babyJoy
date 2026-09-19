const WORKER_CONTINUITY_MODES = new Set(["enable_gate", "shipping_rollout"]);

function outcomeStatus(outcome) {
  if (outcome === "success") return "PASS";
  if (outcome === "failure") return "FAIL";
  return "NOT_RUN";
}

export function summarizeStorefrontSessionContinuity({
  rolloutMode = "",
  validateOutcome = "",
  applicable = "",
  beforeOutcome = "",
  compatibilityOutcome = "",
  finalOutcome = "",
} = {}) {
  const summary = {
    status: "NOT_RUN",
    preflightStatus: "NOT_RUN",
    beforeStatus: outcomeStatus(beforeOutcome),
    compatibilityStatus: outcomeStatus(compatibilityOutcome),
    finalStatus: outcomeStatus(finalOutcome),
  };

  if (rolloutMode === "repair_cron") {
    return {
      status: "NOT_APPLICABLE",
      preflightStatus: "NOT_APPLICABLE",
      beforeStatus: "NOT_APPLICABLE",
      compatibilityStatus: "NOT_APPLICABLE",
      finalStatus: "NOT_APPLICABLE",
    };
  }

  if (!WORKER_CONTINUITY_MODES.has(rolloutMode)) return summary;

  if (validateOutcome === "failure") {
    return { ...summary, status: "BLOCKED", preflightStatus: "BLOCKED" };
  }

  if (validateOutcome !== "success") return summary;

  if (applicable !== "true") {
    return { ...summary, status: "NOT_APPLICABLE", preflightStatus: "PASS" };
  }

  const withPreflight = { ...summary, preflightStatus: "PASS" };
  if (beforeOutcome !== "success") {
    return {
      ...withPreflight,
      status: "BLOCKED",
      beforeStatus: beforeOutcome === "failure" ? "BLOCKED" : "NOT_RUN",
    };
  }

  if (
    rolloutMode === "shipping_rollout" &&
    compatibilityOutcome !== "success"
  ) {
    return { ...withPreflight, status: "FAIL" };
  }

  if (finalOutcome !== "success") {
    return { ...withPreflight, status: "FAIL" };
  }

  return { ...withPreflight, status: "PASS" };
}
