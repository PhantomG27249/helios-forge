import {
  assertBrowserUrlAllowed,
  createBrowserPolicy,
  sanitizeUrlForBrowserTrace,
} from './browserPolicy.js';

const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 720 });

async function resolveBrowserType({ playwright, browserType }) {
  if (browserType) {
    return browserType;
  }
  if (playwright === null) {
    return null;
  }
  if (playwright?.chromium) {
    return playwright.chromium;
  }

  try {
    const loaded = await import('playwright');
    return loaded.chromium;
  } catch {
    return null;
  }
}

function createUnavailable(reason = 'playwright_runtime_required') {
  return {
    status: 'unavailable',
    reason,
  };
}

function normalizePolicy(policy = {}) {
  if (policy?.allowedOrigins instanceof Set) {
    return policy;
  }
  if (Array.isArray(policy?.allowedOrigins)) {
    return {
      ...policy,
      allowedOrigins: createBrowserPolicy({ allowedOrigins: policy.allowedOrigins }).allowedOrigins,
    };
  }
  return policy || createBrowserPolicy();
}

function policyDenial({ url, error, reason = 'browser_url_policy_denied' } = {}) {
  const denial = new Error('Browser URL denied by policy');
  denial.status = 'denied';
  denial.kind = 'policy';
  denial.reason = reason;
  denial.causeCode = error?.causeCode || error?.code;
  denial.url = error?.url || sanitizeUrlForBrowserTrace(url);
  return denial;
}

function validateUrlByPolicy({ url, policy, reason } = {}) {
  if (!url) {
    throw policyDenial({ url, reason: 'browser_url_required' });
  }

  if (typeof policy?.validateUrl === 'function') {
    const result = policy.validateUrl({ url, reason });
    if (result === true || result?.allowed === true) {
      return { allowed: true };
    }
    throw policyDenial({
      url: result?.url || url,
      reason: result?.reason || 'browser_url_policy_denied',
    });
  }

  if (typeof policy?.isUrlAllowed === 'function') {
    const result = policy.isUrlAllowed({ url, reason });
    if (result === true || result?.allowed === true) {
      return { allowed: true };
    }
    throw policyDenial({
      url: result?.url || url,
      reason: result?.reason || 'browser_url_policy_denied',
    });
  }

  if (typeof policy?.assertBrowserUrlAllowed === 'function') {
    try {
      policy.assertBrowserUrlAllowed({ url, policy, reason });
      return { allowed: true };
    } catch (error) {
      throw policyDenial({ url, error });
    }
  }

  if (typeof policy?.assertUrlAllowed === 'function') {
    try {
      policy.assertUrlAllowed({ url, reason });
      return { allowed: true };
    } catch (error) {
      throw policyDenial({ url, error });
    }
  }

  try {
    assertBrowserUrlAllowed({ url, policy, reason });
    return { allowed: true };
  } catch (error) {
    throw policyDenial({ url, error });
  }
}

function routeRequestUrl(route) {
  const request = typeof route?.request === 'function' ? route.request() : route?.request;
  const url = typeof request?.url === 'function' ? request.url() : request?.url;
  return url;
}

async function enforceRoutePolicy({ route, policy } = {}) {
  const url = routeRequestUrl(route);
  try {
    validateUrlByPolicy({ url, policy, reason: 'browser.route' });
  } catch {
    if (typeof route?.abort === 'function') {
      await route.abort('blockedbyclient');
      return;
    }
    throw policyDenial({ url });
  }
  await route.continue();
}

function finalNavigationUrl({ response, page, fallbackUrl } = {}) {
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response?.url === 'function') {
    return response.url();
  }
  if (typeof response?.url === 'string') {
    return response.url;
  }
  if (typeof page?.url === 'function') {
    return page.url();
  }
  if (typeof page?.url === 'string') {
    return page.url;
  }
  return fallbackUrl;
}

export async function createPlaywrightBrowserAdapter(options = {}) {
  const browserType = await resolveBrowserType(options);
  const launchBrowser = options.launchBrowser || browserType?.launch?.bind(browserType);
  if (typeof launchBrowser !== 'function') {
    return createUnavailable();
  }

  const launchOptions = {
    ...(options.launchOptions || {}),
    headless: options.headless ?? true,
  };
  delete launchOptions.userDataDir;
  const sessions = new Map();

  async function launch() {
    try {
      return await launchBrowser(launchOptions);
    } catch {
      return null;
    }
  }

  return {
    async createSession({ sessionId, viewport = DEFAULT_VIEWPORT, policy } = {}) {
      const browser = await launch();
      if (!browser) {
        return createUnavailable();
      }
      const sessionPolicy = normalizePolicy(policy);

      const context = await browser.newContext({
        ...(options.contextOptions || {}),
        viewport,
        serviceWorkers: 'block',
        acceptDownloads: false,
      });
      if (typeof context.route === 'function') {
        await context.route('**/*', async (route) => enforceRoutePolicy({ route, policy: sessionPolicy }));
      }
      const page = await context.newPage();
      const session = {
        status: 'ready',
        sessionId,
        viewport,
        policy: sessionPolicy,
        browser,
        context,
        page,
        consoleEntries: [],
        networkRecords: [],
      };

      if (typeof page.on === 'function') {
        page.on('console', (message) => {
          session.consoleEntries.push({
            type: typeof message.type === 'function' ? message.type() : 'log',
            text: typeof message.text === 'function' ? message.text() : '',
          });
        });
        page.on('requestfinished', async (request) => {
          const response = typeof request.response === 'function' ? await request.response() : null;
          session.networkRecords.push({
            method: typeof request.method === 'function' ? request.method() : undefined,
            url: typeof request.url === 'function' ? request.url() : undefined,
            status: typeof response?.status === 'function' ? response.status() : undefined,
            requestHeaders: typeof request.headers === 'function' ? request.headers() : undefined,
            responseHeaders: typeof response?.headers === 'function' ? response.headers() : undefined,
            resourceType: typeof request.resourceType === 'function' ? request.resourceType() : undefined,
          });
        });
        page.on('requestfailed', (request) => {
          session.networkRecords.push({
            method: typeof request.method === 'function' ? request.method() : undefined,
            url: typeof request.url === 'function' ? request.url() : undefined,
            failure: typeof request.failure === 'function' ? request.failure()?.errorText : 'failed',
            resourceType: typeof request.resourceType === 'function' ? request.resourceType() : undefined,
          });
        });
      }

      sessions.set(sessionId, session);
      return session;
    },

    async navigate(session, { url } = {}) {
      const response = await session.page.goto(url, {
        waitUntil: options.waitUntil || 'networkidle',
        timeout: options.navigationTimeoutMs || 30000,
      });
      const finalUrl = finalNavigationUrl({ response, page: session.page, fallbackUrl: url });
      validateUrlByPolicy({
        url: finalUrl,
        policy: session.policy || createBrowserPolicy(),
        reason: 'browser.navigate.final_url',
      });
      return {
        status: 'navigated',
        url: finalUrl,
        title: typeof session.page.title === 'function' ? await session.page.title() : undefined,
      };
    },

    async screenshot(session, { outputPath } = {}) {
      await session.page.screenshot({ path: outputPath, fullPage: options.fullPage ?? true });
      return {
        status: 'captured',
        path: outputPath,
        width: session.viewport.width,
        height: session.viewport.height,
      };
    },

    async consoleRead(session) {
      return [...(session.consoleEntries || [])];
    },

    async networkSummary(session) {
      return [...(session.networkRecords || [])];
    },

    async domSnapshot(session) {
      if (typeof session.page.locator !== 'function') {
        return { status: 'captured', text: '', roles: [] };
      }
      const text = await session.page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
      return { status: 'captured', text, roles: [] };
    },

    async closeSession(session = {}) {
      sessions.delete(session.sessionId);
      if (typeof session.page?.close === 'function') {
        await session.page.close().catch(() => {});
      }
      if (typeof session.context?.close === 'function') {
        await session.context.close().catch(() => {});
      }
      if (typeof session.browser?.close === 'function') {
        await session.browser.close().catch(() => {});
      }
      return { status: 'closed' };
    },
  };
}
