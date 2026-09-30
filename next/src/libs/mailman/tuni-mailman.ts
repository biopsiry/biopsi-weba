import 'server-only';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from 'playwright';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://lists.tuni.fi';

const LIST_ID = process.env.TUNI_MAILMAN_LIST_ID;

const LOGIN_URL = `${BASE_URL}/accounts/login/`;
const MEMBERS_URL = `${BASE_URL}/mailman3/lists/${LIST_ID}/members/member/`;
const MASS_SUBSCRIBE_URL = `${BASE_URL}/mailman3/lists/${LIST_ID}/mass_subscribe/`;
const MASS_REMOVE_URL = `${BASE_URL}/mailman3/lists/${LIST_ID}/mass_removal/`;

const DEBUG = process.env.TUNI_MAILMAN_DEBUG !== 'false';

const DEBUG_ARTIFACTS =
  process.env.TUNI_MAILMAN_DEBUG_ARTIFACTS ===
  'true';

const DEBUG_ARTIFACT_DIR =
  process.env.TUNI_MAILMAN_DEBUG_ARTIFACT_DIR ??
  '/tmp/tuni-mailman-debug';

const SELECTOR_TIMEOUT = 10_000;

type SubscribeResult =
  | 'already-member'
  | 'subscribed';

type UnsubscribeResult =
  | 'not-member'
  | 'removed';

function getCredentials() {
  const username =
    process.env.TUNI_MAILMAN_USERNAME;

  const password =
    process.env.TUNI_MAILMAN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'TUNI_MAILMAN_USERNAME and TUNI_MAILMAN_PASSWORD must be configured',
    );
  }

  return {
    username,
    password,
  };
}

function isLoginPage(url: string) {
  return url.includes('/accounts/login');
}

function sanitizeUrl(url: string) {
  try {
    const parsed = new URL(url);

    // Query parameters might contain sensitive data.
    if (parsed.search) {
      parsed.search = '?<redacted>';
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function maskEmail(email: string) {
  const normalized = email.trim();

  const atIndex = normalized.indexOf('@');

  if (atIndex <= 0) {
    return '<redacted>';
  }

  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  return `${local.slice(0, 1)}***@${domain}`;
}

function redactText(text: string) {
  return text
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      (email) => maskEmail(email),
    )
    .replace(
      /(csrfmiddlewaretoken["']?\s*[:=]\s*["']?)[^\s"'<>]+/gi,
      '$1<redacted>',
    );
}

function truncate(
  value: string,
  maxLength = 3000,
) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n... <truncated ${value.length - maxLength} characters>`;
}

function debugLog(
  event: string,
  data?: unknown,
) {
  if (!DEBUG) {
    return;
  }

  if (data === undefined) {
    console.info(`[TUNI Mailman] ${event}`);
    return;
  }

  console.info(
    `[TUNI Mailman] ${event}`,
    data,
  );
}

function safeFilePart(value: string) {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

class TuniMailman {
  private browser: Browser | null = null;
  private context: BrowserContext | null =
    null;

  private authenticated = false;

  private loginPromise: Promise<void> | null =
    null;

  private pageCounter = 0;

  private async start() {
    if (
      this.browser?.isConnected() &&
      this.context
    ) {
      return;
    }

    if (
      this.browser &&
      !this.browser.isConnected()
    ) {
      debugLog(
        'Existing browser is disconnected; recreating it',
      );

      this.browser = null;
      this.context = null;
      this.authenticated = false;
    }

    const headless =
      process.env.TUNI_MAILMAN_HEADLESS !==
      'false';

    debugLog('Starting Chromium', {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      headless,
      listId: LIST_ID,
      baseUrl: BASE_URL,
      usernameConfigured:
        Boolean(
          process.env
            .TUNI_MAILMAN_USERNAME,
        ),
      passwordConfigured:
        Boolean(
          process.env
            .TUNI_MAILMAN_PASSWORD,
        ),
      debugArtifacts: DEBUG_ARTIFACTS,
    });

    try {
      this.browser =
        await chromium.launch({
          headless,
        });

      debugLog('Chromium started', {
        browserVersion:
          this.browser.version(),
      });

      this.browser.on(
        'disconnected',
        () => {
          console.error(
            '[TUNI Mailman] Chromium disconnected unexpectedly',
          );

          this.browser = null;
          this.context = null;
          this.authenticated = false;
        },
      );

      this.context =
        await this.browser.newContext();

      debugLog('Browser context created');
    } catch (error) {
      console.error(
        '[TUNI Mailman] Failed to start Chromium',
        error,
      );

      throw error;
    }
  }

  private attachPageDebugging(
    page: Page,
    name: string,
  ) {
    const pageId =
      ++this.pageCounter;

    const prefix = `${name}#${pageId}`;

    debugLog(`${prefix}: page created`);

    page.on('console', (message) => {
      debugLog(
        `${prefix}: browser console ${message.type()}`,
        truncate(
          redactText(message.text()),
          1000,
        ),
      );
    });

    page.on('pageerror', (error) => {
      console.error(
        `[TUNI Mailman] ${prefix}: page JavaScript error`,
        error,
      );
    });

    page.on(
      'requestfailed',
      (request) => {
        debugLog(
          `${prefix}: request failed`,
          {
            method: request.method(),
            resourceType:
              request.resourceType(),
            url: sanitizeUrl(
              request.url(),
            ),
            failure:
              request.failure()
                ?.errorText ??
              '<unknown>',
          },
        );
      },
    );

    page.on('response', (response) => {
      const status =
        response.status();

      const request =
        response.request();

      const resourceType =
        request.resourceType();

      // Log all document navigations and
      // any failed HTTP response.
      if (
        resourceType !== 'document' &&
        status < 400
      ) {
        return;
      }

      const headers =
        response.headers();

      debugLog(
        `${prefix}: HTTP response`,
        {
          status,
          statusText:
            response.statusText(),
          method:
            request.method(),
          resourceType,
          url: sanitizeUrl(
            response.url(),
          ),
          contentType:
            headers[
              'content-type'
            ],
          location:
            headers.location,
          server:
            headers.server,
        },
      );
    });

    page.on('close', () => {
      debugLog(`${prefix}: page closed`);
    });

    return prefix;
  }

  private async getCookieSummary() {
    if (!this.context) {
      return [];
    }

    try {
      const cookies =
        await this.context.cookies(
          BASE_URL,
        );

      // Deliberately exclude cookie values.
      return cookies.map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite:
          cookie.sameSite,
        expires:
          cookie.expires,
      }));
    } catch (error) {
      return [
        {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      ];
    }
  }

  private async getPageControls(
    page: Page,
  ) {
    try {
      return await page
        .locator(
          'input, textarea, button, select',
        )
        .evaluateAll((elements) =>
          elements
            .slice(0, 50)
            .map((element) => {
              const htmlElement =
                element as HTMLElement;

              const input =
                element as HTMLInputElement;

              return {
                tag:
                  element.tagName.toLowerCase(),
                type:
                  input.type || null,
                name:
                  input.name || null,
                id:
                  element.id || null,
                ariaLabel:
                  element.getAttribute(
                    'aria-label',
                  ),
                placeholder:
                  element.getAttribute(
                    'placeholder',
                  ),
                text:
                  element.tagName ===
                  'BUTTON'
                    ? htmlElement.innerText
                        .trim()
                        .slice(
                          0,
                          100,
                        )
                    : null,

                // Do not include "value".
                // It may contain credentials,
                // email addresses or CSRF tokens.
              };
            }),
        );
    } catch (error) {
      return [
        {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      ];
    }
  }

  private async getPageBody(
    page: Page,
  ) {
    try {
      const body =
        await page
          .locator('body')
          .innerText();

      return truncate(
        redactText(body),
        4000,
      );
    } catch (error) {
      return `<unable to read body: ${
        error instanceof Error
          ? error.message
          : String(error)
      }>`;
    }
  }

  private async saveDebugArtifacts(
    page: Page,
    label: string,
  ) {
    if (!DEBUG_ARTIFACTS) {
      return;
    }

    try {
      await mkdir(
        DEBUG_ARTIFACT_DIR,
        {
          recursive: true,
        },
      );

      const timestamp =
        new Date()
          .toISOString()
          .replace(
            /[:.]/g,
            '-',
          );

      const basename =
        `${timestamp}-${safeFilePart(label)}`;

      const screenshotPath =
        path.join(
          DEBUG_ARTIFACT_DIR,
          `${basename}.png`,
        );

      const textPath =
        path.join(
          DEBUG_ARTIFACT_DIR,
          `${basename}.txt`,
        );

      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });

      const body =
        await this.getPageBody(
          page,
        );

      await writeFile(
        textPath,
        [
          `URL: ${sanitizeUrl(page.url())}`,
          `Title: ${await page.title().catch(() => '<unavailable>')}`,
          '',
          body,
        ].join('\n'),
        'utf8',
      );

      debugLog(
        'Saved debug artifacts',
        {
          screenshotPath,
          textPath,
        },
      );
    } catch (error) {
      console.error(
        '[TUNI Mailman] Unable to save debug artifacts',
        error,
      );
    }
  }

  private async logPageState(
    page: Page,
    label: string,
    response?: Response | null,
  ) {
    const title =
      await page
        .title()
        .catch(
          () => '<unavailable>',
        );

    const body =
      await this.getPageBody(
        page,
      );

    const controls =
      await this.getPageControls(
        page,
      );

    const cookies =
      await this.getCookieSummary();

    const responseHeaders =
      response?.headers();

    const state = {
      label,

      response: response
        ? {
            status:
              response.status(),
            statusText:
              response.statusText(),
            url: sanitizeUrl(
              response.url(),
            ),
            contentType:
              responseHeaders?.[
                'content-type'
              ],
            location:
              responseHeaders
                ?.location,
            server:
              responseHeaders
                ?.server,
          }
        : null,

      actualUrl:
        sanitizeUrl(
          page.url(),
        ),

      title,
      cookies,
      controls,
      body,
    };

    debugLog(
      `${label}: page state`,
      state,
    );

    await this.saveDebugArtifacts(
      page,
      label,
    );

    return state;
  }

  private async goto(
    page: Page,
    url: string,
    label: string,
  ) {
    debugLog(
      `${label}: navigating`,
      {
        url: sanitizeUrl(url),
      },
    );

    const startedAt =
      Date.now();

    try {
      const response =
        await page.goto(url, {
          waitUntil:
            'domcontentloaded',
        });

      debugLog(
        `${label}: navigation finished`,
        {
          requestedUrl:
            sanitizeUrl(url),
          actualUrl:
            sanitizeUrl(
              page.url(),
            ),
          status:
            response?.status() ??
            null,
          elapsedMs:
            Date.now() -
            startedAt,
        },
      );

      return response;
    } catch (error) {
      console.error(
        `[TUNI Mailman] ${label}: navigation failed`,
        {
          requestedUrl:
            sanitizeUrl(url),
          actualUrl:
            sanitizeUrl(
              page.url(),
            ),
          elapsedMs:
            Date.now() -
            startedAt,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );

      await this.logPageState(
        page,
        `${label}-navigation-error`,
      );

      throw error;
    }
  }

  private async looksLikeLoginPage(
    page: Page,
  ) {
    if (isLoginPage(page.url())) {
      return true;
    }

    try {
      return (
        (await page
          .locator(
            'input[type="password"]',
          )
          .count()) > 0
      );
    } catch {
      return false;
    }
  }

  private async login() {
    await this.start();

    const {
      username,
      password,
    } = getCredentials();

    const page =
      await this.context!.newPage();

    const pageName =
      this.attachPageDebugging(
        page,
        'login',
      );

    try {
      debugLog(
        `${pageName}: starting login`,
      );

      const loginResponse =
        await this.goto(
          page,
          LOGIN_URL,
          `${pageName}: login page`,
        );

      if (
        loginResponse &&
        loginResponse.status() >=
          400
      ) {
        await this.logPageState(
          page,
          `${pageName}-login-http-error`,
          loginResponse,
        );

        throw new Error(
          `TUNI Mailman login page returned HTTP ${loginResponse.status()}`,
        );
      }

      const loginInput = page
        .locator(
          'input[name="login"], input[name="username"], input#id_login',
        )
        .first();

      const passwordInput = page
        .locator(
          'input[name="password"], input#id_password, input[type="password"]',
        )
        .first();

      try {
        await loginInput.waitFor({
          state: 'visible',
          timeout:
            SELECTOR_TIMEOUT,
        });

        await passwordInput.waitFor({
          state: 'visible',
          timeout:
            SELECTOR_TIMEOUT,
        });
      } catch (error) {
        await this.logPageState(
          page,
          `${pageName}-login-fields-missing`,
          loginResponse,
        );

        throw new Error(
          `TUNI Mailman login fields were not found: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      debugLog(
        `${pageName}: login fields found`,
        {
          loginInputCount:
            await loginInput.count(),
          passwordInputCount:
            await passwordInput.count(),
        },
      );

      await loginInput.fill(
        username,
      );

      await passwordInput.fill(
        password,
      );

      const form =
        passwordInput.locator(
          'xpath=ancestor::form[1]',
        );

      const submitButton = form
        .locator(
          'button[type="submit"], input[type="submit"]',
        )
        .first();

      if (
        (await submitButton.count()) ===
        0
      ) {
        await this.logPageState(
          page,
          `${pageName}-login-submit-missing`,
        );

        throw new Error(
          'TUNI Mailman login submit button was not found',
        );
      }

      debugLog(
        `${pageName}: submitting credentials`,
        {
          currentUrl:
            sanitizeUrl(
              page.url(),
            ),
        },
      );

      const loginSubmitStartedAt =
        Date.now();

      await submitButton.click();

      await page.waitForLoadState(
        'domcontentloaded',
      );

      debugLog(
        `${pageName}: login submission completed`,
        {
          elapsedMs:
            Date.now() -
            loginSubmitStartedAt,
          url: sanitizeUrl(
            page.url(),
          ),
          title:
            await page
              .title()
              .catch(
                () =>
                  '<unavailable>',
              ),
          cookies:
            await this.getCookieSummary(),
        },
      );

      if (
        await this.looksLikeLoginPage(
          page,
        )
      ) {
        await this.logPageState(
          page,
          `${pageName}-login-still-on-login-page`,
        );

        throw new Error(
          'TUNI Mailman login failed: still on a login page after submitting credentials',
        );
      }

      const membersResponse =
        await this.goto(
          page,
          MEMBERS_URL,
          `${pageName}: verify members access`,
        );

      if (
        membersResponse &&
        membersResponse.status() >=
          400
      ) {
        await this.logPageState(
          page,
          `${pageName}-members-http-error`,
          membersResponse,
        );

        throw new Error(
          `TUNI Mailman members page returned HTTP ${membersResponse.status()} after login`,
        );
      }

      if (
        await this.looksLikeLoginPage(
          page,
        )
      ) {
        await this.logPageState(
          page,
          `${pageName}-members-redirected-to-login`,
          membersResponse,
        );

        throw new Error(
          'TUNI Mailman login failed: members page redirected back to login',
        );
      }

      const searchBox =
        page.locator(
          'input[name="q"]',
        );

      try {
        await searchBox.waitFor({
          state: 'visible',
          timeout:
            SELECTOR_TIMEOUT,
        });
      } catch {
        await this.logPageState(
          page,
          `${pageName}-member-search-missing-after-login`,
          membersResponse,
        );

        throw new Error(
          `Logged into TUNI Mailman, but member administration is unavailable. ` +
            `URL=${sanitizeUrl(page.url())}`,
        );
      }

      this.authenticated = true;

      debugLog(
        `${pageName}: authentication verified successfully`,
        {
          url: sanitizeUrl(
            page.url(),
          ),
          cookies:
            await this.getCookieSummary(),
        },
      );
    } catch (error) {
      this.authenticated = false;

      console.error(
        `[TUNI Mailman] ${pageName}: login failed`,
        {
          error:
            error instanceof Error
              ? error.message
              : String(error),
          url: sanitizeUrl(
            page.url(),
          ),
        },
      );

      throw error;
    } finally {
      await page.close();
    }
  }

  private async ensureLoggedIn(
    force = false,
  ) {
    await this.start();

    debugLog(
      'ensureLoggedIn',
      {
        force,
        authenticated:
          this.authenticated,
        loginInProgress:
          Boolean(
            this.loginPromise,
          ),
      },
    );

    if (
      this.authenticated &&
      !force
    ) {
      return;
    }

    // Prevent simultaneous profile requests
    // from all logging in.
    if (this.loginPromise) {
      debugLog(
        'Waiting for existing login attempt',
      );

      await this.loginPromise;
      return;
    }

    this.authenticated = false;

    this.loginPromise =
      this.login().finally(() => {
        this.loginPromise = null;
      });

    await this.loginPromise;
  }

  private async openOwnerPage(
    url: string,
  ): Promise<Page> {
    await this.ensureLoggedIn();

    for (
      let attempt = 1;
      attempt <= 2;
      attempt++
    ) {
      const page =
        await this.context!.newPage();

      const pageName =
        this.attachPageDebugging(
          page,
          `owner-page-attempt-${attempt}`,
        );

      debugLog(
        `${pageName}: opening owner page`,
        {
          attempt,
          url: sanitizeUrl(url),
          authenticated:
            this.authenticated,
        },
      );

      let response:
        | Response
        | null = null;

      try {
        response =
          await this.goto(
            page,
            url,
            `${pageName}: owner page`,
          );

        if (
          response &&
          response.status() >=
            400
        ) {
          await this.logPageState(
            page,
            `${pageName}-http-error`,
            response,
          );

          throw new Error(
            `TUNI Mailman returned HTTP ${response.status()} for ${sanitizeUrl(url)}`,
          );
        }

        if (
          await this.looksLikeLoginPage(
            page,
          )
        ) {
          debugLog(
            `${pageName}: session appears to have expired`,
            {
              actualUrl:
                sanitizeUrl(
                  page.url(),
                ),
              attempt,
            },
          );

          await this.logPageState(
            page,
            `${pageName}-session-expired`,
            response,
          );

          this.authenticated = false;

          await page.close();

          if (attempt === 1) {
            await this.ensureLoggedIn(
              true,
            );

            continue;
          }

          throw new Error(
            'Unable to authenticate with TUNI Mailman after retry',
          );
        }

        debugLog(
          `${pageName}: owner page opened`,
          {
            status:
              response?.status() ??
              null,
            actualUrl:
              sanitizeUrl(
                page.url(),
              ),
            title:
              await page
                .title()
                .catch(
                  () =>
                    '<unavailable>',
                ),
          },
        );

        return page;
      } catch (error) {
        if (!page.isClosed()) {
          await this.logPageState(
            page,
            `${pageName}-open-error`,
            response,
          );

          await page.close();
        }

        throw error;
      }
    }

    throw new Error(
      'Unable to open TUNI Mailman administration page',
    );
  }

  private async findEmailInput(
    page: Page,
    label: RegExp,
  ): Promise<Locator> {
    debugLog(
      'Looking for email input',
      {
        url: sanitizeUrl(
          page.url(),
        ),
        expectedLabel:
          label.toString(),
      },
    );

    const labelled =
      page.getByLabel(label);

    if (
      (await labelled.count()) >
      0
    ) {
      const field =
        labelled.first();

      try {
        await field.waitFor({
          state: 'visible',
          timeout:
            SELECTOR_TIMEOUT,
        });

        debugLog(
          'Found email input by label',
          {
            expectedLabel:
              label.toString(),
          },
        );

        return field;
      } catch {
        await this.logPageState(
          page,
          'labelled-email-input-not-visible',
        );

        throw new Error(
          `TUNI Mailman email field matched ${label.toString()} but was not visible`,
        );
      }
    }

    debugLog(
      'Email input not found by label; trying first textarea',
      {
        expectedLabel:
          label.toString(),
      },
    );

    const textarea =
      page
        .locator('textarea')
        .first();

    try {
      await textarea.waitFor({
        state: 'visible',
        timeout:
          SELECTOR_TIMEOUT,
      });
    } catch {
      await this.logPageState(
        page,
        'email-textarea-missing',
      );

      throw new Error(
        `Unable to find TUNI Mailman email input for ${label.toString()}`,
      );
    }

    return textarea;
  }

  private async submitForm(
    field: Locator,
    preferredButton: RegExp,
  ) {
    const page =
      field.page();

    const form =
      field.locator(
        'xpath=ancestor::form[1]',
      );

    let submitButton =
      form.getByRole(
        'button',
        {
          name: preferredButton,
        },
      );

    if (
      (await submitButton.count()) ===
      0
    ) {
      debugLog(
        'Preferred submit button not found; using fallback submit control',
        {
          preferredButton:
            preferredButton.toString(),
          url: sanitizeUrl(
            page.url(),
          ),
        },
      );

      submitButton = form
        .locator(
          'button[type="submit"], input[type="submit"]',
        )
        .last();
    }

    if (
      (await submitButton.count()) ===
      0
    ) {
      await this.logPageState(
        page,
        'submit-button-missing',
      );

      throw new Error(
        `Unable to find submit button matching ${preferredButton.toString()}`,
      );
    }

    debugLog(
      'Submitting Mailman form',
      {
        preferredButton:
          preferredButton.toString(),
        url: sanitizeUrl(
          page.url(),
        ),
      },
    );

    const startedAt =
      Date.now();

    await submitButton.click();

    await page.waitForLoadState(
      'domcontentloaded',
    );

    debugLog(
      'Mailman form submission completed',
      {
        elapsedMs:
          Date.now() -
          startedAt,
        resultingUrl:
          sanitizeUrl(
            page.url(),
          ),
        title:
          await page
            .title()
            .catch(
              () =>
                '<unavailable>',
            ),
      },
    );

    if (
      await this.looksLikeLoginPage(
        page,
      )
    ) {
      await this.logPageState(
        page,
        'form-submission-redirected-to-login',
      );

      this.authenticated = false;

      throw new Error(
        'TUNI Mailman session expired while submitting form',
      );
    }
  }

  private async setCheckboxIfPresent(
    page: Page,
    label: RegExp,
    checked: boolean,
  ) {
    const checkbox =
      page.getByLabel(label);

    const count =
      await checkbox.count();

    debugLog(
      'Checking optional checkbox',
      {
        label:
          label.toString(),
        found: count,
        desiredState:
          checked,
      },
    );

    if (count === 0) {
      return;
    }

    if (checked) {
      await checkbox
        .first()
        .check();
    } else {
      await checkbox
        .first()
        .uncheck();
    }
  }

  async isMember(
    email: string,
  ): Promise<boolean> {
    const maskedEmail =
      maskEmail(email);

    debugLog(
      'Checking membership',
      {
        email: maskedEmail,
      },
    );

    const page =
      await this.openOwnerPage(
        MEMBERS_URL,
      );

    try {
      const searchBox =
        page.locator(
          'input[name="q"]',
        );

      try {
        await searchBox.waitFor({
          state: 'visible',
          timeout:
            SELECTOR_TIMEOUT,
        });
      } catch (error) {
        const state =
          await this.logPageState(
            page,
            'member-search-box-missing',
          );

        throw new Error(
          `TUNI Mailman member search box is missing. ` +
            `URL=${state.actualUrl}, ` +
            `title=${JSON.stringify(state.title)}. ` +
            `Original error=${
              error instanceof Error
                ? error.message
                : String(error)
            }`,
        );
      }

      debugLog(
        'Member search box found',
        {
          email: maskedEmail,
          url: sanitizeUrl(
            page.url(),
          ),
        },
      );

      await searchBox.fill(email);

      const form =
        searchBox.locator(
          'xpath=ancestor::form[1]',
        );

      const submitButton = form
        .locator(
          'button[type="submit"], input[type="submit"]',
        )
        .first();

      if (
        (await submitButton.count()) ===
        0
      ) {
        await this.logPageState(
          page,
          'member-search-submit-missing',
        );

        throw new Error(
          'TUNI Mailman member search submit button was not found',
        );
      }

      debugLog(
        'Submitting membership search',
        {
          email: maskedEmail,
        },
      );

      const searchStartedAt =
        Date.now();

      await submitButton.click();

      await page.waitForLoadState(
        'domcontentloaded',
      );

      debugLog(
        'Membership search completed',
        {
          email: maskedEmail,
          elapsedMs:
            Date.now() -
            searchStartedAt,
          resultingUrl:
            sanitizeUrl(
              page.url(),
            ),
        },
      );

      if (
        await this.looksLikeLoginPage(
          page,
        )
      ) {
        this.authenticated = false;

        await this.logPageState(
          page,
          'member-search-redirected-to-login',
        );

        throw new Error(
          'TUNI Mailman session expired during member search',
        );
      }

      const normalizedEmail =
        email
          .trim()
          .toLowerCase();

      const memberCheckboxes =
        page.locator(
          'input.member-checkbox',
        );

      const checkboxCount =
        await memberCheckboxes.count();

      debugLog(
        'Membership search results',
        {
          email: maskedEmail,
          memberCheckboxCount:
            checkboxCount,
        },
      );

      const isMember =
        await memberCheckboxes.evaluateAll(
          (
            elements,
            targetEmail,
          ) =>
            elements.some(
              (element) =>
                (
                  element as HTMLInputElement
                ).value
                  .trim()
                  .toLowerCase() ===
                targetEmail,
            ),
          normalizedEmail,
        );

      debugLog(
        'Membership check result',
        {
          email: maskedEmail,
          isMember,
        },
      );

      return isMember;
    } catch (error) {
      console.error(
        '[TUNI Mailman] Membership query failed',
        {
          email:
            maskedEmail,
          url: sanitizeUrl(
            page.url(),
          ),
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );

      throw error;
    } finally {
      await page.close();
    }
  }

  async subscribe(
    email: string,
  ): Promise<SubscribeResult> {
    const maskedEmail =
      maskEmail(email);

    debugLog(
      'Starting subscription',
      {
        email: maskedEmail,
      },
    );

    if (
      await this.isMember(email)
    ) {
      debugLog(
        'Subscription skipped: already a member',
        {
          email:
            maskedEmail,
        },
      );

      return 'already-member';
    }

    const page =
      await this.openOwnerPage(
        MASS_SUBSCRIBE_URL,
      );

    try {
      debugLog(
        'Mass subscription page opened',
        {
          email:
            maskedEmail,
          url: sanitizeUrl(
            page.url(),
          ),
        },
      );

      const emails =
        await this.findEmailInput(
          page,
          /emails to mass subscribe/i,
        );

      await emails.fill(email);

      await this.setCheckboxIfPresent(
        page,
        /pre.?verified/i,
        true,
      );

      await this.setCheckboxIfPresent(
        page,
        /pre.?confirmed/i,
        true,
      );

      await this.setCheckboxIfPresent(
        page,
        /pre.?approved/i,
        true,
      );

      // Avoid an extra Mailman welcome message.
      await this.setCheckboxIfPresent(
        page,
        /send welcome message/i,
        false,
      );

      await this.submitForm(
        emails,
        /subscribe users/i,
      );

      debugLog(
        'Subscription form submitted',
        {
          email:
            maskedEmail,
        },
      );
    } catch (error) {
      await this.logPageState(
        page,
        'subscription-error',
      );

      console.error(
        '[TUNI Mailman] Subscription failed',
        {
          email:
            maskedEmail,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );

      throw error;
    } finally {
      await page.close();
    }

    debugLog(
      'Verifying subscription',
      {
        email: maskedEmail,
      },
    );

    if (
      !(await this.isMember(
        email,
      ))
    ) {
      throw new Error(
        `TUNI Mailman reported subscription but ${maskedEmail} is not a member`,
      );
    }

    debugLog(
      'Subscription verified',
      {
        email: maskedEmail,
      },
    );

    return 'subscribed';
  }

  async unsubscribe(
    email: string,
  ): Promise<UnsubscribeResult> {
    const maskedEmail =
      maskEmail(email);

    debugLog(
      'Starting removal',
      {
        email: maskedEmail,
      },
    );

    if (
      !(await this.isMember(
        email,
      ))
    ) {
      debugLog(
        'Removal skipped: not a member',
        {
          email:
            maskedEmail,
        },
      );

      return 'not-member';
    }

    const page =
      await this.openOwnerPage(
        MASS_REMOVE_URL,
      );

    try {
      debugLog(
        'Mass removal page opened',
        {
          email:
            maskedEmail,
          url: sanitizeUrl(
            page.url(),
          ),
        },
      );

      const emails =
        await this.findEmailInput(
          page,
          /emails to unsubscribe/i,
        );

      await emails.fill(email);

      await this.submitForm(
        emails,
        /remove listed users/i,
      );

      debugLog(
        'Removal form submitted',
        {
          email:
            maskedEmail,
        },
      );
    } catch (error) {
      await this.logPageState(
        page,
        'removal-error',
      );

      console.error(
        '[TUNI Mailman] Removal failed',
        {
          email:
            maskedEmail,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );

      throw error;
    } finally {
      await page.close();
    }

    debugLog(
      'Verifying removal',
      {
        email: maskedEmail,
      },
    );

    if (
      await this.isMember(email)
    ) {
      throw new Error(
        `TUNI Mailman reported removal but ${maskedEmail} is still a member`,
      );
    }

    debugLog(
      'Removal verified',
      {
        email: maskedEmail,
      },
    );

    return 'removed';
  }
}

const globalForMailman =
  globalThis as typeof globalThis & {
    __tuniMailman?: TuniMailman;
  };

export const tuniMailman =
  globalForMailman.__tuniMailman ??
  new TuniMailman();

if (
  process.env.NODE_ENV !==
  'production'
) {
  globalForMailman.__tuniMailman =
    tuniMailman;
}