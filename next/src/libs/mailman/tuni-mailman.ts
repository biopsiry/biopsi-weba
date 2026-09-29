import 'server-only';

import {
    chromium,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
} from 'playwright';

const BASE_URL = 'https://lists.tuni.fi';

const LIST_ID = process.env.TUNI_MAILMAN_LIST_ID;
const LOGIN_URL = `${BASE_URL}/accounts/login/`;
const MEMBERS_URL = `${BASE_URL}/mailman3/lists/${LIST_ID}/members/member/`;
const MASS_SUBSCRIBE_URL = `${BASE_URL}/mailman3/lists/${LIST_ID}/mass_subscribe/`;
const MASS_REMOVE_URL = `${BASE_URL}/mailman3/lists/${LIST_ID}/mass_removal/`;

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

  return {
    username,
    password,
  };
}

function isLoginPage(url: string) {
  return url.includes('/accounts/login');
}

class TuniMailman {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  private authenticated = false;
  private loginPromise: Promise<void> | null = null;

  private async start() {
    if (this.browser && this.context) {
      return;
    }

    this.browser = await chromium.launch({
      headless:
        process.env.TUNI_MAILMAN_HEADLESS !== 'false',
    });

    this.context = await this.browser.newContext();
  }

  private async login() {
    await this.start();

    const { username, password } = getCredentials();

    const page = await this.context!.newPage();

    try {
      await page.goto(LOGIN_URL, {
        waitUntil: 'domcontentloaded',
      });

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

      await loginInput.waitFor({
        state: 'visible',
      });

      await passwordInput.waitFor({
        state: 'visible',
      });

      await loginInput.fill(username);
      await passwordInput.fill(password);

      const form =
        passwordInput.locator('xpath=ancestor::form[1]');

      const submitButton = form
        .locator(
          'button[type="submit"], input[type="submit"]',
        )
        .first();

      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        submitButton.click(),
      ]);

      await page.goto(MEMBERS_URL, {
        waitUntil: 'domcontentloaded',
      });

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
    } finally {
      await page.close();
    }
  }

  private async ensureLoggedIn(force = false) {
    await this.start();

    if (this.authenticated && !force) {
      return;
    }

    // Prevent simultaneous profile requests from all logging in.
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

  private async openOwnerPage(
    url: string,
  ): Promise<Page> {
    await this.ensureLoggedIn();

    let page = await this.context!.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
    });

    // Session may have expired.
    if (isLoginPage(page.url())) {
      this.authenticated = false;

      await page.close();

      await this.ensureLoggedIn(true);

      page = await this.context!.newPage();

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
      });
    }

    if (isLoginPage(page.url())) {
      await page.close();

      throw new Error(
        'Unable to authenticate with TUNI Mailman',
      );
    }

    return page;
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

    await Promise.all([
      field
        .page()
        .waitForLoadState('domcontentloaded'),
      submitButton.click(),
    ]);
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
    const page =
      await this.openOwnerPage(MEMBERS_URL);

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

      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        submitButton.click(),
      ]);

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

    const page =
      await this.openOwnerPage(
        MASS_SUBSCRIBE_URL,
      );

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

    const page =
      await this.openOwnerPage(MASS_REMOVE_URL);

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

const globalForMailman = globalThis as typeof globalThis & {
  __tuniMailman?: TuniMailman;
};

export const tuniMailman =
  globalForMailman.__tuniMailman ??
  new TuniMailman();

if (process.env.NODE_ENV !== 'production') {
  globalForMailman.__tuniMailman =
    tuniMailman;
}
