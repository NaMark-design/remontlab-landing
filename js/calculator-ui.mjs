/* Веб-интерфейс калькулятора «РемонтЛаб».
   - Расчётное ядро подключается без изменений: js/calculator-core.mjs.
   - Цены: js/demo-price.mjs («Статический учебный прайс»).
   - Здесь только DOM, адаптация сообщений ядра и сводка для будущей интеграции.

   Сетевые запросы, localStorage и персональные данные не используются. */

import {
  calculateQuote,
  EXTRA_IDS,
  EXTRA_RULES,
  formatHundredths,
} from './calculator-core.mjs';
import {
  priceBook,
  PRICE_SOURCE_ID,
  PRICE_SOURCE_LABEL,
} from './demo-price.mjs';
import { buildFormUrl } from './yandex-form.mjs';

export const SCHEMA_VERSION = '1.0';

/* Сообщения ядра, в которых квартира названа квартирой.
   Ядро не изменяется: адаптация выполняется только в UI-слое. */
const CORE_MESSAGE_OVERRIDES = Object.freeze({
  'Введите площадь квартиры.': 'Введите площадь отделки.',
  'Площадь квартиры должна быть от 1 до 500 м².': 'Площадь отделки должна быть от 1 до 500 м².',
  'Для уборки сначала укажите корректную площадь квартиры.': 'Для уборки сначала укажите корректную площадь отделки.',
  'Площадь демонтажа не может быть больше площади квартиры.': 'Площадь демонтажа не может быть больше площади отделки.',
  'Сначала укажите корректную площадь квартиры.': 'Сначала укажите корректную площадь отделки.',
});

const STATUS_STALE = 'Параметры изменены. Рассчитайте стоимость заново.';

/* Порядок вывода ошибок и порядок перевода фокуса. */
const FOCUS_ORDER = Object.freeze([
  'area',
  'package',
  'OPT_DEM',
  'OPT_SOUND',
  'OPT_SOCKET',
  'OPT_DOOR',
  'OPT_WASTE',
  'OPT_CLEAN',
  'form',
]);

const GROUP_FORMATTER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function adaptCoreMessage(message) {
  if (typeof message !== 'string') {
    return message;
  }
  return CORE_MESSAGE_OVERRIDES[message] ?? message;
}

/* Точное форматирование копеек без плавающей точки: рубли с группировкой
   и всегда две цифры после запятой. */
export function formatRub(kopecks) {
  const value = Math.trunc(Number(kopecks));
  const whole = Math.trunc(value / 100);
  const fraction = Math.abs(value % 100);
  return `${GROUP_FORMATTER.format(whole)},${String(fraction).padStart(2, '0')} ₽`;
}

/* JSON-совместимое представление: BigInt не должен пройти через
   JSON.stringify напрямую — он превратился бы в число и потерял точность. */
export function toSerializable(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = toSerializable(item);
    }
    return output;
  }
  return value;
}

export function serializeSummary(summary) {
  return JSON.stringify(toSerializable(summary));
}

function lineToRecord(line) {
  return {
    id: line.id,
    name: line.name,
    unit: line.unit,
    isPackage: Boolean(line.isPackage),
    quantityText: line.quantityText,
    quantityHundredths: line.quantityHundredths ?? null,
    quantityCount: line.quantityCount ?? null,
    unitPriceKopecks: line.unitPriceKopecks,
    amountKopecks: line.amountKopecks,
  };
}

/* Сводка для будущей интеграции: строится только из валидного ввода
   и успешного результата ядра. Ничего не отправляется и не сохраняется. */
export function buildQuoteSummary(input, result, book = priceBook) {
  if (!result || result.ok !== true || !result.quote) {
    throw new Error('Сводка строится только по успешному результату расчёта.');
  }

  const quote = result.quote;
  const lines = quote.lines.map(lineToRecord);
  const lineById = new Map(lines.map((line) => [line.id, line]));

  const extras = [];
  const sourceExtras = input?.extras ?? {};
  for (const id of EXTRA_IDS) {
    const option = sourceExtras[id];
    if (!option?.checked) {
      continue;
    }

    const entry = book.entries.find((item) => item.id === id) ?? null;
    const line = lineById.get(id) ?? null;

    extras.push({
      id,
      name: line?.name ?? entry?.name ?? '',
      unit: line?.unit ?? entry?.unit ?? '',
      quantityKind: EXTRA_RULES[id]?.kind ?? '',
      quantityText: line?.quantityText ?? '',
      quantityHundredths: line?.quantityHundredths ?? null,
      quantityCount: line?.quantityCount ?? null,
      unitPriceKopecks: line?.unitPriceKopecks ?? entry?.priceKopecks ?? null,
      amountKopecks: line?.amountKopecks ?? null,
    });
  }

  const packageEntry = book.entries.find((item) => item.id === quote.packageId) ?? null;
  const areaInput = typeof input?.area === 'string' ? input.area.trim() : '';
  const totalKopecks = quote.totalKopecks;

  const summary = {
    schemaVersion: SCHEMA_VERSION,
    priceSource: {
      id: PRICE_SOURCE_ID,
      label: PRICE_SOURCE_LABEL,
    },
    area: {
      input: areaInput,
      hundredths: quote.areaHundredths,
      text: `${formatHundredths(quote.areaHundredths)} м²`,
    },
    package: {
      id: quote.packageId,
      name: quote.packageName,
      unit: packageEntry?.unit ?? '',
      priceKopecks: packageEntry?.priceKopecks ?? null,
    },
    extras,
    lines,
    totalKopecks,
    totalText: formatRub(totalKopecks),
    text: '',
  };

  const textLines = [
    'Предварительная стоимость работ',
    `Источник цен: ${PRICE_SOURCE_LABEL}`,
    `Площадь отделки: ${summary.area.text}`,
    `Пакет: ${summary.package.name} (${summary.package.id})`,
    'Работы:',
    ...lines.map((line) => `— ${line.name}: ${line.quantityText} ${line.unit}`
      + ` × ${formatRub(line.unitPriceKopecks)} = ${formatRub(line.amountKopecks)}`),
    `Итого: ${formatRub(totalKopecks)}`,
  ];

  summary.text = textLines.join('\n');
  return summary;
}

/* ---------- DOM ---------- */

function initCalculator() {
  if (typeof document === 'undefined') {
    return;
  }

  const form = document.querySelector('[data-calc-form]');
  if (!form) {
    return;
  }

  const areaInput = document.getElementById('calc-area');
  const radios = Array.from(form.querySelectorAll('input[name="calc-package"]'));
  const toggles = new Map();
  const qtyInputs = new Map();
  const qtyWrappers = new Map();

  for (const id of EXTRA_IDS) {
    const toggle = document.getElementById(`calc-extra-${id}`);
    const qty = document.getElementById(`calc-qty-${id}`);
    const wrapper = form.querySelector(`[data-qty-for="${id}"]`);
    if (toggle) toggles.set(id, toggle);
    if (qty) qtyInputs.set(id, qty);
    if (wrapper) qtyWrappers.set(id, wrapper);
  }

  const statusEl = form.querySelector('[data-calc-status]');
  const resultEl = document.querySelector('[data-calc-result]');
  const totalEl = document.querySelector('[data-calc-total]');
  const linesEl = document.querySelector('[data-calc-lines]');
  const formAction = document.querySelector('[data-calc-form-action]');
  const formLink = document.querySelector('[data-calc-form-link]');
  const formLinkError = document.querySelector('[data-calc-form-link-error]');

  const fields = {
    area: makeField('calc-area-error', [{ el: areaInput, hint: 'calc-area-hint' }], () => areaInput),
    package: makeField('calc-package-error', radios.map((el) => ({ el, hint: 'calc-package-hint' })), () => radios[0]),
    form: makeField('calc-form-error', [], () => document.getElementById('calc-form-error')),
  };

  for (const id of EXTRA_IDS) {
    const targets = [];
    const toggle = toggles.get(id);
    const qty = qtyInputs.get(id);
    const hintId = `calc-qty-hint-${id}`;

    if (qty) {
      targets.push({ el: qty, hint: hintId });
    } else {
      const staticHint = document.getElementById(hintId);
      targets.push({ el: toggle, hint: staticHint ? hintId : null });
    }

    fields[id] = makeField(`calc-error-${id}`, targets, () => qty ?? toggle);
  }

  function makeField(errorId, targets, focusTarget) {
    return {
      errorEl: document.getElementById(errorId),
      targets: targets.filter((target) => Boolean(target.el)),
      focusTarget,
    };
  }

  function addDescribedBy(el, id) {
    const current = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (!current.includes(id)) {
      current.push(id);
      el.setAttribute('aria-describedby', current.join(' '));
    }
  }

  function clearField(key) {
    const field = fields[key];
    if (!field) {
      return;
    }
    if (field.errorEl) {
      field.errorEl.textContent = '';
      field.errorEl.hidden = true;
    }
    for (const target of field.targets) {
      target.el.setAttribute('aria-invalid', 'false');
    }
  }

  function clearAllErrors() {
    for (const key of Object.keys(fields)) {
      clearField(key);
    }
  }

  function showFieldError(key, message) {
    const field = fields[key];
    if (!field) {
      return;
    }
    if (field.errorEl) {
      field.errorEl.textContent = message;
      field.errorEl.hidden = false;
    }
    for (const target of field.targets) {
      target.el.setAttribute('aria-invalid', 'true');
      if (target.hint && field.errorEl) {
        addDescribedBy(target.el, field.errorEl.id);
      }
    }
  }

  function updateOptionStates() {
    for (const id of EXTRA_IDS) {
      const toggle = toggles.get(id);
      const qty = qtyInputs.get(id);
      const wrapper = qtyWrappers.get(id);
      if (!toggle || !wrapper) {
        continue;
      }
      const active = toggle.checked;
      wrapper.hidden = !active;
      if (qty) {
        qty.disabled = !active;
      }
    }
  }

  function hideResult() {
    if (!resultEl) {
      return;
    }
    resultEl.hidden = true;
    if (totalEl) totalEl.textContent = '';
    if (linesEl) linesEl.replaceChildren();
  }

  /* Ссылка на Яндекс Форму доступна только для актуального результата:
     при любом изменении, сбросе или неудачном расчёте действие скрывается,
     href удаляется, прежнее сообщение об ошибке ссылки очищается. */
  function hideFormLink() {
    if (formAction) formAction.hidden = true;
    if (formLink) formLink.removeAttribute('href');
    if (formLinkError) {
      formLinkError.textContent = '';
      formLinkError.hidden = true;
    }
  }

  /* Сообщение об ошибке ссылки показывается только после попытки
     построить ссылку для нового успешного расчёта. */
  function prepareFormLink(summary) {
    const built = buildFormUrl(summary);

    if (built.ok) {
      if (formLink) formLink.setAttribute('href', built.url);
      if (formAction) formAction.hidden = false;
      if (formLinkError) {
        formLinkError.textContent = '';
        formLinkError.hidden = true;
      }
      return;
    }

    if (formAction) formAction.hidden = true;
    if (formLink) formLink.removeAttribute('href');
    if (formLinkError) {
      formLinkError.textContent = built.reason === 'too-long'
        ? 'Не удалось создать ссылку: сводка расчёта слишком длинная для адреса формы.'
        : 'Не удалось создать ссылку: сводка расчёта не подготовлена.';
      formLinkError.hidden = false;
    }
  }

  function renderResult(quote) {
    if (totalEl) totalEl.textContent = formatRub(quote.totalKopecks);
    if (linesEl) {
      const fragment = document.createDocumentFragment();
      for (const line of quote.lines) {
        const row = document.createElement('tr');
        row.appendChild(makeCell('Работа', line.name));
        row.appendChild(makeCell('Количество', line.quantityText));
        row.appendChild(makeCell('Единица', line.unit));
        row.appendChild(makeCell('Цена за единицу', `${formatRub(line.unitPriceKopecks)} / ${line.unit}`));
        row.appendChild(makeCell('Сумма', formatRub(line.amountKopecks)));
        fragment.appendChild(row);
      }
      linesEl.replaceChildren(fragment);
    }
    if (resultEl) resultEl.hidden = false;
  }

  function makeCell(label, value) {
    const cell = document.createElement('td');
    cell.setAttribute('data-label', label);
    cell.textContent = value;
    return cell;
  }

  function collectInput() {
    const selected = form.querySelector('input[name="calc-package"]:checked');
    const extras = {};

    for (const id of EXTRA_IDS) {
      const toggle = toggles.get(id);
      const qty = qtyInputs.get(id);
      const checked = Boolean(toggle && toggle.checked);
      extras[id] = {
        checked,
        quantity: checked && qty ? qty.value : '',
      };
    }

    return {
      area: areaInput ? areaInput.value : '',
      packageId: selected ? selected.value : '',
      extras,
    };
  }

  /* Любое изменение параметров делает прежний результат неактуальным. */
  function invalidateResult() {
    if (!lastResult) {
      return;
    }
    lastResult = null;
    preparedSummary = null;
    hideResult();
    hideFormLink();
    if (statusEl) {
      statusEl.textContent = STATUS_STALE;
    }
  }

  function keyForTarget(el) {
    if (!el) return null;
    if (el === areaInput) return 'area';
    if (el.name === 'calc-package') return 'package';
    if (el.dataset.extraToggle) return el.dataset.extraToggle;
    if (el.dataset.qtyId) return el.dataset.qtyId;
    return null;
  }

  function onFieldActivity(event) {
    const target = event.target;
    if (target && target.dataset.extraToggle) {
      updateOptionStates();
    }
    const key = keyForTarget(target);
    if (key) {
      clearField(key);
    }
    invalidateResult();
  }

  function runCalculation() {
    clearAllErrors();

    const input = collectInput();
    const result = calculateQuote(input, priceBook);

    if (!result.ok) {
      lastResult = null;
      preparedSummary = null;
      hideResult();
      hideFormLink();

      const errors = result.errors ?? {};
      let firstKey = null;

      for (const key of Object.keys(errors)) {
        const message = adaptCoreMessage(errors[key]);
        if (fields[key]) {
          showFieldError(key, message);
        } else {
          showFieldError('form', message);
        }
        if (firstKey === null && FOCUS_ORDER.includes(key)) {
          firstKey = key;
        }
      }

      if (firstKey && fields[firstKey]) {
        const focusTarget = fields[firstKey].focusTarget();
        if (focusTarget && typeof focusTarget.focus === 'function') {
          focusTarget.focus();
        }
      }
      return;
    }

    lastResult = { input, quote: result.quote };
    preparedSummary = buildQuoteSummary(input, result, priceBook);
    hideResult();
    renderResult(result.quote);
    prepareFormLink(preparedSummary);
    if (statusEl) {
      statusEl.textContent = '';
    }
  }

  function resetForm() {
    form.reset();
    if (areaInput) areaInput.value = '';
    clearAllErrors();
    updateOptionStates();
    hideResult();
    hideFormLink();
    lastResult = null;
    preparedSummary = null;
    if (statusEl) {
      statusEl.textContent = '';
    }
    if (areaInput) areaInput.focus();
  }

  let lastResult = null;
  let preparedSummary = null;

  form.addEventListener('input', onFieldActivity);
  form.addEventListener('change', onFieldActivity);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runCalculation();
  });

  const resetButton = form.querySelector('[data-calc-reset]');
  if (resetButton) {
    resetButton.addEventListener('click', resetForm);
  }

  updateOptionStates();
  hideResult();

  /* Доступно для ручной проверки в консоли браузера. */
  window.__remontlabCalculator = {
    buildQuoteSummary: () => (preparedSummary ? toSerializable(preparedSummary) : null),
    getResult: () => (lastResult ? toSerializable(lastResult.quote) : null),
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalculator, { once: true });
  } else {
    initCalculator();
  }
}
