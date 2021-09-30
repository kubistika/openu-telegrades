import { Page } from 'puppeteer';
import fs = require('fs');
import puppeteer = require('puppeteer');

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const USER_DATA_DIR = './data';
const COOKIES_PATH = './data/cookies.json';
const FAKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36';

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

  private async shouldLogin(page: Page) {
    try {
      console.log('shouldLogin: before page.goto');
      await page.goto(URLS.GRADES);
      console.log('should login: before wait for selector');
      const elem = await page.waitForSelector('.blue_title', {
        timeout: 100,
      });
      console.log('should login: after wait for selector');

      return elem == null;
    } catch (e) {
      console.log(
        'should login: caught timeout while waiting for `.blue_title`'
      );
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
    await page.waitForSelector('[type="submit"]');

    console.log('typing login credentials...');
    await page.type('[name="p_user"]', credentials.username);
    await page.type('[name="p_sisma"]', credentials.password);
    await page.type('[name="p_mis_student"]', credentials.id);

    console.log('submitting login form...');
    await Promise.all([
      page.click('[type="submit"]'),
      page.waitForNavigation(),
    ]);

    this.saveCookies(await page.cookies());
  }

  private saveCookies(cookies: puppeteer.Protocol.Network.Cookie[]) {
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  }

  private async fetchGradesFromTable(page: Page): Promise<GradesResult> {
    await page.goto(URLS.GRADES);
    console.log(`currently in ${page.url()}`);
    let data = [];

    const tables = await page.$$('table');
    if (!tables || tables.length === 0)
      throw new Error('Could not find the grades tables');

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
      args: [
        '--ignore-certificate-errors',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--autoplay-policy=user-gesture-required',
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

    page.on('dialog', async (dialog) => {
      console.log(`got dialog: ${dialog.message()}`);
      await dialog.accept();
    });

    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);
    page.setRequestInterception(false);

    // Set fake user agent.
    await page.setUserAgent(FAKE_USER_AGENT);

    return page;
  }

  /**
   * Returns a list of grades.
   * If needed, it performs a login process to access your data from OpenU.
   *
   * param @authFn a callback function to resolve credentials.
   */
  public async grades(authFn: () => OpenUCredentials): Promise<GradesResult> {
    const page = await this.createPage();
    await this.setCookies(page);

    if (await this.shouldLogin(page)) {
      console.log('session does not exist, trying to login.');
      await this.login(page, authFn());
      console.log('login success');
    } else {
      console.log('using existing session');
    }

    console.log('before fetchGradesFromTable');
    const result = await this.fetchGradesFromTable(page);
    console.log('after fetchGradesFromTable');
    await page.close();
    return result;
  }
}
