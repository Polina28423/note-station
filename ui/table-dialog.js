import { tableStrings as strings } from './strings.js';

export function validTableSize(rows, columns) {
  return [rows, columns].every(n => Number.isInteger(n) && n >= 1 && n <= 50) && rows * columns <= 1000;
}

export function showTableDialog(context, execute, trigger) {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog editor-table-dialog';
  dialog.setAttribute('aria-labelledby', 'editor-table-title');
  const form = document.createElement('form');
  form.noValidate = true;
  const title = document.createElement('h2');
  title.id = 'editor-table-title';
  title.textContent = context ? strings.title : strings.insert;
  const body = document.createElement('div');
  body.className = 'dialog-body';
  const status = document.createElement('p');
  status.className = 'editor-table-error';
  status.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const button = (text, type = 'button') => {
    const control = document.createElement('button');
    control.type = type;
    control.textContent = text;
    return control;
  };
  const close = button(strings.close);
  close.addEventListener('click', () => dialog.close());
  actions.append(close);
  let busy = false;
  let restoreFocus;
  async function run(command, size) {
    if (busy) return;
    busy = true;
    const enabled = [...form.querySelectorAll('button,input')].filter(control => !control.disabled);
    for (const control of enabled) control.disabled = true;
    try {
      restoreFocus = await execute(command, size);
      dialog.close('applied');
    } catch (error) {
      status.textContent = error.message || String(error);
    } finally {
      busy = false;
      for (const control of enabled) control.disabled = false;
    }
  }
  if (context) {
    for (const group of [['rowBefore','rowAfter','rowDelete'], ['columnBefore','columnAfter','columnDelete']]) {
      const row = document.createElement('div');
      row.className = 'editor-table-commands';
      for (const command of group) {
        const control = button(strings[command]);
        control.disabled = (command === 'rowDelete' && context.rows <= 1) || (command === 'columnDelete' && context.columns <= 1);
        control.addEventListener('click', () => void run(command));
        row.append(control);
      }
      body.append(row);
    }
    const remove = button(strings.remove);
    remove.addEventListener('click', () => void run('remove'));
    actions.prepend(remove);
  } else {
    const dimensions = document.createElement('div');
    dimensions.className = 'editor-table-dimensions';
    const dimension = text => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      label.textContent = text;
      input.type = 'number';
      input.min = '1';
      input.max = '50';
      input.value = '2';
      label.append(input);
      dimensions.append(label);
      return input;
    };
    const rows = dimension(strings.rows);
    const columns = dimension(strings.columns);
    const label = document.createElement('label');
    label.className = 'editor-table-headers';
    const headers = document.createElement('input');
    headers.type = 'checkbox';
    label.append(headers, strings.headers);
    body.append(dimensions, label);
    actions.append(button(strings.insert, 'submit'));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const size = { rows: rows.valueAsNumber, columns: columns.valueAsNumber, withHeadings: headers.checked };
      if (!validTableSize(size.rows, size.columns)) {
        status.textContent = strings.limit;
        return;
      }
      void run('insert', size);
    });
  }
  body.append(status);
  form.append(title, body, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (restoreFocus) restoreFocus();
    else trigger.focus();
  }, { once: true });
  dialog.showModal();
  return dialog;
}
