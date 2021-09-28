import { Context, Markup, Telegraf } from 'telegraf';
import * as _ from 'lodash';
import { CONSTANTS } from './constants';
import { CourseInfo, OpenUClient, OpenUCredentials } from './lib/grades';
import express = require('express');

enum ResultType {
  text,
  image,
}

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
  resultType: ResultType.image,
  minGrade: process.env.MIN_GRADE || 85,
  showCredentials: !(process.env.NODE_ENV === 'production'),
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

const openu = new OpenUClient();

function format(list: Array<CourseInfo>) {
  return list
    .map((c) => {
      const status = c.grades.final >= config.minGrade ? '✅' : '❗️';
      return `<b>${c.course}</b>: מבחן: ${c.grades.test}, סופי: ${c.grades.final} ${status}`;
    })
    .join('\n');
}

async function configure(ctx: OpenUContext) {
  await ctx.reply('איך תרצה לקבל את הציונים שלך?', {
    ...Markup.inlineKeyboard([
      Markup.button.callback('בתמונה 😎', 'resultTypeImage'),
      Markup.button.callback('בטקסט 💬', 'resultTypeText'),
    ]),
  });
}

bot.action('resultTypeImage', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.editMessageReplyMarkup(null);
  config.resultType = ResultType.image;
  ctx.reply(CONSTANTS.REPLY_MESSAGES.SETTINGS_UPDATED);
});

bot.action('resultTypeText', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.editMessageReplyMarkup(null);
  config.resultType = ResultType.text;
  ctx.reply(CONSTANTS.REPLY_MESSAGES.SETTINGS_UPDATED);
});

function onAuthRequired(ctx: OpenUContext): OpenUCredentials {
  ctx.reply('מבצע התחברות...');
  return config.credentials;
}

async function handleUpdates(ctx: OpenUContext) {
  ctx.reply('נרשמת לעדכונים!');
  registered.push(ctx.chat.id);
}

async function handleGradesCommand(ctx: OpenUContext) {
  await ctx.reply(CONSTANTS.REPLY_MESSAGES.CHECKING_GRADES);

  try {
    const result = await openu.grades(() => onAuthRequired(ctx));

    if (ctx.cache && !_.isEqual(result.data, ctx.cache)) {
      await ctx.reply(CONSTANTS.REPLY_MESSAGES.NEW_GRADES);
      ctx.cache = result.data;
    } else {
      await ctx.reply(CONSTANTS.REPLY_MESSAGES.NO_CHANGES);
    }

    if (config.resultType === ResultType.image) {
      await ctx.replyWithPhoto({
        source: Buffer.from(result.screenshot.toString(), 'base64'),
      });

      return;
    }

    await ctx.replyWithHTML(format(result.data));
  } catch (e) {
    await ctx.reply(CONSTANTS.REPLY_MESSAGES.UNKNOWN_ERROR);
    console.log(e);
  }
}

async function shutdown(signal: string) {
  console.log('shutdown...');
  await openu.shutdown();
  bot.stop(signal);
}

function startWebhook(app: express.Application, port: Number) {
  app.get('/ping', (req, res) => {
    return res.json({ ping: 'pong' });
  });
  app.use(bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`));
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
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
    const app = express();
    startWebhook(app, Number(process.env.PORT) || 3000);
    bot.telegram.setWebhook(`${URL}/bot${process.env.BOT_TOKEN}`);
  } else {
    console.log('launching bot in dev mode.');
    bot.launch();
  }

  console.log('bot is up and running!');

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

(async () => {
  await main();
})();
