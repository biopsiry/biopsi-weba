import 'server-only';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';

const BASE_URL = 'https://lists.tuni.fi';

type SubscribeResult = 'already-member' | 'subscribed';
type UnsubscribeResult = 'not-member' | 'removed';

function getCredentials() {
  const username = process.env.TUNI_MAILMAN_USERNAME;
  const password = process.env.TUNI_MAILMAN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'TUNI_MAILMAN_USERNAME and TUNI_MAILMAN_PASSWORD must be configured',
    );
  }

  return { username, password };
}

function getUrls() {
  const listId = process.env.TUNI_MAILMAN_LIST_ID;

  if (!listId) {
    throw new Error(
      'TUNI_MAILMAN_LIST_ID must be configured',
    );
  }

  return {
    loginUrl: `${BASE_URL}/accounts/login/`,
    membersUrl: `${BASE_URL}/mailman3/lists/${listId}/members/member/`,
    massSubscribeUrl: `${BASE_URL}/mailman3/lists/${listId}/mass_subscribe/`,
    massRemoveUrl: `${BASE_URL}/mailman3/lists/${listId}/mass_removal/`,
  };
}

function isLoginPage(url: string) {
  return url.includes('/accounts/login');
}

class TuniMailman {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  private authenticated = false;
  private startPromise: Promise<void> | null = null;
  private loginPromise: Promise<void> | null = null;

  private async start() {
    if (this.browser?.isConnected() && this.context) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });

    await this.startPromise;
  }

  private async startInternal() {
    const browser = await chromium.launch({
      headless:
        process.env.TUNI_MAILMAN_HEADLESS !== 'false',
    });

    try {
      const context = await browser.newContext();

      browser.on('disconnected', () => {
        if (this.browser === browser) {
          this.browser = null;
          this.context = null;
          this.authenticated = false;
        }
      });

      this.browser = browser;
      this.context = context;
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  private async login() {
    await this.start();

    const { username, password } = getCredentials();
    const { loginUrl, membersUrl } = getUrls();

    const page = await this.context!.newPage();

    try {
      const loginResponse = await page.goto(loginUrl, {
        waitUntil: 'domcontentloaded',
      });

      if (!loginResponse || loginResponse.status() >= 400) {
        throw new Error(
          `Unable to open TUNI Mailman login page${
            loginResponse
              ? ` (HTTP ${loginResponse.status()})`
              : ''
          }`,
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

      await loginInput.waitFor({ state: 'visible' });
      await passwordInput.waitFor({ state: 'visible' });

      await loginInput.fill(username);
      await passwordInput.fill(password);

      const form =
        passwordInput.locator('xpath=ancestor::form[1]');

      const submitButton = form
        .locator(
          'button[type="submit"], input[type="submit"]',
        )
        .first();

      await submitButton.click();
      await page.waitForLoadState('domcontentloaded');

      if (isLoginPage(page.url())) {
        throw new Error('TUNI Mailman login failed');
      }

      const membersResponse = await page.goto(membersUrl, {
        waitUntil: 'domcontentloaded',
      });

      if (!membersResponse || membersResponse.status() >= 400) {
        throw new Error(
          `Unable to open TUNI Mailman member administration${
            membersResponse
              ? ` (HTTP ${membersResponse.status()})`
              : ''
          }`,
        );
      }

      if (isLoginPage(page.url())) {
        throw new Error('TUNI Mailman login failed');
      }

      const searchBox = page.locator('input[name="q"]');

      if (!(await searchBox.isVisible())) {
        throw new Error(
          'Logged into TUNI Mailman, but member administration is unavailable',
        );
      }

      this.authenticated = true;
    } catch (error) {
      this.authenticated = false;
      throw error;
    } finally {
      await page.close();
    }
  }

  private async ensureLoggedIn(force = false) {
    await this.start();

    if (this.authenticated && !force) {
      return;
    }

    if (this.loginPromise) {
      await this.loginPromise;
      return;
    }

    this.authenticated = false;

    this.loginPromise = this.login().finally(() => {
      this.loginPromise = null;
    });

    await this.loginPromise;
  }

  private async openOwnerPage(url: string): Promise<Page> {
    await this.ensureLoggedIn();

    for (let attempt = 0; attempt < 2; attempt++) {
      const page = await this.context!.newPage();

      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
        });

        if (!response) {
          throw new Error(
            `No response from TUNI Mailman for ${url}`,
          );
        }

        if (isLoginPage(page.url())) {
          this.authenticated = false;
          await page.close();

          if (attempt === 0) {
            await this.ensureLoggedIn(true);
            continue;
          }

          throw new Error(
            'Unable to authenticate with TUNI Mailman',
          );
        }

        if (response.status() >= 400) {
          throw new Error(
            `TUNI Mailman returned HTTP ${response.status()} for ${url}`,
          );
        }

        return page;
      } catch (error) {
        if (!page.isClosed()) {
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
    const labelled = page.getByLabel(label);

    if ((await labelled.count()) > 0) {
      return labelled.first();
    }

    const textarea = page.locator('textarea').first();

    await textarea.waitFor({
      state: 'visible',
    });

    return textarea;
  }

  private async submitForm(
    field: Locator,
    preferredButton: RegExp,
  ) {
    const form =
      field.locator('xpath=ancestor::form[1]');

    let submitButton = form.getByRole('button', {
      name: preferredButton,
    });

    if ((await submitButton.count()) === 0) {
      submitButton = form
        .locator(
          'button[type="submit"], input[type="submit"]',
        )
        .last();
    }

    await submitButton.click();
    await field.page().waitForLoadState('domcontentloaded');

    if (isLoginPage(field.page().url())) {
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
    const checkbox = page.getByLabel(label);

    if ((await checkbox.count()) === 0) {
      return;
    }

    if (checked) {
      await checkbox.first().check();
    } else {
      await checkbox.first().uncheck();
    }
  }

  async isMember(email: string): Promise<boolean> {
    const { membersUrl } = getUrls();

    const page = await this.openOwnerPage(membersUrl);

    try {
      const searchBox =
        page.locator('input[name="q"]');

      await searchBox.fill(email);

      const form =
        searchBox.locator('xpath=ancestor::form[1]');

      const submitButton = form
        .locator(
          'button[type="submit"], input[type="submit"]',
        )
        .first();

      await submitButton.click();
      await page.waitForLoadState('domcontentloaded');

      if (isLoginPage(page.url())) {
        this.authenticated = false;

        throw new Error(
          'TUNI Mailman session expired during member search',
        );
      }

      const normalizedEmail =
        email.trim().toLowerCase();

      return await page
        .locator('input.member-checkbox')
        .evaluateAll(
          (elements, targetEmail) =>
            elements.some(
              (element) =>
                (
                  element as HTMLInputElement
                ).value
                  .trim()
                  .toLowerCase() === targetEmail,
            ),
          normalizedEmail,
        );
    } finally {
      await page.close();
    }
  }

  async subscribe(
    email: string,
  ): Promise<SubscribeResult> {
    if (await this.isMember(email)) {
      return 'already-member';
    }

    const { massSubscribeUrl } = getUrls();

    const page =
      await this.openOwnerPage(massSubscribeUrl);

    try {
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

      await this.setCheckboxIfPresent(
        page,
        /send welcome message/i,
        false,
      );

      await this.submitForm(
        emails,
        /subscribe users/i,
      );
    } finally {
      await page.close();
    }

    if (!(await this.isMember(email))) {
      throw new Error(
        `TUNI Mailman reported subscription but ${email} is not a member`,
      );
    }

    return 'subscribed';
  }

  async unsubscribe(
    email: string,
  ): Promise<UnsubscribeResult> {
    if (!(await this.isMember(email))) {
      return 'not-member';
    }

    const { massRemoveUrl } = getUrls();

    const page =
      await this.openOwnerPage(massRemoveUrl);

    try {
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
    } finally {
      await page.close();
    }

    if (await this.isMember(email)) {
      throw new Error(
        `TUNI Mailman reported removal but ${email} is still a member`,
      );
    }

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

if (process.env.NODE_ENV !== 'production') {
  globalForMailman.__tuniMailman =
    tuniMailman;
}
