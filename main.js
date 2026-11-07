const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { once } = require('events');
const { Command } = require('commander');

// ---------- Параметри командного рядка ----------
const program = new Command();

program
  .name('main.js')
  .description('Кешуючий проксі-сервер для картинок з https://http.cat')
  // -h за замовчуванням зайнятий під довідку, тому довідку лишаємо тільки як --help
  .helpOption('--help', 'показати довідку')
  .requiredOption('-h, --host <address>', 'адреса, на якій працює сервер')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до теки з кешованими картинками');

program.parse(process.argv);
const options = program.opts();

const host = options.host;
const port = Number(options.port);
const cacheDir = path.resolve(options.cache);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`error: некоректний порт "${options.port}" (ціле число від 1 до 65535)`);
  process.exit(1);
}

const METHODS = [];
const ALLOWED_METHODS = METHODS.join(', ');

// ---------- Допоміжні функції ----------

// Шлях має бути рівно "/<три цифри>", наприклад "/404".
// Повертає код як рядок або null, якщо шлях некоректний.
function parseCode(url) {
  const pathname = new URL(url, 'http://localhost').pathname;
  const match = /^\/(\d{3})$/.exec(pathname);
  return match ? match[1] : null;
}

function cacheFile(code) {
  return path.join(cacheDir, `${code}.jpg`);
}

function sendText(res, status, message, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(message);
}

// ---------- Обробники методів ----------

// ---------- Сервер ----------

const server = http.createServer(async (req, res) => {
  try {
    if (!METHODS.includes(req.method)) {
      sendText(res, 405, `Метод ${req.method} не підтримується`, { Allow: ALLOWED_METHODS });
      return;
    }

  } catch (err) {
    console.error(`${req.method} ${req.url}:`, err);
    if (!res.headersSent) {
      sendText(res, 500, 'Внутрішня помилка сервера');
    } else {
      res.end();
    }
  }
});

async function start() {
  try {
    await fs.mkdir(cacheDir, { recursive: true }); // створюємо теку кешу до приймання запитів
    server.listen(port, host);
    await once(server, 'listening'); // проміс замість колбека listen()
    console.log(`Проксі-сервер працює на http://${host}:${port}`);
    console.log(`Тека кешу: ${cacheDir}`);
  } catch (err) {
    console.error('Не вдалося запустити сервер:', err.message);
    process.exit(1);
  }
}

start();
