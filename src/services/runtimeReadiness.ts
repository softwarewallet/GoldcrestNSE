/**
 * Pure runtime readiness contracts shared by the health endpoint and
 * broker-side-effect-free certification.
 */
export interface RuntimeReadiness {
  ready: boolean;
  statusCode: 200 | 503;
  status: 'ready' | 'not_ready';
}

export function evaluateRuntimeReadiness(databaseReady: boolean, preflightOk: boolean): RuntimeReadiness {
  const ready = Boolean(databaseReady && preflightOk);
  return {
    ready,
    statusCode: ready ? 200 : 503,
    status: ready ? 'ready' : 'not_ready'
  };
}

export interface RuntimeHealthPayload {
  status: 'ok';
  service: 'goldcrest';
  environment: string;
}

export function buildRuntimeHealthPayload(nodeEnv: string | undefined): RuntimeHealthPayload {
  return {
    status: 'ok',
    service: 'goldcrest',
    environment: nodeEnv || 'development'
  };
}
