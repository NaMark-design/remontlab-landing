/* Проверки веб-версии калькулятора «РемонтЛаб».
   Запуск из папки лендинга:  node --test tests/

   Зависимости не используются: только node:test, node:assert и модули лендинга. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateQuote, EXTRA_IDS, EXTRA_RULES, PACKAGE_IDS } from '../js/calculator-core.mjs';
import { priceBook, PRICE_SOURCE_ID, PRICE_SOURCE_LABEL } from '../js/demo-price.mjs';
import {
  adaptCoreMessage,
  buildQuoteSummary,
  formatRub,
  SCHEMA_VERSION,
  serializeSummary,
  toSerializable,
} from '../js/calculator-ui.mjs';
import {
  FORM_URL,
  FORM_SUMMARY_PARAM,
  MAX_URL_LENGTH,
  buildFormSummaryText,
  buildFormUrl,
} from '../js/yandex-form.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* Группирующие пробелы в ru-RU отличаются по кодовой точке (NBSP / узкий NBSP),
   поэтому при сравнении текста они приводятся к обычному пробелу. */
function norm(text) {
  return String(text).replace(/[\u00a0\u202f\u2009]/g, ' ');
}

function extras(entries) {
  const result = {};
  for (const [id, quantity] of Object.entries(entries)) {
    result[id] = { checked: true, quantity: String(quantity) };
  }
  return result;
}

function allUnchecked() {
  const result = {};
  for (const id of EXTRA_IDS) {
    result[id] = { checked: false, quantity: '' };
  }
  return result;
}

function expectTotal(input, expectedKopecks, label) {
  const result = calculateQuote(input, priceBook);
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.errors)}`);
  assert.equal(result.quote.totalKopecks, expectedKopecks, label);

  const sum = result.quote.lines.reduce((total, line) => total + line.amountKopecks, 0);
  assert.equal(result.quote.totalKopecks, sum, `${label}: итог равен сумме строк`);

  return result;
}

/* ---------- Контрольные примеры учебного прайса ---------- */

test('T01: 40 м², PKG_COS, без дополнительных услуг — 140 000,00 ₽', () => {
  expectTotal({ area: '40', packageId: 'PKG_COS', extras: allUnchecked() }, 14_000_000, 'T01');
});

test('T02: 50 м², PKG_STD, демонтаж, точки, мусор, уборка — 352 600,00 ₽', () => {
  const result = expectTotal({
    area: '50',
    packageId: 'PKG_STD',
    extras: {
      OPT_DEM: { checked: true, quantity: '20' },
      OPT_SOCKET: { checked: true, quantity: '4' },
      OPT_WASTE: { checked: true, quantity: '' },
      OPT_CLEAN: { checked: true, quantity: '' },
      OPT_SOUND: { checked: false, quantity: '' },
      OPT_DOOR: { checked: false, quantity: '' },
    },
  }, 35_260_000, 'T02');

  assert.equal(norm(formatRub(result.quote.totalKopecks)), '352 600,00 ₽');
});

test('T03: 62,5 м², PKG_CAP, шумоизоляция, двери, мусор — 636 850,00 ₽', () => {
  expectTotal({
    area: '62,5',
    packageId: 'PKG_CAP',
    extras: {
      OPT_SOUND: { checked: true, quantity: '18' },
      OPT_DOOR: { checked: true, quantity: '3' },
      OPT_WASTE: { checked: true, quantity: '' },
    },
  }, 63_685_000, 'T03');
});

test('T04: 25 м², PKG_COS, уборка по площади отделки — 92 000,00 ₽', () => {
  const result = expectTotal({
    area: '25',
    packageId: 'PKG_COS',
    extras: { OPT_CLEAN: { checked: true, quantity: '' } },
  }, 9_200_000, 'T04');

  const clean = result.quote.lines.find((line) => line.id === 'OPT_CLEAN');
  assert.equal(clean.quantityHundredths, 2500, 'уборка считается по площади отделки');
});

test('итог каждого контрольного примера равен сумме округлённых строк', () => {
  const cases = [
    { area: '40', packageId: 'PKG_COS', extras: allUnchecked() },
    { area: '50', packageId: 'PKG_STD', extras: extras({ OPT_DEM: '20', OPT_SOCKET: '4', OPT_WASTE: '', OPT_CLEAN: '' }) },
    { area: '62,5', packageId: 'PKG_CAP', extras: extras({ OPT_SOUND: '18', OPT_DOOR: '3', OPT_WASTE: '' }) },
    { area: '25', packageId: 'PKG_COS', extras: extras({ OPT_CLEAN: '' }) },
  ];

  for (const input of cases) {
    const result = calculateQuote(input, priceBook);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      result.quote.totalKopecks,
      result.quote.lines.reduce((sum, line) => sum + line.amountKopecks, 0),
    );
  }
});

/* ---------- Отклонения ввода ---------- */

test('площадь 0 отклоняется', () => {
  const result = calculateQuote({ area: '0', packageId: 'PKG_COS', extras: {} }, priceBook);
  assert.equal(result.ok, false);
  assert.match(result.errors.area, /от 1 до 500/);
});

test('площадь 501 отклоняется', () => {
  const result = calculateQuote({ area: '501', packageId: 'PKG_COS', extras: {} }, priceBook);
  assert.equal(result.ok, false);
  assert.match(result.errors.area, /от 1 до 500/);
});

test('площадь с более чем двумя знаками после запятой отклоняется', () => {
  const result = calculateQuote({ area: '40,123', packageId: 'PKG_COS', extras: {} }, priceBook);
  assert.equal(result.ok, false);
  assert.match(result.errors.area, /не более двух знаков/);
});

test('пустая площадь отклоняется', () => {
  const result = calculateQuote({ area: '', packageId: 'PKG_COS', extras: {} }, priceBook);
  assert.equal(result.ok, false);
  assert.match(result.errors.area, /Введите площадь/);
});

test('площадь демонтажа больше площади отделки отклоняется', () => {
  const result = calculateQuote({
    area: '40',
    packageId: 'PKG_COS',
    extras: { OPT_DEM: { checked: true, quantity: '40,01' } },
  }, priceBook);

  assert.equal(result.ok, false);
  assert.match(result.errors.OPT_DEM, /не может быть больше площади/);
});

test('дробное количество дверей отклоняется', () => {
  const result = calculateQuote({
    area: '40',
    packageId: 'PKG_COS',
    extras: { OPT_DOOR: { checked: true, quantity: '1,5' } },
  }, priceBook);

  assert.equal(result.ok, false);
  assert.match(result.errors.OPT_DOOR, /целым числом/);
});

test('дробное количество электрических точек отклоняется', () => {
  const result = calculateQuote({
    area: '40',
    packageId: 'PKG_COS',
    extras: { OPT_SOCKET: { checked: true, quantity: '2,5' } },
  }, priceBook);

  assert.equal(result.ok, false);
  assert.match(result.errors.OPT_SOCKET, /целым числом/);
});

test('отсутствие пакета вызывает ошибку', () => {
  const result = calculateQuote({ area: '40', packageId: '', extras: {} }, priceBook);
  assert.equal(result.ok, false);
  assert.match(result.errors.package, /Выберите один пакет/);
});

test('выключенные опции с пустыми количествами не вызывают ошибок', () => {
  const result = calculateQuote({
    area: '40',
    packageId: 'PKG_COS',
    extras: allUnchecked(),
  }, priceBook);

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.quote.lines.length, 1, 'в расчёте только пакет');
});

test('пределы количества взяты из фактического кода ядра', () => {
  assert.equal(EXTRA_RULES.OPT_SOCKET.max, 200);
  assert.equal(EXTRA_RULES.OPT_DOOR.max, 50);
  assert.equal(EXTRA_RULES.OPT_SOUND.maxHundredths, 200_000);
  assert.equal(EXTRA_RULES.OPT_DEM.maxHundredths, 50_000);
  assert.equal(PACKAGE_IDS.length, 3);
  assert.equal(EXTRA_IDS.length, 6);
});

/* ---------- Адаптация сообщений ядра ---------- */

test('пять сообщений с квартирой адаптируются под отделку', () => {
  const pairs = [
    ['Введите площадь квартиры.', 'Введите площадь отделки.'],
    ['Площадь квартиры должна быть от 1 до 500 м².', 'Площадь отделки должна быть от 1 до 500 м².'],
    ['Для уборки сначала укажите корректную площадь квартиры.', 'Для уборки сначала укажите корректную площадь отделки.'],
    ['Площадь демонтажа не может быть больше площади квартиры.', 'Площадь демонтажа не может быть больше площади отделки.'],
    ['Сначала укажите корректную площадь квартиры.', 'Сначала укажите корректную площадь отделки.'],
  ];

  for (const [core, ui] of pairs) {
    assert.equal(adaptCoreMessage(core), ui, core);
  }
});

test('ядро по-прежнему отдаёт исходные сообщения с квартирой', () => {
  const empty = calculateQuote({ area: '', packageId: 'PKG_COS', extras: {} }, priceBook);
  assert.equal(empty.errors.area, 'Введите площадь квартиры.');

  const tooBig = calculateQuote({
    area: '40',
    packageId: 'PKG_COS',
    extras: { OPT_DEM: { checked: true, quantity: '40,01' } },
  }, priceBook);
  assert.equal(tooBig.errors.OPT_DEM, 'Площадь демонтажа не может быть больше площади квартиры.');
});

test('остальные сообщения ядра не заменяются общим текстом', () => {
  const format = calculateQuote({ area: 'abc', packageId: 'PKG_COS', extras: {} }, priceBook);
  assert.equal(adaptCoreMessage(format.errors.area), format.errors.area);
  assert.match(format.errors.area, /Укажите площадь числом/);

  const noPackage = calculateQuote({ area: '40', packageId: '', extras: {} }, priceBook);
  assert.equal(adaptCoreMessage(noPackage.errors.package), noPackage.errors.package);
});

/* ---------- Статический учебный прайс ---------- */

test('в прайсе ровно 9 позиций: 3 пакета и 6 дополнительных услуг', () => {
  assert.equal(priceBook.entries.length, 9);
  assert.equal(priceBook.counts.total, 9);
  assert.equal(priceBook.counts.packages, 3);
  assert.equal(priceBook.counts.extras, 6);
  assert.equal(priceBook.source, 'Статический учебный прайс');
  assert.equal(PRICE_SOURCE_LABEL, 'Статический учебный прайс');
  assert.equal(PRICE_SOURCE_ID, 'static-demo-price');
});

test('цены хранятся целыми копейками', () => {
  const expected = {
    PKG_COS: 350_000,
    PKG_STD: 650_000,
    PKG_CAP: 950_000,
    OPT_DEM: 35_000,
    OPT_SOUND: 120_000,
    OPT_SOCKET: 90_000,
    OPT_DOOR: 450_000,
    OPT_WASTE: 800_000,
    OPT_CLEAN: 18_000,
  };

  for (const entry of priceBook.entries) {
    assert.equal(Number.isInteger(entry.priceKopecks), true, entry.id);
    assert.equal(entry.priceKopecks, expected[entry.id], entry.id);
  }
});

test('исходные описания прайса сохранены, включая уборку по квартире', () => {
  const clean = priceBook.entries.find((entry) => entry.id === 'OPT_CLEAN');
  assert.equal(clean.description, 'Рассчитывается по площади квартиры; не включена в пакеты');
  assert.equal(priceBook.source, 'Статический учебный прайс');
});

/* ---------- Разметка страницы ---------- */

test('разметка позиций совпадает с прайсом (название, цена, описание)', () => {
  const uiDescriptions = {
    OPT_CLEAN: 'Рассчитывается по указанной площади отделки',
  };

  for (const entry of priceBook.entries) {
    const start = HTML.indexOf(`data-entry-id="${entry.id}"`);
    assert.notEqual(start, -1, `В разметке нет позиции ${entry.id}`);

    const next = HTML.indexOf('data-entry-id="', start + 1);
    const block = HTML.slice(start, next === -1 ? HTML.length : next);
    const plain = block.replace(/&nbsp;/g, ' ');

    assert.ok(plain.includes(entry.name), `${entry.id}: название`);
    assert.ok(
      plain.includes(uiDescriptions[entry.id] ?? entry.description),
      `${entry.id}: описание`,
    );
    assert.ok(
      plain.includes(`${norm(formatRub(entry.priceKopecks))} / ${entry.unit}`),
      `${entry.id}: цена за единицу`,
    );
  }
});

test('разделы, ссылки и отсутствие временных признаков', () => {
  assert.ok(HTML.includes('id="calculator"'), 'есть раздел #calculator');
  assert.ok(HTML.includes('id="interiors"'), 'есть раздел #interiors');
  assert.equal((HTML.match(/href="#calculator"/g) ?? []).length, 2, 'две ссылки на расчёт');
  assert.ok(HTML.includes('href="#interiors"'), 'ссылка на интерьеры на месте');
  assert.ok(!HTML.includes('data-prototype-message'), 'признаки заглушек удалены');
  assert.ok(!HTML.includes('data-status'), 'статусная область заглушек удалена');
  assert.ok(!HTML.includes('script.js'), 'старый файл заглушек не подключается');
});

test('пять сообщений об ошибках присутствуют в UI-слое', () => {
  const uiSource = fs.readFileSync(path.join(ROOT, 'js', 'calculator-ui.mjs'), 'utf8');
  const messages = [
    'Введите площадь отделки.',
    'Площадь отделки должна быть от 1 до 500 м².',
    'Для уборки сначала укажите корректную площадь отделки.',
    'Площадь демонтажа не может быть больше площади отделки.',
    'Сначала укажите корректную площадь отделки.',
  ];
  for (const message of messages) {
    assert.ok(uiSource.includes(message), message);
  }
});

test('формат суммы — рубли с двумя знаками после запятой', () => {
  assert.equal(norm(formatRub(14_000_000)), '140 000,00 ₽');
  assert.equal(norm(formatRub(35_260_000)), '352 600,00 ₽');
  assert.equal(norm(formatRub(63_685_000)), '636 850,00 ₽');
  assert.equal(norm(formatRub(9_200_000)), '92 000,00 ₽');
  assert.equal(norm(formatRub(350_000)), '3 500,00 ₽');
  assert.equal(norm(formatRub(1)), '0,01 ₽');
});

/* ---------- Сводка для будущей интеграции ---------- */

test('сводка содержит схему, источник, ввод, пакет, услуги, строки и итог', () => {
  const input = {
    area: '62,5',
    packageId: 'PKG_CAP',
    extras: extras({ OPT_SOUND: '18', OPT_DOOR: '3', OPT_WASTE: '' }),
  };
  const result = calculateQuote(input, priceBook);
  const summary = buildQuoteSummary(input, result, priceBook);

  assert.equal(summary.schemaVersion, SCHEMA_VERSION);
  assert.equal(summary.priceSource.id, 'static-demo-price');
  assert.equal(summary.priceSource.label, 'Статический учебный прайс');
  assert.equal(summary.area.input, '62,5');
  assert.equal(summary.area.hundredths, 6250);
  assert.equal(summary.package.id, 'PKG_CAP');
  assert.equal(summary.package.name, 'Капитальный ремонт');
  assert.equal(summary.extras.length, 3);
  assert.equal(summary.lines.length, 4);
  assert.equal(summary.totalKopecks, 63_685_000);
  assert.equal(norm(summary.totalText), '636 850,00 ₽');
  assert.ok(norm(summary.text).includes('Площадь отделки: 62,5 м²'));
  assert.ok(norm(summary.text).includes('Итого: 636 850,00 ₽'));

  for (const line of summary.lines) {
    assert.equal(typeof line.amountKopecks, 'number');
    assert.equal(typeof line.unitPriceKopecks, 'number');
  }
});

test('сводка сериализуется в JSON', () => {
  const input = { area: '40', packageId: 'PKG_COS', extras: allUnchecked() };
  const result = calculateQuote(input, priceBook);
  const summary = buildQuoteSummary(input, result, priceBook);

  const json = serializeSummary(summary);
  const restored = JSON.parse(json);

  assert.equal(restored.schemaVersion, SCHEMA_VERSION);
  assert.equal(restored.totalKopecks, 14_000_000);
  assert.equal(restored.package.id, 'PKG_COS');
  assert.equal(restored.lines.length, 1);
  assert.equal(restored.extras.length, 0);
});

test('BigInt не проходит через JSON.stringify напрямую', () => {
  const payload = { totalKopecks: 9_007_199_254_740_993n, name: 'x' };
  const json = serializeSummary(payload);

  assert.ok(json.includes('"9007199254740993"'), 'BigInt сохранён строкой без потери точности');
  assert.equal(toSerializable(payload).totalKopecks, '9007199254740993');
  assert.doesNotThrow(() => JSON.parse(json));
});

test('сводка не строится по неуспешному результату', () => {
  const failed = calculateQuote({ area: '', packageId: 'PKG_COS', extras: {} }, priceBook);
  assert.throws(() => buildQuoteSummary({ area: '', packageId: 'PKG_COS', extras: {} }, failed));
});

/* ---------- Ссылка на Яндекс Форму ---------- */

function t02Summary() {
  const input = {
    area: '50',
    packageId: 'PKG_STD',
    extras: {
      OPT_DEM: { checked: true, quantity: '20' },
      OPT_SOCKET: { checked: true, quantity: '4' },
      OPT_WASTE: { checked: true, quantity: '' },
      OPT_CLEAN: { checked: true, quantity: '' },
      OPT_SOUND: { checked: false, quantity: '' },
      OPT_DOOR: { checked: false, quantity: '' },
    },
  };
  const result = calculateQuote(input, priceBook);
  return { input, result, summary: buildQuoteSummary(input, result, priceBook) };
}

test('сводка для формы: площадь, пакет, услуги, количества, итог и предупреждение', () => {
  const { summary } = t02Summary();
  const text = buildFormSummaryText(summary);

  assert.equal(typeof text, 'string');
  assert.ok(text.includes('Площадь отделки: 50 м².'));
  assert.ok(text.includes('Пакет: Стандартный ремонт.'));
  assert.ok(text.includes('Дополнительно:'));
  assert.ok(text.includes('— Демонтаж старого напольного покрытия: 20 м².'));
  assert.ok(text.includes('— Дополнительная электрическая точка: 4 шт.'));
  assert.ok(!text.includes('..'), 'нет двойной точки после единицы «шт.»');
  assert.ok(text.includes('— Вывоз строительного мусора: 1 заказ.'));
  assert.ok(text.includes('— Послеремонтная уборка: 50 м².'));
  assert.ok(text.includes('Учебный расчёт, без материалов.'));
});

test('сумма в сводке формы равна фактическому итогу калькулятора', () => {
  const { result, summary } = t02Summary();
  const text = buildFormSummaryText(summary);

  assert.equal(summary.totalKopecks, result.quote.totalKopecks);
  assert.ok(
    text.includes(`Предварительная стоимость работ: ${formatRub(result.quote.totalKopecks)}.`),
    'итог берётся из того же результата, что и у посетителя',
  );
  assert.ok(norm(text).includes('352 600,00 ₽'), 'T02: 352 600,00 ₽');
});

test('сводка без дополнительных услуг: «Дополнительно: не выбрано.»', () => {
  const input = { area: '40', packageId: 'PKG_COS', extras: allUnchecked() };
  const result = calculateQuote(input, priceBook);
  const summary = buildQuoteSummary(input, result, priceBook);
  const text = buildFormSummaryText(summary);

  assert.ok(text.includes('Дополнительно: не выбрано.'));
  assert.ok(!text.includes('\n— '), 'строк услуг нет');
  assert.ok(norm(text).includes('Предварительная стоимость работ: 140 000,00 ₽.'));
});

test('количество уборки и мусора взято из фактического результата', () => {
  const { result, summary } = t02Summary();
  const cleanLine = result.quote.lines.find((line) => line.id === 'OPT_CLEAN');
  const wasteLine = result.quote.lines.find((line) => line.id === 'OPT_WASTE');
  const text = buildFormSummaryText(summary);

  assert.equal(cleanLine.quantityText, '50');
  assert.equal(wasteLine.quantityText, '1');
  assert.ok(text.includes(`— ${cleanLine.name}: ${cleanLine.quantityText} ${cleanLine.unit}.`));
  assert.ok(text.includes(`— ${wasteLine.name}: ${wasteLine.quantityText} ${wasteLine.unit}.`));
});

test('адрес формы и имя URL-параметра точные', () => {
  assert.equal(FORM_URL, 'https://forms.yandex.ru/u/6aef09c9974ab251f3bde026');
  assert.equal(FORM_SUMMARY_PARAM, 'answer_long_text_9008993305765748');
  assert.equal(MAX_URL_LENGTH, 32000, 'лимит официальной документации Яндекса');
});

test('URL содержит адрес формы и параметр со сводкой', () => {
  const { summary } = t02Summary();
  const built = buildFormUrl(summary);

  assert.equal(built.ok, true, built.reason ?? '');
  assert.ok(built.url.startsWith(`${FORM_URL}?`));
  assert.ok(built.url.includes(`${FORM_SUMMARY_PARAM}=`));
  assert.ok(built.url.length <= MAX_URL_LENGTH);
});

test('после создания URL searchParams.get возвращает исходный текст сводки', () => {
  const { summary } = t02Summary();
  const built = buildFormUrl(summary);
  const text = buildFormSummaryText(summary);

  const restored = new URL(built.url).searchParams.get(FORM_SUMMARY_PARAM);
  assert.equal(restored, text, 'точное совпадение, включая переносы строк');
  assert.ok(restored.includes('\n'), 'переносы строк сохранены');
  assert.ok(restored.includes('м²'), 'символ м² сохранён');
  assert.ok(restored.includes('₽'), 'символ ₽ сохранён');
  assert.ok(/[А-Яа-яЁё]/.test(restored), 'кириллица сохранена');
});

test('знак процента, амперсанд и плюс передаются без искажений', () => {
  const { summary } = t02Summary();
  const tricky = structuredClone(summary);
  tricky.package.name = 'Пакет 10% & + образец';
  tricky.extras[0].name = 'Работа 50% & ещё +1';

  const built = buildFormUrl(tricky);
  assert.equal(built.ok, true, built.reason ?? '');

  const restored = new URL(built.url).searchParams.get(FORM_SUMMARY_PARAM);
  assert.equal(restored, built.text, 'после построения и чтения текст совпадает бит в бит');
  assert.ok(restored.includes('Пакет 10% & + образец.'));
  assert.ok(restored.includes('— Работа 50% & ещё +1:'));
  assert.ok(restored.includes('%'));
});

test('слишком длинная ссылка не создаётся', () => {
  const { summary } = t02Summary();
  const huge = structuredClone(summary);
  huge.package.name = 'Капитальный ремонт '.repeat(2000);

  const built = buildFormUrl(huge);
  assert.equal(built.ok, false);
  assert.equal(built.reason, 'too-long');
  assert.equal(built.url, null);
  assert.ok(built.length > MAX_URL_LENGTH);
});

test('некорректная сводка не даёт ссылку', () => {
  const bad = [
    null,
    undefined,
    {},
    { ...t02Summary().summary, totalText: '' },
    { ...t02Summary().summary, totalKopecks: Number.NaN },
    { ...t02Summary().summary, extras: 'nope' },
    { ...t02Summary().summary, lines: [] },
    { ...t02Summary().summary, package: { name: '' } },
  ];

  for (const summary of bad) {
    const built = buildFormUrl(summary);
    assert.equal(built.ok, false, JSON.stringify(summary)?.slice(0, 60));
    assert.equal(built.reason, 'invalid-summary');
    assert.equal(buildFormSummaryText(summary), null);
  }
});

test('разметка действия «Обсудить расчёт» присутствует и скрыта по умолчанию', () => {
  assert.ok(HTML.includes('data-calc-form-action'), 'блок действия есть');
  assert.ok(HTML.includes('data-calc-form-link'), 'ссылка есть');
  assert.ok(HTML.includes('>Обсудить расчёт<'), 'текст действия');
  assert.ok(HTML.includes('target="_blank"'), 'открывается в новой вкладке');
  assert.ok(HTML.includes('rel="noopener noreferrer"'), 'безопасный rel');
  assert.ok(HTML.includes('data-calc-form-link-error'), 'сообщение об ошибке ссылки');
  assert.ok(
    HTML.includes('Используйте только вымышленные данные.'),
    'предупреждение о вымышленных данных',
  );
  assert.ok(HTML.includes('href="#calculator"'), 'якорь на расчёт сохранён');
  assert.ok(HTML.includes('href="#interiors"'), 'якорь на интерьеры сохранён');
});

test('модуль ссылки не выполняет сетевых действий и не читает DOM', () => {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'yandex-form.mjs'), 'utf8');
  assert.ok(!/fetch|XMLHttpRequest|window\.open|location\.href\s*=/.test(source), 'нет отправок и переходов');
  assert.ok(source.includes('new URL('), 'URL строится через конструктор URL');
  assert.ok(source.includes('searchParams.set('), 'кодирование через URLSearchParams');
  assert.ok(!source.includes('encodeURIComponent('), 'ручного кодирования нет');
  assert.ok(!source.includes('preview=true'), 'preview не используется');
});
