import { Context, Markup, Telegraf } from 'telegraf';
import * as _ from 'lodash';
import { CONSTANTS } from './constants';
import { CourseInfo, OpenUClient, OpenUCredentials } from './lib/grades';
const express = require('express');
const app = express();

const requiredParams = ['USER', 'PASSWORD', 'ID', 'BOT_TOKEN'];

requiredParams.forEach((param) => {
  const value = process.env[param];
  if (!value || value.length === 0)
    throw `Missing environment variable ${param}.`;
});

const credentials: OpenUCredentials = {
  username: process.env.USER,
  password: process.env.PASSWORD,
  id: process.env.ID,
};

let config = {
  credentials,

  telegramUsername: 'kubistikation',
  includeScreenshot: true,
  minGrade: process.env.MIN_GRADE || 85,
  showCredentials: process.env.DEBUG,
};

interface OpenUContext extends Context {
  cache: Array<CourseInfo>;
}

let registered = [];

const bot = new Telegraf<OpenUContext>(process.env.BOT_TOKEN);

function authMiddleware() {
  return (ctx: OpenUContext, next: Function) => {
    const allowed = ctx.from.username === config.telegramUsername;

    if (!allowed) {
      console.warn(`user ${ctx.from.username} tried to access your bot!`);
    } else {
      console.log(`allowing bot acces to ${ctx.from.username}`);
      return next();
    }
  };
}

bot.use(authMiddleware());

const openu = new OpenUClient(credentials);

function format(list: Array<CourseInfo>) {
  return list
    .map((c) => {
      const status = c.grades.final >= config.minGrade ? '✅' : '❗️';
      return `<b>${c.course}</b>: מבחן: ${c.grades.test}, סופי: ${c.grades.final} ${status}`;
    })
    .join('\n');
}

async function configure(ctx: OpenUContext) {
  await ctx.reply('להציג תמונה של טבלת הציונים?', {
    ...Markup.inlineKeyboard([
      Markup.button.callback('כן 👍', 'includePic'),
      Markup.button.callback('לא 👎', 'dontIncludePic'),
    ]),
  });
}

bot.action('includePic', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.editMessageReplyMarkup(null);
  config.includeScreenshot = true;
  ctx.reply(CONSTANTS.REPLY_MESSAGES.SETTINGS_UPDATED);
});

bot.action('dontIncludePic', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.editMessageReplyMarkup(null);
  config.includeScreenshot = false;
  ctx.reply(CONSTANTS.REPLY_MESSAGES.SETTINGS_UPDATED);
});

function onBeforeLogin(ctx: OpenUContext) {
  ctx.reply('מבצע התחברות...');
}

setInterval(() => {
  registered.forEach(async (chatId) => {
    const result = await openu.grades();
    if (config.includeScreenshot) {
      bot.telegram.sendPhoto(chatId, {
        source: Buffer.from(result.screenshot.toString(), 'base64'),
      });
    }

    bot.telegram.sendMessage(chatId, format(result.data), {
      parse_mode: 'HTML',
    });
  });
}, 1000 * 60 * 60 * 24);

async function handleUpdates(ctx: OpenUContext) {
  ctx.reply('נרשמת לעדכונים!');
  registered.push(ctx.chat.id);
}

async function handleGradesCommand(ctx: OpenUContext) {
  ctx.reply(CONSTANTS.REPLY_MESSAGES.CHECKING_GRADES);

  try {
    const result = await openu.grades(() => onBeforeLogin(ctx));

    if (ctx.cache && !_.isEqual(result.data, ctx.cache)) {
      await ctx.reply(CONSTANTS.REPLY_MESSAGES.NEW_GRADES);
      ctx.cache = result.data;
    } else {
      await ctx.reply(CONSTANTS.REPLY_MESSAGES.NO_CHANGES);
    }

    if (config.includeScreenshot) {
      await ctx.replyWithPhoto({
        source: Buffer.from(result.screenshot.toString(), 'base64'),
      });
    }
    await ctx.replyWithHTML(format(result.data));
  } catch (e) {
    ctx.reply(CONSTANTS.REPLY_MESSAGES.UNKNOWN_ERROR);
    console.log(e);
  }
}

async function shutdown(signal: string) {
  console.log('shutdown...');
  await openu.shutdown();
  bot.stop(signal);
}

async function main() {
  console.log('initiating...');

  bot.command('grades', handleGradesCommand);
  bot.command('configure', configure);
  bot.command('updates', handleUpdates);

  if (config.showCredentials)
    console.log(`using credentials: ${JSON.stringify(credentials, null, 2)}`);
  await openu.init();

  if (process.env.NODE_ENV === 'production') {
    const URL = 'https://kobi-openu-bot.herokuapp.com';
    const PORT = process.env.PORT || 3000;

    bot.telegram.setWebhook(`${URL}/bot${process.env.BOT_TOKEN}`);
    app.use(bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`));
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } else {
    bot.launch();
  }

  console.log('bot is up and running!');

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

(async () => {
  await main();
})();
