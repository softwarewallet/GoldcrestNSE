import assert from 'node:assert/strict';
import { operatorAuthRequired } from '../src/server/security';

function runMiddleware(remoteAddress: string, nodeEnv: string) {
  process.env.NODE_ENV = nodeEnv;
  let nextCalled = false;
  let statusCode = 200;
  let responseBody: any = null;

  const req: any = {
    socket: { remoteAddress },
    ip: remoteAddress,
    method: 'GET',
    header: (name: string) => name.toLowerCase() === 'origin' ? undefined : undefined,
    protocol: 'http',
    get: () => '127.0.0.1:3000'
  };

  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: any) {
      responseBody = body;
      return this;
    },
    setHeader() {}
  };

  operatorAuthRequired(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, statusCode, responseBody };
}

const originalEnv = process.env.NODE_ENV;
const originalKey = process.env.GOLDCREST_OPERATOR_API_KEY;
process.env.GOLDCREST_OPERATOR_API_KEY = 'test-key';

const local = runMiddleware('::ffff:127.0.0.1', 'development');
assert.equal(local.nextCalled, true);
assert.equal(local.statusCode, 200);

const remote = runMiddleware('192.168.1.25', 'development');
assert.equal(remote.nextCalled, false);
assert.equal(remote.statusCode, 401);

const productionLocal = runMiddleware('::1', 'production');
assert.equal(productionLocal.nextCalled, false);
assert.equal(productionLocal.statusCode, 401);

if (originalEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalEnv;
if (originalKey === undefined) delete process.env.GOLDCREST_OPERATOR_API_KEY;
else process.env.GOLDCREST_OPERATOR_API_KEY = originalKey;

console.log('LOCAL DEVELOPMENT OPERATOR BYPASS TEST PASSED');
