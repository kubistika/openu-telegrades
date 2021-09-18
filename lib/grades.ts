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
  courseName: string;
  testGrade: number;
  finalGrade: Number;
}

async function shouldLogin(page: Page) {
  await page.goto(URLS.GRADES);

  try {
    const elem = await page.waitForSelector('.blue_title', {
      timeout: 3000,
    });

    return elem == null;
  } catch (e) {
    if (e instanceof puppeteer.errors.TimeoutError) return true;
    throw e;
  }
}

async function login(page, credentials: OpenUCredentials) {
  console.log('navigating to login URL...');
  await page.goto(URLS.LOGIN);

  await page.waitForSelector('[name="p_user"]');
  await page.waitForSelector('[name="p_sisma"]');
  await page.waitForSelector('[name="p_mis_student"]');

  console.log('typing login credentials...');
  await page.type('[name="p_user"]', credentials.username);
  await page.type('[name="p_sisma"]', credentials.password);
  await page.type('[name="p_mis_student"]', credentials.id);

  await page.waitForSelector('[type="submit"]');
  await page.click('[type="submit"]');

  console.log('submitting login form...');

  await page.waitForSelector('.slick-choshen-main-page-single-click', {
    timeout: 3000,
  });

  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

async function fetchGradesFromTable(page: Page): Promise<Array<CourseInfo>> {
  await page.goto(URLS.GRADES);

  const gradesTableData = await page.evaluate(() => {
    const tables = document.getElementsByTagName('table');
    const gradesTable = tables[tables.length - 1];
    return Array.from(gradesTable.rows, (row) => {
      const columns = row.querySelectorAll('td');
      return Array.from(columns, (column) => column.innerText);
    });
  });

  let result: Array<CourseInfo> = [];

  for (let i = 1; i < gradesTableData.length; i++) {
    const row = gradesTableData[i];

    const courseName = row[COURSE_NAME_INDEX].replace('\n', '');
    const finalGrade = Number(row[FINAL_GRADE_INDEX]);
    const testGrade = Number(row[TEST_GRADE_INDEX]);

    // Skip courses without grades.
    if (finalGrade === 0 && testGrade === 0) continue;

    result.push({ courseName, testGrade, finalGrade });
  }

  return result;
}

/**
 * Returns your current grades.
   If needed, it performs a login process to access your data from OpenU.

 * @param  {Object} credentials     An object that contains `username`, `password` and `id`.
                                    Used for authentication against OpenU.
 * @return {Object}                 A list of grade objects.
                                    Each grade object contains `courseName`, `testGrade` and `finalGrade`.
 */

export async function grades(
  credentials: OpenUCredentials
): Promise<Array<CourseInfo>> {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: USER_DATA_DIR,
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(0);

  // If cookies availablee, load them.
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync('./data/cookies.json', 'utf8'));
    await page.setCookie.apply(page, cookies);
  }

  if (await shouldLogin(page)) {
    console.log('session does not exist, trying to login.');
    await login(page, credentials);
  } else {
    console.log('using existing session');
  }

  const result = await fetchGradesFromTable(page);
  await browser.close();
  return result;
}
