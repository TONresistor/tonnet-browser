const root = document.getElementById('root')
let selectedIndex = -1
let currentItems = []

function renderSuggestions(items) {
  currentItems = items
  selectedIndex = -1
  root.innerHTML = ''

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const el = document.createElement('div')
    el.className = 'suggestion-item'
    el.dataset.index = i

    const row = document.createElement('div')
    row.className = 'suggestion-row'

    const title = document.createElement('span')
    title.className = 'suggestion-title'
    title.textContent = item.title || item.url

    const visits = document.createElement('span')
    visits.className = 'suggestion-visits'
    visits.textContent = item.visitCount > 1 ? `${item.visitCount}x` : ''

    row.appendChild(title)
    row.appendChild(visits)

    const url = document.createElement('div')
    url.className = 'suggestion-url'
    url.textContent = item.url

    el.appendChild(row)
    el.appendChild(url)

    el.addEventListener('click', () => {
      window.overlayBridge.sendAction('select', { id: item.id, url: item.url, index: i })
    })

    root.appendChild(el)
  }
}

function renderMenu(items) {
  currentItems = items
  selectedIndex = -1
  root.innerHTML = ''

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (item.separator) {
      const sep = document.createElement('div')
      sep.className = 'menu-separator'
      root.appendChild(sep)
      continue
    }

    const el = document.createElement('div')
    el.className = 'menu-item' + (item.disabled ? ' disabled' : '') + (item.destructive ? ' destructive' : '')
    el.dataset.index = i

    if (item.icon) {
      const icon = document.createElement('span')
      icon.className = 'menu-icon'
      icon.textContent = item.icon
      el.appendChild(icon)
    }

    const label = document.createElement('span')
    label.textContent = item.label
    el.appendChild(label)

    el.addEventListener('click', () => {
      if (!item.disabled) {
        window.overlayBridge.sendAction(item.id, item.data || {})
      }
    })

    root.appendChild(el)
  }
}

function renderFind(content) {
  currentItems = []
  selectedIndex = -1
  root.className = 'find-mode'

  let container = root.querySelector('.find-container')
  let input = container?.querySelector('.find-input')
  let count = container?.querySelector('.find-count')
  let previous = container?.querySelector('[data-action="previous"]')
  let next = container?.querySelector('[data-action="next"]')

  if (!container || !input || !count || !previous || !next) {
    root.innerHTML = ''
    container = document.createElement('div')
    container.className = 'find-container'

    input = document.createElement('input')
    input.className = 'find-input'
    input.type = 'text'
    input.placeholder = 'Find in page'
    input.setAttribute('aria-label', 'Find in page')
    input.addEventListener('input', () => window.overlayBridge.sendAction('query', { query: input.value }))
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        window.overlayBridge.sendAction(event.shiftKey ? 'previous' : 'next', {})
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        window.overlayBridge.sendAction('close', {})
      }
    })

    count = document.createElement('span')
    count.className = 'find-count'

    const makeButton = (action, label, text) => {
      const button = document.createElement('button')
      button.className = 'find-button'
      button.type = 'button'
      button.dataset.action = action
      button.title = label
      button.setAttribute('aria-label', label)
      button.textContent = text
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => window.overlayBridge.sendAction(action, {}))
      return button
    }

    previous = makeButton('previous', 'Previous match', '↑')
    next = makeButton('next', 'Next match', '↓')
    const close = makeButton('close', 'Close', '×')

    container.appendChild(input)
    container.appendChild(count)
    container.appendChild(previous)
    container.appendChild(next)
    container.appendChild(close)
    root.appendChild(container)
  }

  const query = typeof content.query === 'string' ? content.query : ''
  if (document.activeElement !== input && input.value !== query) input.value = query
  const matches = Number.isInteger(content.matches) ? content.matches : 0
  const activeMatch = Number.isInteger(content.activeMatch) ? content.activeMatch : 0
  count.textContent = query ? `${activeMatch}/${matches}` : ''
  previous.disabled = !query
  next.disabled = !query

  input.focus()
  if (content.selectAll) input.select()
}

function renderForm(content) {
  currentItems = []
  selectedIndex = -1
  root.innerHTML = ''

  const container = document.createElement('div')
  container.className = 'form-container'

  const title = document.createElement('div')
  title.className = 'form-title'
  title.textContent = content.title || ''
  container.appendChild(title)

  const inputs = {}

  for (const field of (content.fields || [])) {
    const fieldEl = document.createElement('div')
    fieldEl.className = 'form-field'

    const label = document.createElement('label')
    label.className = 'form-label'
    label.textContent = field.label || ''
    fieldEl.appendChild(label)

    if (field.readonly) {
      const text = document.createElement('div')
      text.className = 'form-input form-readonly'
      text.textContent = field.value || ''
      fieldEl.appendChild(text)
    } else {
      const input = document.createElement('input')
      input.className = 'form-input'
      input.value = field.value || ''
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          collectAndSend('save')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          window.overlayBridge.sendAction('dismiss', {})
        }
      })
      fieldEl.appendChild(input)
      inputs[field.id] = input
    }

    container.appendChild(fieldEl)
  }

  function collectAndSend(actionId) {
    const values = {}
    for (const [id, input] of Object.entries(inputs)) {
      values[id] = input.value
    }
    window.overlayBridge.sendAction(actionId, values)
  }

  const actionsRow = document.createElement('div')
  actionsRow.className = 'form-actions'

  for (const action of (content.actions || [])) {
    const btn = document.createElement('button')
    btn.className = 'form-btn ' + (action.primary ? 'form-btn-primary' : 'form-btn-secondary')
    btn.textContent = action.label || action.id
    btn.addEventListener('click', () => {
      if (action.id === 'dismiss') {
        window.overlayBridge.sendAction('dismiss', {})
      } else {
        collectAndSend(action.id)
      }
    })
    actionsRow.appendChild(btn)
  }

  container.appendChild(actionsRow)
  root.appendChild(container)

  const firstInput = container.querySelector('.form-input')
  if (firstInput) firstInput.focus()
}

function renderApproval(content, animate = true) {
  currentItems = []
  selectedIndex = -1
  root.className = 'modal-mode'
  root.innerHTML = ''

  const scrim = document.createElement('div')
  scrim.className = 'tc-scrim'

  const card = document.createElement('div')
  card.className = 'tc-card' + (animate ? '' : ' tc-card-static')
  card.addEventListener('click', (e) => e.stopPropagation())
  let actionPending = false
  const dispatchAction = (action, data) => {
    if (actionPending) return
    actionPending = true
    for (const button of card.querySelectorAll('button')) button.disabled = true
    window.overlayBridge.sendAction(action, data)
  }
  scrim.addEventListener('click', () => dispatchAction('dismiss', {}))

  if (content.icon) {
    const img = document.createElement('img')
    img.className = 'tc-icon'
    img.src = content.icon
    card.appendChild(img)
  } else if (content.iconTon) {
    // No site favicon: show the TON logo instead of a generic globe.
    const fb = document.createElement('div')
    fb.className = 'tc-icon-ton'
    fb.innerHTML =
      '<svg width="52" height="52" viewBox="0 0 237 237" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M118.204 0.000292436C183.486 0.000292436 236.408 52.9224 236.408 118.205C236.408 183.487 183.486 236.408 118.204 236.408C52.9216 236.408 0.000184007 183.487 0 118.205C0 52.9225 52.9215 0.000452012 118.204 0.000292436ZM74.1011 62.1965C57.6799 62.1965 47.268 79.912 55.5308 94.2347L109.964 188.582C113.619 194.922 122.781 194.922 126.436 188.582L180.88 94.2347C189.132 79.9343 178.72 62.1966 162.31 62.1965H74.1011ZM162.288 78.8412C166.031 78.8412 168.234 82.8121 166.45 85.9075L137.856 137.091L137.851 137.099L126.506 159.046V78.8412H162.288ZM109.872 78.8517V159.024L98.5376 137.088L98.5334 137.08L69.9294 85.9215L69.8468 85.7725C68.2134 82.6997 70.405 78.8517 74.0899 78.8517H109.872Z" fill="#4DB8FF"/></svg>'
    card.appendChild(fb)
  } else if (content.iconFallback) {
    const fb = document.createElement('div')
    fb.className = 'tc-icon-fallback'
    fb.textContent = content.iconFallback
    card.appendChild(fb)
  }

  if (content.title) {
    const t = document.createElement('div')
    t.className = 'tc-title'
    t.textContent = content.title
    card.appendChild(t)
  }
  if (content.subtitle) {
    const s = document.createElement('div')
    s.className = 'tc-subtitle'
    s.textContent = content.subtitle
    card.appendChild(s)
  }
  // Verified domain chip: the one trust anchor (appName/icon are spoofable).
  if (content.domain) {
    const d = document.createElement('div')
    d.className = 'tc-domain'
    d.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    const span = document.createElement('span')
    span.textContent = content.domain
    d.appendChild(span)
    card.appendChild(d)
  }
  if (content.amount) {
    const a = document.createElement('div')
    a.className = 'tc-amount'
    const parts = String(content.amount).split(' ')
    if (parts.length > 1) {
      const unit = parts.pop()
      a.textContent = parts.join(' ')
      const u = document.createElement('span')
      u.className = 'unit'
      u.textContent = unit
      a.appendChild(u)
    } else {
      a.textContent = content.amount
    }
    card.appendChild(a)
  }

  if (content.warning) {
    const w = document.createElement('div')
    w.className = 'tc-warning'
    w.textContent = content.warning
    card.appendChild(w)
  }

  if (Array.isArray(content.rows) && content.rows.length) {
    const rows = document.createElement('div')
    rows.className = 'tc-rows'
    for (const r of content.rows) {
      const row = document.createElement('div')
      row.className = 'tc-row'
      const label = document.createElement('span')
      label.className = 'tc-row-label'
      label.textContent = r.label || ''
      const value = document.createElement('span')
      value.className = 'tc-row-value'
      value.textContent = r.value || ''
      row.appendChild(label)
      row.appendChild(value)
      if (r.action && r.action.id) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'tc-row-action'
        button.textContent = r.action.label || r.action.id
        let editing = false
        const openEditor = () => {
          if (!r.action.editable) {
            dispatchAction(r.action.id, {})
            return
          }
          if (editing) return
          editing = true

          value.hidden = true
          button.hidden = true

          const editor = document.createElement('div')
          editor.className = 'tc-row-editor'
          const input = document.createElement('input')
          input.className = 'tc-row-input'
          input.type = 'text'
          input.value = r.action.value || ''
          input.placeholder = r.action.placeholder || ''
          input.setAttribute('aria-label', r.label || 'Edit value')

          const error = document.createElement('span')
          error.className = 'tc-row-error'
          error.textContent = r.action.error || ''

          const controls = document.createElement('div')
          controls.className = 'tc-row-editor-actions'
          const cancel = document.createElement('button')
          cancel.type = 'button'
          cancel.className = 'tc-row-editor-button'
          cancel.textContent = 'Cancel'
          const save = document.createElement('button')
          save.type = 'button'
          save.className = 'tc-row-editor-button primary'
          save.textContent = 'Save'
          controls.appendChild(cancel)
          controls.appendChild(save)
          editor.appendChild(input)
          editor.appendChild(error)
          editor.appendChild(controls)
          row.appendChild(editor)

          const closeEditor = () => {
            editing = false
            editor.remove()
            value.hidden = false
            button.hidden = false
            button.focus()
          }
          const saveValue = () => {
            const maxBytes = Number(r.action.maxBytes) || 0
            if (maxBytes > 0 && new TextEncoder().encode(input.value).length > maxBytes) {
              error.textContent = `Memo must be ${maxBytes} bytes or less.`
              return
            }
            input.disabled = true
            cancel.disabled = true
            save.disabled = true
            save.textContent = 'Saving…'
            const field = r.action.field || 'value'
            dispatchAction(r.action.id, { [field]: input.value })
          }

          cancel.addEventListener('click', closeEditor)
          save.addEventListener('click', saveValue)
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              saveValue()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeEditor()
            }
          })
          input.addEventListener('input', () => {
            error.textContent = ''
          })
          input.focus()
          input.select()
        }
        button.addEventListener('click', openEditor)
        row.appendChild(button)
        if (r.action.autoEdit) requestAnimationFrame(openEditor)
      }
      if (r.toggle && r.toggle.id) {
        const toggle = document.createElement('button')
        const checked = r.toggle.checked === true
        toggle.type = 'button'
        toggle.className = 'tc-toggle' + (checked ? ' checked' : '')
        toggle.setAttribute('role', 'switch')
        toggle.setAttribute('aria-label', r.label || 'Toggle')
        toggle.setAttribute('aria-checked', String(checked))
        const thumb = document.createElement('span')
        thumb.className = 'tc-toggle-thumb'
        toggle.appendChild(thumb)
        toggle.addEventListener('click', () => {
          dispatchAction(r.toggle.id, { enabled: !checked })
        })
        row.appendChild(toggle)
      }
      rows.appendChild(row)
    }
    card.appendChild(rows)
  }

  const actions = document.createElement('div')
  actions.className = 'tc-actions'
  for (const action of (content.actions || [])) {
    const btn = document.createElement('button')
    btn.className = 'tc-btn ' + (action.primary ? 'tc-btn-primary' : 'tc-btn-secondary')
    btn.textContent = action.label || action.id
    btn.addEventListener('click', () => dispatchAction(action.id, {}))
    actions.appendChild(btn)
  }
  card.appendChild(actions)

  scrim.appendChild(card)
  root.appendChild(scrim)
}

function updateSelection(index) {
  const items = root.querySelectorAll('.suggestion-item, .menu-item:not(.disabled)')
  items.forEach((el) => el.classList.remove('selected'))

  if (index >= 0 && index < items.length) {
    items[index].classList.add('selected')
    items[index].scrollIntoView({ block: 'nearest' })
  }

  selectedIndex = index
}

window.overlayBridge.onContent((content) => {
  if (!content) {
    root.innerHTML = ''
    root.className = ''
    currentItems = []
    selectedIndex = -1
    return
  }

  const updatingApproval = content.type === 'approval' && root.classList.contains('modal-mode') && root.childElementCount > 0
  root.className = ''
  if (content.type === 'suggestions' && content.items) {
    renderSuggestions(content.items)
    if (typeof content.selectedIndex === 'number') {
      updateSelection(content.selectedIndex)
    }
  } else if (content.type === 'menu' && content.items) {
    renderMenu(content.items)
  } else if (content.type === 'find') {
    renderFind(content)
  } else if (content.type === 'form') {
    renderForm(content)
  } else if (content.type === 'approval') {
    renderApproval(content, !updatingApproval)
  }
})

window.overlayBridge.onTheme((theme) => {
  if (!theme) return
  const rootEl = document.documentElement
  for (const [key, value] of Object.entries(theme)) {
    rootEl.style.setProperty(key, value)
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    window.overlayBridge.sendAction('dismiss', {})
    return
  }

  const selectableItems = root.querySelectorAll('.suggestion-item, .menu-item:not(.disabled)')
  const count = selectableItems.length
  if (count === 0) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    updateSelection(selectedIndex < count - 1 ? selectedIndex + 1 : 0)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    updateSelection(selectedIndex > 0 ? selectedIndex - 1 : count - 1)
  } else if (e.key === 'Enter' && selectedIndex >= 0) {
    e.preventDefault()
    selectableItems[selectedIndex].click()
  }
})
