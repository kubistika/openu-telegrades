import { Page } from 'puppeteer';
import fs = require('fs');
import puppeteer = require('puppeteer');

const USER_DATA_DIR = './data';
const COOKIES_PATH = './data/cookies.json';

const FINAL_GRADE_INDEX = 4;
const TEST_GRADE_INDEX = 5;
const COURSE_NAME_INDEX = 7;

const URLS = {
  LOGIN: 'https://sheilta.apps.openu.ac.il/pls/dmyopt2/myop.myop_screen',
  GRADES:
    'https://sheilta.apps.openu.ac.il/pls/dmyopt2/course_info.courses?p_from=1',
};

export interface OpenUCredentials {
  username: string;
  password: string;
  id: string;
}

export interface CourseInfo {
  course: string;
  grades: {
    test: Number;
    final: Number;
  };
}

export interface GradesResult {
  data: Array<CourseInfo>;
  screenshot: Buffer;
}

export class OpenUClient {
  private browser: puppeteer.Browser = null;
  private credentials: OpenUCredentials;

  constructor(credentials: OpenUCredentials) {
    this.credentials = credentials;
  }

  private async shouldLogin(page: Page) {
    await page.goto(URLS.GRADES);

    try {
      const elem = await page.waitForSelector('.blue_title', {
        timeout: 100,
      });

      return elem == null;
    } catch (e) {
      if (e instanceof puppeteer.errors.TimeoutError) return true;
      throw e;
    }
  }

  private async login(page: Page, credentials: OpenUCredentials) {
    console.log('navigating to login URL...');
    await page.goto(URLS.LOGIN);

    await page.waitForSelector('[name="p_user"]');
    await page.waitForSelector('[name="p_sisma"]');
    await page.waitForSelector('[name="p_mis_student"]');

    console.log('typing login credentials...');
    await page.type('[name="p_user"]', credentials.username);
    await page.type('[name="p_sisma"]', credentials.password);
    await page.type('[name="p_mis_student"]', credentials.id);

    console.log('submitting login form...');
    await page.waitForSelector('[type="submit"]');
    await Promise.all([
      page.click('[type="submit"]'),
      page.waitForNavigation(),
    ]);

    this.saveCookies(await page.cookies());
  }

  private saveCookies(cookies) {
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  }

  private async fetchGradesFromTable(page: Page): Promise<GradesResult> {
    await page.goto(URLS.GRADES);
    let data = [];

    const tables = await page.$$('table');
    const lastTable = tables[tables.length - 1];
    const buffer = await lastTable.screenshot({
      encoding: 'base64',
    });
    const screenshot = <Buffer>buffer;

    const gradesTableData = await page.evaluate(() => {
      const tables = document.getElementsByTagName('table');
      const gradesTable = tables[tables.length - 1];
      return Array.from(gradesTable.rows, (row) => {
        const columns = row.querySelectorAll('td');
        return Array.from(columns, (column) => column.innerText);
      });
    });

    for (let i = 1; i < gradesTableData.length; i++) {
      const row = gradesTableData[i];

      const course = row[COURSE_NAME_INDEX].replace('\n', '');
      const finalGrade = Number(row[FINAL_GRADE_INDEX]);
      const testGrade = Number(row[TEST_GRADE_INDEX]);

      // Skip courses that we do not have grades for yet.
      if (finalGrade === 0 && testGrade === 0) continue;

      data.push({
        course,
        grades: {
          test: testGrade,
          final: finalGrade,
        },
      });
    }

    return { data, screenshot };
  }

  public async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      userDataDir: USER_DATA_DIR,
      devtools: true,
      args: [
        '--ignore-certificate-errors',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });
  }

  /**
   *  Must be called in order to clear resources.
   */
  public async shutdown() {
    return this.browser.close();
  }

  private async setCookies(page: Page) {
    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(
        fs.readFileSync('./data/cookies.json', 'utf8')
      );
      return page.setCookie.apply(page, cookies);
    }
  }

  private async createPage() {
    const page = await this.browser.newPage();
    await page.setViewport({
      width: 1200,
      height: 800,
      deviceScaleFactor: 2,
    });
    page.setDefaultNavigationTimeout(0);
    return page;
  }

  /**
   * Returns a list of grades.
   * If needed, it performs a login process to access your data from OpenU.
   */
  public async grades(loginFn: Function = null): Promise<GradesResult> {
    const page = await this.createPage();
    await this.setCookies(page);

    if (await this.shouldLogin(page)) {
      if (loginFn) loginFn();

      console.log('session does not exist, trying to login.');
      await this.login(page, this.credentials);
    } else {
      console.log('using existing session');
    }

    const result = await this.fetchGradesFromTable(page);
    await page.close();
    return result;
  }
}
