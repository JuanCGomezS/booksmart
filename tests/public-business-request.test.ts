import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase/app';
import { getFunctions } from 'firebase/functions';
import { requestPublicBusinessData } from '../src/lib/public-business-request.ts';

const app = initializeApp({ projectId: 'public-request-test' }, 'public-request-test');
const functions = getFunctions(app);
const payload = {
  business: { id: 'business-1', name: 'Test business', bookingEnabledUntil: '2030-01-01' },
  products: [],
  catalog: [],
  services: [],
  staff: [],
};

after(() => deleteApp(app));

test('reads the public callable without auth, App Check, or cookies', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ data: payload }),
  );
  assert.deepEqual(await requestPublicBusinessData(functions, 'corte-y-filo'), payload);
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(
    url,
    'https://us-central1-public-request-test.cloudfunctions.net/getPublicBusinessBySlug',
  );
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'omit');
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
  assert.equal(options.body, JSON.stringify({ data: { slug: 'corte-y-filo' } }));
  assert.ok(options.signal instanceof AbortSignal);
});

test('uses the configured Functions region', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ data: payload }),
  );
  await requestPublicBusinessData(getFunctions(app, 'europe-west1'), 'example');
  assert.equal(
    fetchMock.mock.calls[0].arguments[0],
    'https://europe-west1-public-request-test.cloudfunctions.net/getPublicBusinessBySlug',
  );
});

test('uses the configured custom Functions domain', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ result: payload }),
  );
  assert.deepEqual(
    await requestPublicBusinessData(
      getFunctions(app, 'https://functions.example.test/'),
      'example',
    ),
    payload,
  );
  assert.equal(
    fetchMock.mock.calls[0].arguments[0],
    'https://functions.example.test/getPublicBusinessBySlug',
  );
});

for (const [status, code, httpStatus] of [
  ['NOT_FOUND', 'not-found', 404],
  ['PERMISSION_DENIED', 'permission-denied', 403],
  ['UNAVAILABLE', 'unavailable', 503],
  ['DEADLINE_EXCEEDED', 'deadline-exceeded', 504],
  ['RESOURCE_EXHAUSTED', 'resource-exhausted', 429],
  ['UNAUTHENTICATED', 'unauthenticated', 401],
  ['INVALID_ARGUMENT', 'invalid-argument', 400],
] as const) {
  test(`preserves callable ${status} failures`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      Response.json({ error: { status }, data: payload }, { status: httpStatus }),
    );
    await assert.rejects(requestPublicBusinessData(functions, 'example'), {
      code: `functions/${code}`,
    });
  });
}

test('rejects an error envelope even with HTTP 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: { status: 'PERMISSION_DENIED' }, data: payload }),
  );
  await assert.rejects(requestPublicBusinessData(functions, 'example'), {
    code: 'functions/permission-denied',
  });
});

for (const invalid of [null, {}, { data: {} }, { data: { business: {} } }]) {
  test(`rejects malformed success: ${JSON.stringify(invalid)}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json(invalid));
    await assert.rejects(requestPublicBusinessData(functions, 'example'), {
      code: 'functions/internal',
    });
  });
}

test('rejects non-JSON success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Not JSON</html>'));
  await assert.rejects(requestPublicBusinessData(functions, 'example'), {
    code: 'functions/internal',
  });
});

test('makes a non-JSON service outage retryable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }));
  await assert.rejects(requestPublicBusinessData(functions, 'example'), {
    code: 'functions/unavailable',
  });
});

test('does not accept success data on an HTTP failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: payload }, { status: 503 }));
  await assert.rejects(requestPublicBusinessData(functions, 'example'), {
    code: 'functions/unavailable',
  });
});

test('makes network failures retryable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(requestPublicBusinessData(functions, 'example'), {
    code: 'functions/unavailable',
  });
});

test('aborts stalled requests after ten seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(
    globalThis,
    'fetch',
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  );
  const result = requestPublicBusinessData(functions, 'example');
  const failure = assert.rejects(result, { code: 'functions/deadline-exceeded' });
  t.mock.timers.tick(10_000);
  await failure;
});

test('clears the timeout after a successful request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return Response.json({ data: payload });
  });
  await requestPublicBusinessData(functions, 'example');
  t.mock.timers.tick(10_000);
  assert.equal(signal?.aborted, false);
});
