// Execution location is independent of synthetic fixtures and staged/live target scope.
export function executionOrigin(env = process.env) {
  const cloud = env.GITHUB_ACTIONS === 'true';
  return {
    scope: cloud ? 'github-actions' : 'local-verification',
    execution: {
      environment: cloud ? 'github-actions' : 'local',
      runId: cloud ? env.GITHUB_RUN_ID || null : null,
      attempt: cloud ? env.GITHUB_RUN_ATTEMPT || null : null,
      job: cloud ? env.GITHUB_JOB || null : null,
      event: cloud ? env.GITHUB_EVENT_NAME || null : null,
      workflowCommit: cloud ? env.GITHUB_SHA || null : null,
    },
  };
}
