import { Context, Telegraf } from 'telegraf';
import * as _ from 'lodash';
import { CONSTANTS } from './constants';
import { CourseInfo, grades, OpenUCredentials } from './lib/grades';

const credentials: OpenUCredentials = {
  username: process.env.USER,
  password: process.env.PASSWORD,
  id: process.env.ID,
};

const config = {
  credentials,

  minGrade: process.env.MIN_GRADE || 85,
  showCredentials: process.env.DEBUG,
};

interface OpenUContext extends Context {
  cache: Array<CourseInfo>;
}

const bot = new Telegraf<OpenUContext>(process.env.BOT_TOKEN);

async function handleGradesCommand(ctx: OpenUContext) {
  ctx.reply(CONSTANTS.REPLY_MESSAGES.CHECKING_GRADES);

  try {
    const data = await grades(config.credentials);

    const response = data
      .map((g) => {
        const status = g.finalGrade >= config.minGrade ? '✅' : '❗️';
        return `<b>${g.courseName}</b>: מבחן: ${g.testGrade}, סופי: ${g.finalGrade} ${status}`;
      })
      .join('\n');

    if (ctx.cache && !_.isEqual(data, ctx.cache)) {
      await ctx.reply(CONSTANTS.REPLY_MESSAGES.NEW_GRADES);
      ctx.cache = data;
    } else {
      await ctx.reply(CONSTANTS.REPLY_MESSAGES.NO_CHANGES);
    }

    await ctx.replyWithHTML(response);
  } catch (e) {
    ctx.reply(CONSTANTS.REPLY_MESSAGES.UNKNOWN_ERROR);
    console.log(e);
  }
}

function main() {
  bot.command('grades', handleGradesCommand);

  console.log('initiating...');
  if (config.showCredentials)
    console.log(`using credentials: ${JSON.stringify(credentials)}`);

  bot.launch();

  console.log('bot is up and running!');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main();
