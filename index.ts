import { Context, Markup, Telegraf } from 'telegraf';
import * as _ from 'lodash';
import { CONSTANTS, ACTIONS } from './constants';
import { CourseInfo, OpenUClient, OpenUCredentials } from './lib/grades';
import express = require('express');

const requiredParams = [
  'TELEGRAM_USERNAME',
  'USER',
  'PASSWORD',
  'ID',
  'BOT_TOKEN',
];

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

  telegramUsername: process.env.TELEGRAM_USERNAME,
  showCredentials: !(process.env.NODE_ENV === 'production'),
};

interface OpenUContext extends Context {
  cache: Array<CourseInfo>;
}

const bot = new Telegraf<OpenUContext>(process.env.BOT_TOKEN);

function authMiddleware() {
  return async (ctx: OpenUContext, next: Function) => {
    const allowed = ctx.from.username === config.telegramUsername;

    if (!allowed) {
      console.warn(`user ${ctx.from.username} tried to access your bot!`);
      await ctx.reply(CONSTANTS.REPLY_MESSAGES.NOT_AUTHORIZED);
    } else {
      console.log(`allowing bot acces to ${ctx.from.username}`);
      return next();
    }
  };
}

bot.use(authMiddleware());

const openu = new OpenUClient();

async function configure(ctx: OpenUContext) {
  await ctx.reply('איך תרצה לקבל את הציונים שלך?', {
    ...Markup.inlineKeyboard([
      Markup.button.callback('בתמונה 😎', ACTIONS.SET_RESULT_TYPE_IMAGE),
      Markup.button.callback('בטקסט 💬', ACTIONS.SET_RESULT_TYPE_TEXT),
    ]),
  });
}

function onAuthRequired(ctx: OpenUContext): OpenUCredentials {
  ctx.reply('מבצע התחברות...');
  return config.credentials;
}

async function handleGradesCommand(ctx: OpenUContext) {
  await ctx.reply(CONSTANTS.REPLY_MESSAGES.CHECKING_GRADES);
  ctx.replyWithChatAction('upload_photo');

  const result = await openu.grades(() => onAuthRequired(ctx));
  let textUpdate: string;

  if (ctx.cache && !_.isEqual(result.data, ctx.cache)) {
    textUpdate = CONSTANTS.REPLY_MESSAGES.NEW_GRADES;
    ctx.cache = result.data;
  } else {
    textUpdate = CONSTANTS.REPLY_MESSAGES.NO_CHANGES;
  }

  await ctx.replyWithPhoto(
    {
      source: Buffer.from(result.screenshot.toString(), 'base64'),
    },
    { caption: textUpdate }
  );
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

function onError(e: any, ctx: OpenUContext) {
  console.log('error occured');
  console.log(e);

  if (!ctx) return;

  ctx.reply(CONSTANTS.REPLY_MESSAGES.UNKNOWN_ERROR);
}

async function main() {
  console.log('initiating...');

  bot.command('grades', handleGradesCommand);
  bot.command('configure', configure);
  bot.catch(onError);

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
