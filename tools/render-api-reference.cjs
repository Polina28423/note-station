'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/api/catalog.json'), 'utf8'));
const purposes = {
  'SYNO.NoteStation.Info':'Информация о Note Station и поиск местоположений.',
  'SYNO.NoteStation.Setting':'Инициализация и пользовательские настройки.',
  'SYNO.NoteStation.Setting.Global':'Общие настройки, включая режим общего доступа.',
  'SYNO.NoteStation.Notebook':'Получение, создание, изменение и удаление блокнотов.',
  'SYNO.NoteStation.Notebook.Preset':'Выбор блокнота по умолчанию.',
  'SYNO.NoteStation.Notebook.Polling':'Фоновое архивирование блокнота и наблюдение за задачей.',
  'SYNO.NoteStation.Stack':'Полки блокнотов: переименование и удаление.',
  'SYNO.NoteStation.Note':'Заметки, корзина, копирование, вложения и получение текста вложения.',
  'SYNO.NoteStation.Note.Polling':'Фоновое изменение/копирование заметок и наблюдение за задачей.',
  'SYNO.NoteStation.Note.Version':'История версий заметки и восстановление версии.',
  'SYNO.NoteStation.Note.AppLink':'Получение ссылки на вложение для другого приложения.',
  'SYNO.NoteStation.Note.Encrypt':'Получение и проверка краткоживущего токена защищённой заметки.',
  'SYNO.NoteStation.Tag':'Теги: список, установка/переименование, удаление.',
  'SYNO.NoteStation.Shortcut':'Серверные ярлыки заметок, блокнотов, тегов и полок.',
  'SYNO.NoteStation.Smart':'Умные блокноты: сохранённые запросы.',
  'SYNO.NoteStation.Todo':'Задачи, подзадачи, сроки и напоминания.',
  'SYNO.NoteStation.FTS':'Поиск по содержимому и дополнительным условиям.',
  'SYNO.NoteStation.Permission':'Включение прав доступа к объекту.',
  'SYNO.NoteStation.Permission.Public':'Публичное разрешение; метод передаётся через op.',
  'SYNO.NoteStation.Permission.User':'Права отдельного пользователя; метод передаётся через op.',
  'SYNO.NoteStation.Permission.Group':'Права группы; метод передаётся через op.',
  'SYNO.NoteStation.Share.Priv':'Получение списка прав общего доступа.',
  'SYNO.NoteStation.Shard.Link':'Ссылка общего доступа. В оригинале именно Shard, без исправления на Share.',
  'SYNO.NoteStation.Export.Note':'Экспорт заметки: запуск, статус, скачивание результата.',
  'SYNO.NoteStation.Export.Notebook':'Запуск экспорта блокнота.',
  'SYNO.NoteStation.Import.Notebook':'Импорт файла/блокнота и статус импорта.',
  'SYNO.NoteStation.Import.Evernote':'OAuth и импорт Evernote; актуальная работоспособность не проверена.',
  'SYNO.API.Auth':'DSM-авторизация. Дополнительный login восстанавливается из вызовов auth().',
  'SYNO.API.Info':'Серверный каталог имён, путей и поддерживаемых версий API.',
  'SYNO.API.Encryption':'Вспомогательная защита полей в SDK оригинала; не заменяет TLS.',
  'SYNO.Entry.Request':'Пакет из нескольких вызовов; отдельный результат для каждого элемента.',
  'SYNO.Entry.Request.Polling':'Ссылка из общего SDK на механизм polling; прямой вызов не извлечён.',
  'SYNO.Core.File':'DSM-выбор каталога, список файлов, создание каталога.',
  'SYNO.Core.System':'Информация DSM, которую запрашивает общий SDK.',
  'SYNO.Core.UserSettings':'Общие настройки пользователя DSM.',
  'SYNO.Core.AppNotify':'Уведомление DSM об открытии приложения.',
  'SYNO.Core.DataCollect.Application':'Регистрация открытия приложения в общем SDK DSM.',
  'SYNO.Core.UISearch':'Поиск в интерфейсе DSM.',
  'SYNO.API.CompoundReader':'Имя класса SDK, а не подтверждённый серверный API.',
  'SYNO.API.QueryAPI':'Имя класса SDK, а не подтверждённый серверный API.'
};
const escape = text => String(text).replaceAll('|','\\|').replaceAll('\n',' ');
function location(source) {
  return `\`${source.file}:${source.line}:${source.column}\` — \`${escape(source.context)}\``;
}
function methods(namespace) {
  const result = new Map();
  for (const call of namespace.calls) {
    for (const method of call.methods.length ? call.methods : ['<dynamic>']) {
      const version = call.versions.length ? [...call.versions].sort((a,b)=>a-b).join('/') : '?';
      const layout = ['offline_action_declaration','ui_configuration'].includes(call.parameter_layout) ? call.parameter_layout : 'request';
      const key = JSON.stringify([method,version,layout]);
      if (!result.has(key)) result.set(key,{method,version,layout,keys:new Set(),unresolved:false,sources:[]});
      const entry = result.get(key);
      for (const key of Object.keys(call.parameters.fields)) entry.keys.add(key);
      entry.unresolved ||= call.parameters.unresolved;
      entry.sources.push(call.source);
    }
  }
  return [...result.values()].sort((a,b) => a.method.localeCompare(b.method,'en') || a.version.localeCompare(b.version,'en') || a.layout.localeCompare(b.layout,'en'));
}
const lines = [
  '# Справочник наблюдаемых API', '',
  `Источник: Note Station Client **${catalog.client.version}**. Генерируется из [catalog.json](catalog.json) командой \`node tools/render-api-reference.cjs\`.`, '',
  '**Версии ниже — встреченные в коде значения, а не диапазон поддержки вашего NAS.** `?` означает вычисляемую версию. Обязательность полей не восстановлена: перечисление ключей не означает, что нужно передать их все. `Ext.copyTo` копирует только имеющиеся у вызывающего кода поля.', '',
  '«Не полностью» означает динамическое построение параметров. «Offline-класс» и «UI-конфигурация» — объявления клиентского кода, по которым нельзя считать сетевой запрос полностью восстановленным. Пустые поля не доказывают отсутствие параметров на сервере.', '',
  'Ссылки на исходники представлены историческими путями относительно `original/package.nw`; строка/столбец начинаются с 1. Контрольные суммы файлов и UTF-16 offsets сохранены в JSON и остаются полезны после удаления оригинала.', '',
  '## Note Station', ''
];
for (const section of ['note','support']) {
  if (section === 'support') lines.push('## Вспомогательные API DSM и имена SDK','', 'Это зависимости общего клиентского SDK. Для минимального Note Station-клиента реализовывать их все не требуется.','');
  for (const namespace of catalog.namespaces.filter(n => n.api.startsWith('SYNO.NoteStation.') === (section === 'note'))) {
    lines.push(`### ${namespace.api}`,'', purposes[namespace.api] || 'Назначение требует уточнения.','');
    const entries = methods(namespace);
    if (!entries.length) {
      lines.push('Найдена только строковая ссылка; прямые методы и параметры не извлечены.', '', `Источник: ${location(namespace.evidence[0])}.`, '');
      continue;
    }
    lines.push('| Метод | Версия | Наблюдаемые параметры | Качество извлечения |','|---|---|---|---|');
    for (const entry of entries) {
      const quality = entry.layout === 'offline_action_declaration' ? 'Offline-класс; параметры наследуются' : entry.layout === 'ui_configuration' ? 'UI-конфигурация; параметры задаются позднее' : entry.unresolved ? 'Не полностью' : 'Видимые ключи';
      lines.push(`| ${entry.method === '<dynamic>' ? 'Передаётся динамически' : '\`'+escape(entry.method)+'\`'} | ${entry.version} | ${[...entry.keys].sort().map(k=>'\`'+escape(k)+'\`').join(', ') || '—'} | ${quality} |`);
    }
    if (/\.Permission\.(Public|User|Group)$/.test(namespace.api)) lines.push('', 'Вручную прослежены значения `op: "set"` и `op: "delete"` в UI общего доступа (`enableChanged`, `getRestorePublicAcl`, `calculateAcl`). AST-каталог сохраняет исходный динамический вызов; это наблюдение по вызывающему коду, а не гарантия серверной схемы.');
    lines.push('', 'Места вызовов:', '');
    for (const entry of entries) lines.push(`- ${entry.method === '<dynamic>' ? 'Динамический метод' : '\`'+escape(entry.method)+'\`'} v${entry.version}: ${[...new Map(entry.sources.map(s=>[s.file+'|'+s.context,s])).values()].slice(0,3).map(location).join('; ')}.`);
    lines.push('');
  }
}
lines.push('## Динамические вызовы без статического имени API','', `Сохранено **${catalog.unresolved_api_declarations.length}** записей: см. \`unresolved_api_declarations\` в JSON. Они относятся к общему транспорту, построению URL и offline-синхронизации; статический анализ не подставляет вместо них выдуманные серверные методы.`, '', '## Наблюдаемые пути','', 'Это строковые литералы из приложения, а не перечень HTTP API. Среди них есть ресурсы CSS/изображений и вспомогательные CGI. Путь конкретного API нужно получать через `SYNO.API.Info`.','');
for (const entry of catalog.endpoint_literals) lines.push(`- \`${escape(entry.text)}\` — ${location(entry.evidence[0])}.`);
lines.push('', '## Коды ошибок из UI оригинала', '', 'Это соответствие кода ключу локализации из `SYNO.SDS.NoteStation.ErrorString`, а не нормативная таблица ошибок всех серверных методов. Смысл не расширяется догадками. Точное место каждого элемента сохранено в `client_error_mappings` JSON.', '', '| Коды | Ключ сообщения в клиенте |', '|---|---|');
const errors = new Map();
for (const mapping of catalog.client_error_mappings) {
  const key = mapping.localization_keys ? mapping.localization_keys.join('.') : mapping.literal === '' ? '(пустое сообщение)' : String(mapping.literal);
  const codes = errors.get(key) || []; codes.push(mapping.code); errors.set(key,codes);
}
for (const [key,codes] of errors) lines.push(`| ${codes.join(', ')} | \`${escape(key)}\` |`);
lines.push('');
fs.writeFileSync(path.join(root,'docs/api/REFERENCE.md'),lines.join('\n'));
console.log(`Rendered ${catalog.namespaces.length} namespaces.`);
