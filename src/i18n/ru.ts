/**
 * Russian is the source dictionary: its shape is the contract every other
 * locale must satisfy (see en.ts), so a missing string is a build error rather
 * than a blank label on stage.
 */
export const ru = {
  common: {
    appName: 'EQ Scope',
    start: 'Старт',
    stop: 'Стоп',
    close: 'Закрыть',
    cancel: 'Отмена',
    save: 'Сохранить',
    delete: 'Удалить',
    reset: 'Сбросить',
    freeze: 'Стоп-кадр',
    unfreeze: 'Продолжить',
    on: 'вкл',
    off: 'выкл',
    yes: 'да',
    no: 'нет',
    unknown: 'неизвестно',
    seconds: (n: number) => `${n} с`,
    db: 'дБ',
    hz: 'Гц',
    loading: 'Загрузка…',
    none: 'нет',
    back: 'Назад',
    next: 'Далее',
    done: 'Готово',
  },
  nav: {
    rta: 'Спектр',
    spectrogram: 'Водопад',
    resonances: 'Резонансы',
    snapshots: 'Снимки',
    generator: 'Генератор',
    settings: 'Настройки',
    diagnostics: 'Диагностика',
  },
  errors: {
    micDenied: 'Доступ к микрофону запрещён. Разрешите его в настройках браузера и перезагрузите страницу.',
    micFailed: (message: string) => `Не удалось открыть микрофон: ${message}`,
    notSupported: 'Браузер не поддерживает AudioWorklet или getUserMedia. Нужен современный Safari / Chrome по HTTPS.',
    insecure: 'Микрофон доступен только по HTTPS (или на localhost).',
  },
  diagnostics: {
    title: 'Диагностика микрофона',
    intro:
      'Эта страница проверяет, что телефон отдаёт сырой сигнал. Обработка ОС (эхоподавление, шумодав, автоусиление) ломает измерение, поэтому сначала убеждаемся, что она выключена.',
    startCapture: 'Начать захват',
    stopCapture: 'Остановить',
    device: 'Вход',
    refreshDevices: 'Обновить список входов',
    sampleRate: 'Частота дискретизации',
    channels: 'Каналов',
    label: 'Устройство',
    latency: 'Базовая задержка',
    processing: 'Обработка сигнала',
    echoCancellation: 'Эхоподавление',
    noiseSuppression: 'Шумоподавление',
    autoGainControl: 'Автоусиление (AGC)',
    requested: 'Запрошено',
    applied: 'Фактически',
    processingOk: 'Обработка отключена — сигнал пригоден для измерений.',
    processingBad: 'Обработка НЕ отключена. Измерение будет врать: уровни «плавают», спектр искажён.',
    processingUnknown:
      'Браузер не сообщает состояние обработки. Проверьте по срезу верха и по стабильности уровня.',
    rawSettings: 'Полный ответ track.getSettings()',
    level: 'Уровень',
    peak: 'Пик',
    clipping: 'КЛИППИНГ',
    spectrum: 'Спектр (мгновенный)',
    hfCheck: 'Проверка среза верха',
    hfHint:
      'Подайте в помещение розовый шум или музыку с выраженным верхом и нажмите «Проверить». На части iPhone системные режимы микрофона режут всё выше ~8 кГц.',
    hfRun: 'Проверить (5 с)',
    hfRunning: (left: number) => `Идёт замер… ${left} с`,
    hfNeedSignal: 'Слишком тихо: нужен широкополосный сигнал громче фона.',
    hfEdge: (hz: number) => `Верхняя граница сигнала: ~${Math.round(hz)} Гц`,
    hfCliff: (hz: number, drop: number) =>
      `Обнаружен резкий срез около ${Math.round(hz)} Гц (падение ${drop.toFixed(0)} дБ). Похоже на системную обработку микрофона.`,
    hfClean: 'Резкого среза не обнаружено — верх проходит.',
    record: 'Запись WAV',
    recordHint: 'Запишите 10 секунд и послушайте/посмотрите файл в редакторе, чтобы убедиться в качестве сигнала.',
    recordStart: 'Записать 10 с',
    recording: (left: number) => `Запись… ${left} с`,
    recordReady: 'Файл готов',
    download: 'Скачать WAV',
    report: 'Отчёт',
    copyReport: 'Скопировать отчёт',
    copied: 'Скопировано',
    secureContext: 'Защищённый контекст (HTTPS)',
    userAgent: 'Браузер',
    verdictTitle: 'Итог',
    verdictGood: 'Веб-захват пригоден: обработка выключена, срез верха не обнаружен.',
    verdictWarn: 'Веб-захват работает с оговорками — см. предупреждения выше.',
    verdictBad: 'Веб-захват непригоден для измерений на этом устройстве. Нужна нативная обёртка (план Б).',
  },
};

/**
 * No `as const`: literal types would make every English string a type error.
 * The inferred shape (string / function signatures) is exactly the contract we
 * want other locales to satisfy.
 */
export type Dict = typeof ru;
