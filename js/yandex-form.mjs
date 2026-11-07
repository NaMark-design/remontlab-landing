/* Ссылка на публичную Яндекс Форму с предзаполнением поля
   «Параметры расчёта» сводкой последнего успешного расчёта.

   - Единственное место с адресом формы и именем URL-параметра.
   - Только представление существующей сводки: пересчёта нет,
     цены, формулы и округление не затрагиваются.
   - Сетевые запросы, редиректы и отправка ответа здесь нет. */

export const FORM_URL = 'https://forms.yandex.ru/u/6aef09c9974ab251f3bde026';

/* Имя URL-параметра предоставлено пользователем. Считается рабочим,
   пока реальное предзаполнение не подтверждено открытием ссылки;
   при неудачной внешней проверке самостоятельно не заменяется. */
export const FORM_SUMMARY_PARAM = 'answer_long_text_9008993305765748';

/* Ограничение адреса формы официальной документацией Яндекса:
   не более 32000 символов, остальное отбрасывается. */
export const MAX_URL_LENGTH = 32000;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/* Текст для видимого поля формы строится только из полей существующей
   сводки (buildQuoteSummary). Любая некорректная сводка отклоняется. */
export function buildFormSummaryText(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const area = summary.area;
  const pkg = summary.package;
  const extras = summary.extras;
  const lines = summary.lines;

  if (!isNonEmptyString(area?.text)) return null;
  if (!isNonEmptyString(pkg?.name)) return null;
  if (!Array.isArray(extras) || !Array.isArray(lines) || lines.length === 0) return null;
  if (!Number.isFinite(summary.totalKopecks)) return null;
  if (!isNonEmptyString(summary.totalText)) return null;

  const extraLines = [];
  for (const extra of extras) {
    if (!extra || typeof extra !== 'object') return null;
    if (!isNonEmptyString(extra.name)) return null;
    if (!isNonEmptyString(extra.quantityText)) return null;
    if (!isNonEmptyString(extra.unit)) return null;
    // «шт.» уже заканчивается точкой — вторая не добавляется.
    const unit = extra.unit.trim();
    const suffix = unit.endsWith('.') ? '' : '.';
    extraLines.push(`— ${extra.name.trim()}: ${extra.quantityText.trim()} ${unit}${suffix}`);
  }

  const textLines = [
    `Площадь отделки: ${area.text.trim()}.`,
    `Пакет: ${pkg.name.trim()}.`,
    extraLines.length > 0 ? 'Дополнительно:' : 'Дополнительно: не выбрано.',
    ...extraLines,
    `Предварительная стоимость работ: ${summary.totalText.trim()}.`,
    'Учебный расчёт, без материалов.',
  ];

  return textLines.join('\n');
}

/* Строит ссылку: new URL + searchParams.set. Кодирование выполняется
   только URLSearchParams — без ручного encodeURIComponent. */
export function buildFormUrl(summary) {
  const text = buildFormSummaryText(summary);
  if (text === null) {
    return { ok: false, reason: 'invalid-summary', text: null, url: null, length: 0 };
  }

  const url = new URL(FORM_URL);
  url.searchParams.set(FORM_SUMMARY_PARAM, text);
  const href = url.toString();

  if (href.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'too-long', text, url: null, length: href.length };
  }

  return { ok: true, reason: null, text, url: href, length: href.length };
}
