export const PACKAGE_IDS = Object.freeze(['PKG_COS', 'PKG_STD', 'PKG_CAP']);

export const EXTRA_IDS = Object.freeze([
  'OPT_DEM',
  'OPT_SOUND',
  'OPT_SOCKET',
  'OPT_DOOR',
  'OPT_WASTE',
  'OPT_CLEAN',
]);

export const EXTRA_RULES = Object.freeze({
  OPT_DEM: Object.freeze({ kind: 'area', minHundredths: 1, maxHundredths: 50000, relativeToApartment: true }),
  OPT_SOUND: Object.freeze({ kind: 'area', minHundredths: 1, maxHundredths: 200000, relativeToApartment: false }),
  OPT_SOCKET: Object.freeze({ kind: 'integer', min: 1, max: 200 }),
  OPT_DOOR: Object.freeze({ kind: 'integer', min: 1, max: 50 }),
  OPT_WASTE: Object.freeze({ kind: 'fixed' }),
  OPT_CLEAN: Object.freeze({ kind: 'apartment-area' }),
});

const MAX_SAFE_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);

function parseDecimalHundredths(raw) {
  if (raw === null || raw === undefined) {
    return { state: 'empty' };
  }

  const value = String(raw).trim();
  if (value === '') {
    return { state: 'empty' };
  }

  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) {
    return { state: 'format' };
  }

  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return { state: 'ok', hundredths };
}

function parseInteger(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { state: 'empty' };
  }

  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    return { state: 'format' };
  }

  return { state: 'ok', value: Number(value) };
}

function roundHalfUp(numerator, denominator) {
  return (2n * numerator + denominator) / (2n * denominator);
}

function safeNumber(value, errors) {
  if (value > MAX_SAFE_AMOUNT) {
    errors.form = 'Итоговая сумма слишком велика для расчёта. Проверьте цены в прайсе.';
    return null;
  }
  return Number(value);
}

function findEntry(priceBook, id) {
  return priceBook?.entries?.find((entry) => entry.id === id) ?? null;
}

export function formatHundredths(hundredths) {
  const whole = Math.trunc(hundredths / 100);
  const fraction = hundredths % 100;

  if (fraction === 0) {
    return String(whole);
  }
  if (fraction % 10 === 0) {
    return `${whole},${fraction / 10}`;
  }
  return `${whole},${String(fraction).padStart(2, '0')}`;
}

export function calculateQuote(input, priceBook) {
  const errors = {};
  const areaValue = parseDecimalHundredths(input?.area);

  if (areaValue.state === 'empty') {
    errors.area = 'Введите площадь квартиры.';
  } else if (areaValue.state === 'format') {
    errors.area = 'Укажите площадь числом, например 42,5. Допустимо не более двух знаков после запятой.';
  } else if (areaValue.hundredths < 100 || areaValue.hundredths > 50000) {
    errors.area = 'Площадь квартиры должна быть от 1 до 500 м².';
  }

  const areaHundredths = areaValue.state === 'ok' ? areaValue.hundredths : null;

  const packageId = typeof input?.packageId === 'string' ? input.packageId : '';
  const packageEntry = PACKAGE_IDS.includes(packageId) ? findEntry(priceBook, packageId) : null;

  if (!packageId) {
    errors.package = 'Выберите один пакет ремонта.';
  } else if (!packageEntry) {
    errors.package = 'Выбранный пакет отсутствует в загруженном прайсе.';
  }

  const extraResults = [];
  const extras = input?.extras ?? {};

  for (const id of EXTRA_IDS) {
    const option = extras[id];
    if (!option?.checked) {
      continue;
    }

    const entry = findEntry(priceBook, id);
    if (!entry) {
      errors[id] = 'Эта услуга отсутствует в загруженном прайсе.';
      continue;
    }

    const rule = EXTRA_RULES[id];

    if (rule.kind === 'fixed') {
      extraResults.push({ id, entry, quantityHundredths: null, quantityCount: 1 });
      continue;
    }

    if (rule.kind === 'apartment-area') {
      if (areaHundredths === null) {
        errors[id] = 'Для уборки сначала укажите корректную площадь квартиры.';
      } else {
        extraResults.push({ id, entry, quantityHundredths: areaHundredths, quantityCount: null });
      }
      continue;
    }

    if (rule.kind === 'integer') {
      const parsed = parseInteger(option.quantity);
      if (parsed.state === 'empty') {
        errors[id] = 'Укажите количество.';
      } else if (parsed.state === 'format') {
        errors[id] = 'Количество должно быть целым числом.';
      } else if (parsed.value < rule.min || parsed.value > rule.max) {
        errors[id] = `Количество должно быть от ${rule.min} до ${rule.max}.`;
      } else {
        extraResults.push({ id, entry, quantityHundredths: null, quantityCount: parsed.value });
      }
      continue;
    }

    if (rule.kind === 'area') {
      const parsed = parseDecimalHundredths(option.quantity);
      if (parsed.state === 'empty') {
        errors[id] = 'Укажите площадь.';
      } else if (parsed.state === 'format') {
        errors[id] = 'Укажите площадь числом, например 18,5. Допустимо не более двух знаков после запятой.';
      } else if (parsed.hundredths < rule.minHundredths) {
        errors[id] = 'Площадь должна быть больше нуля.';
      } else if (parsed.hundredths > rule.maxHundredths) {
        errors[id] = `Площадь должна быть не больше ${rule.maxHundredths / 100} м².`;
      } else if (rule.relativeToApartment && areaHundredths !== null && parsed.hundredths > areaHundredths) {
        errors[id] = 'Площадь демонтажа не может быть больше площади квартиры.';
      } else if (rule.relativeToApartment && areaHundredths === null) {
        errors[id] = 'Сначала укажите корректную площадь квартиры.';
      } else {
        extraResults.push({ id, entry, quantityHundredths: parsed.hundredths, quantityCount: null });
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const lines = [];
  let total = 0n;

  const packageAmount = roundHalfUp(
    BigInt(areaHundredths) * BigInt(packageEntry.priceKopecks),
    100n,
  );
  const packageAmountNumber = safeNumber(packageAmount, errors);
  if (errors.form) {
    return { ok: false, errors };
  }
  total += packageAmount;
  lines.push({
    id: packageEntry.id,
    name: packageEntry.name,
    unit: packageEntry.unit,
    isPackage: true,
    quantityHundredths: areaHundredths,
    quantityCount: null,
    quantityText: formatHundredths(areaHundredths),
    unitPriceKopecks: packageEntry.priceKopecks,
    amountKopecks: packageAmountNumber,
  });

  for (const extra of extraResults) {
    const quantity = extra.quantityHundredths ?? extra.quantityCount;
    let amount;

    if (extra.quantityHundredths !== null) {
      amount = roundHalfUp(
        BigInt(extra.quantityHundredths) * BigInt(extra.entry.priceKopecks),
        100n,
      );
    } else {
      amount = BigInt(quantity) * BigInt(extra.entry.priceKopecks);
    }

    const amountNumber = safeNumber(amount, errors);
    if (errors.form) {
      return { ok: false, errors };
    }

    total += amount;
    lines.push({
      id: extra.id,
      name: extra.entry.name,
      unit: extra.entry.unit,
      isPackage: false,
      quantityHundredths: extra.quantityHundredths,
      quantityCount: extra.quantityCount,
      quantityText: extra.quantityHundredths !== null
        ? formatHundredths(extra.quantityHundredths)
        : String(extra.quantityCount),
      unitPriceKopecks: extra.entry.priceKopecks,
      amountKopecks: amountNumber,
    });
  }

  const totalKopecks = safeNumber(total, errors);
  if (errors.form) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    quote: {
      areaHundredths,
      packageId: packageEntry.id,
      packageName: packageEntry.name,
      lines,
      totalKopecks,
    },
  };
}
