/* Статический учебный прайс для веб-калькулятора «РемонтЛаб».
   Источник обозначается как «Статический учебный прайс».
   Это не актуальный онлайн-прайс: значения зафиксированы в коде страницы,
   время открытия страницы датой обновления цен не является.

   Деньги хранятся целыми копейками (priceKopecks), как того требует
   расчётное ядро src/calculator.mjs. Исходные описания прайса сохранены
   дословно; адаптация текста для посетителя выполняется в UI-слое. */

export const PRICE_SOURCE_ID = 'static-demo-price';

export const PRICE_SOURCE_LABEL = 'Статический учебный прайс';

export const priceBook = Object.freeze({
  sourceId: PRICE_SOURCE_ID,
  source: PRICE_SOURCE_LABEL,
  entries: Object.freeze([
    Object.freeze({
      id: 'PKG_COS',
      type: 'package',
      name: 'Косметический ремонт',
      unit: 'м²',
      description: 'Обновление отделки без перепланировки и замены инженерных сетей',
      priceKopecks: 350_000,
    }),
    Object.freeze({
      id: 'PKG_STD',
      type: 'package',
      name: 'Стандартный ремонт',
      unit: 'м²',
      description: 'Подготовка поверхностей и базовая отделка; без перепланировки',
      priceKopecks: 650_000,
    }),
    Object.freeze({
      id: 'PKG_CAP',
      type: 'package',
      name: 'Капитальный ремонт',
      unit: 'м²',
      description: 'Расширенная подготовка и отделка; без перепланировки',
      priceKopecks: 950_000,
    }),
    Object.freeze({
      id: 'OPT_DEM',
      type: 'extra',
      name: 'Демонтаж старого напольного покрытия',
      unit: 'м²',
      description: 'Площадь демонтажа вводится отдельно; не включён в пакеты',
      priceKopecks: 35_000,
    }),
    Object.freeze({
      id: 'OPT_SOUND',
      type: 'extra',
      name: 'Дополнительная шумоизоляция стен',
      unit: 'м²',
      description: 'Площадь обрабатываемых стен вводится отдельно; не включена в пакеты',
      priceKopecks: 120_000,
    }),
    Object.freeze({
      id: 'OPT_SOCKET',
      type: 'extra',
      name: 'Дополнительная электрическая точка',
      unit: 'шт.',
      description: 'Точки сверх базового состава пакета; материалы отдельно',
      priceKopecks: 90_000,
    }),
    Object.freeze({
      id: 'OPT_DOOR',
      type: 'extra',
      name: 'Установка межкомнатной двери',
      unit: 'шт.',
      description: 'За одну дверь; дверной блок приобретается отдельно',
      priceKopecks: 450_000,
    }),
    Object.freeze({
      id: 'OPT_WASTE',
      type: 'extra',
      name: 'Вывоз строительного мусора',
      unit: 'заказ',
      description: 'Фиксированная доплата один раз за заказ',
      priceKopecks: 800_000,
    }),
    Object.freeze({
      id: 'OPT_CLEAN',
      type: 'extra',
      name: 'Послеремонтная уборка',
      unit: 'м²',
      description: 'Рассчитывается по площади квартиры; не включена в пакеты',
      priceKopecks: 18_000,
    }),
  ]),
  counts: Object.freeze({ total: 9, packages: 3, extras: 6 }),
});

export function findPriceEntry(id) {
  return priceBook.entries.find((entry) => entry.id === id) ?? null;
}
