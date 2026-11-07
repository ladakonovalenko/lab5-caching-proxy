const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { once } = require('events');
const { Command } = require('commander');
const superagent = require('superagent');

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

const UPSTREAM = 'https://http.cat';
const METHODS = ['GET', 'PUT'];
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

function sendImage(res, data, source) {
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': data.length,
    'X-Cache': source, // HIT — з кешу, MISS — щойно отримано з http.cat
  });
  res.end(data);
}

// Читає все тіло запиту в один Buffer (потік читається через for await).
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Отримує картинку з http.cat. Повертає Buffer або null, якщо картинки немає / помилка.
async function fetchFromUpstream(code) {
  try {
    const response = await superagent
      .get(`${UPSTREAM}/${code}`)
      .responseType('blob'); // тіло відповіді як Buffer, без змін
    if (!Buffer.isBuffer(response.body) || response.body.length === 0) {
      return null;
    }
    return response.body;
  } catch (err) {
    const reason = err.status ? `статус ${err.status}` : err.message;
    console.error(`http.cat /${code}: ${reason}`);
    return null;
  }
}

// ---------- Обробники методів ----------

async function handleGet(code, res) {
  const file = cacheFile(code);
  try {
    const data = await fs.readFile(file);
    console.log(`GET /${code} — з кешу`);
    sendImage(res, data, 'HIT');
    return;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const data = await fetchFromUpstream(code);
  if (data === null) {
    sendText(res, 404, `Картинку для коду ${code} не знайдено ні в кеші, ні на http.cat`);
    return;
  }

  await fs.writeFile(file, data); // спочатку зберігаємо в кеш
  console.log(`GET /${code} — з http.cat, збережено в кеш`);
  sendImage(res, data, 'MISS'); // потім віддаємо клієнтові
}

async function handlePut(code, req, res) {
  const body = await readBody(req);
  if (body.length === 0) {
    sendText(res, 400, 'Тіло запиту порожнє — надішліть картинку');
    return;
  }
  await fs.writeFile(cacheFile(code), body);
  console.log(`PUT /${code} — записано ${body.length} байт`);
  sendText(res, 201, `Картинку для коду ${code} збережено в кеш`);
}

// ---------- Сервер ----------

const server = http.createServer(async (req, res) => {
  try {
    if (!METHODS.includes(req.method)) {
      sendText(res, 405, `Метод ${req.method} не підтримується`, { Allow: ALLOWED_METHODS });
      return;
    }

    const code = parseCode(req.url);
    if (code === null) {
      sendText(res, 404, 'Некоректний шлях: очікується /<код стану з трьох цифр>, наприклад /404');
      return;
    }

    if (req.method === 'GET') {
      await handleGet(code, res);
    } else {
      await handlePut(code, req, res);
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
