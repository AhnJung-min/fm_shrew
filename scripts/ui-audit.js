/*
  화면 안에서 재기(디자인 적용 1차 검증 틀). 이 파일은 끝 식이 결과 객체인 식 하나다.
  - scripts/ui-shots.mjs가 headless 브라우저의 Runtime.evaluate로 돌리고, 리드는 실제 앱에서 FMB_SMOKE_JS로도 돌린다(같은 숫자를 얻는다).
  - 화면을 바꾸지 않는다(표를 밀거나 사이드바 높이를 풀어 재는 것은 같은 걸음 안에서 되돌린다).
  - 결과는 JSON으로 옮길 수 있는 값만 담는다. 선택 사항은 window.__fmbAuditOptions({ noFingerprint: true })로 준다.
  재는 것: userAgent, fonts, minFontPx, smallDimText, smallColorNoIcon, contrastFails, weights, overflowX, tableRows, tableRowCapacity,
  stickyCols, sidebarFits, titleCount, tabStops, animations, fingerprint(요소마다 경로·상자·글자 앞 40자·계산된 스타일).
*/
(() => {
  const options = (typeof window !== 'undefined' && window.__fmbAuditOptions) || {}
  const LIST_MAX = 20
  const FONT_FLOOR = 12.5
  const doc = document
  const root = doc.documentElement
  const rootStyle = getComputedStyle(root)
  const round = (value, digits = 1) => {
    const scale = 10 ** digits
    return Math.round(value * scale) / scale
  }

  // ---------- 색 ----------
  const canvas = doc.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  /** 캔버스에 칠해서 읽는다. 읽을 수 없는 글자(칠하는 값이 그대로 남는 것)는 null이다 */
  const viaCanvas = (text) => {
    for (const sentinel of ['#010203', '#040506']) {
      ctx.fillStyle = sentinel
      ctx.fillStyle = text
      if (ctx.fillStyle !== sentinel) {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillRect(0, 0, 1, 1)
        const data = ctx.getImageData(0, 0, 1, 1).data
        return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 }
      }
    }
    return null
  }
  const alphaOf = (text) => (text === undefined ? 1 : text.endsWith('%') ? parseFloat(text) / 100 : Number(text))
  /** 계산된 색 글자를 { r, g, b, a }로. rgb()/rgba()/color(srgb …)는 바로 읽고 나머지는 캔버스에 칠해서 읽는다 */
  const parseColor = (text) => {
    if (!text) return null
    const value = text.trim()
    if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
    let match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value)
    if (match) return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alphaOf(match[4]) }
    match = /^color\(\s*srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.e+-]+%?))?\s*\)$/.exec(value)
    if (match) return { r: Number(match[1]) * 255, g: Number(match[2]) * 255, b: Number(match[3]) * 255, a: alphaOf(match[4]) }
    return viaCanvas(value)
  }
  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a)
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 }
    const mix = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / a
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a }
  }
  const luminance = (color) => {
    const channel = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
  }
  const contrast = (a, b) => {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  const sameColor = (a, b) => !!a && !!b && Math.abs(a.r - b.r) < 1.5 && Math.abs(a.g - b.g) < 1.5 && Math.abs(a.b - b.b) < 1.5 && Math.abs(a.a - b.a) < 0.02
  const hex = (color) => '#' + [color.r, color.g, color.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') + (color.a < 0.995 ? ` ${round(color.a, 2)}` : '')
  const tokenColor = (name) => parseColor(rootStyle.getPropertyValue(name).trim() ? resolveVar(name) : '')
  /** 토큰의 계산된 색: 임시 요소에 칠해서 읽는다(var()와 color-mix()가 든 토큰도 맞게 읽힌다) */
  function resolveVar(name) {
    const probe = doc.createElement('span')
    probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`
    doc.body.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }
  const colors = {
    text3: tokenColor('--text-3'),
    meaning: ['--gold', '--good', '--warn', '--bad'].map(tokenColor)
  }
  const pageBackground = (() => {
    const body = parseColor(getComputedStyle(doc.body).backgroundColor)
    const html = parseColor(rootStyle.backgroundColor)
    const base = { r: 0, g: 0, b: 0, a: 1 }
    return over(body ?? { r: 0, g: 0, b: 0, a: 0 }, over(html ?? { r: 0, g: 0, b: 0, a: 0 }, base))
  })()

  // ---------- 요소 ----------
  const isSvg = (el) => typeof SVGElement !== 'undefined' && el instanceof SVGElement
  const classTokens = (el) => (isSvg(el) ? el.getAttribute('class') || '' : typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean)
  const label = (el) => el.tagName.toLowerCase() + classTokens(el).slice(0, 2).map((name) => '.' + name).join('')
  /** 보고에 쓰는 짧은 이름: 윗대 둘 > 자기 */
  const shortPath = (el) => {
    const parts = []
    for (let node = el; node && node !== doc.body && parts.length < 3; node = node.parentElement) parts.unshift(label(node))
    return parts.join(' > ')
  }
  const visible = (el) => {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const rectOf = (el) => el.getBoundingClientRect()
  const cumulativeOpacity = (el) => {
    let opacity = 1
    for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    return opacity
  }
  const hasIconBeside = (el) => {
    if (el.querySelector('svg')) return true
    const beside = [el.previousElementSibling, el.nextElementSibling]
    if (beside.some((other) => other && (other.tagName.toLowerCase() === 'svg' || other.querySelector('svg')))) return true
    const parent = el.parentElement
    return !!parent && [...parent.children].some((child) => child !== el && child.tagName.toLowerCase() === 'svg')
  }
  const inTagOrChip = (el) => {
    for (let node = el; node && node !== doc.body; node = node.parentElement) {
      if (classTokens(node).some((name) => /(^|-)(tag|chip|badge|pill|tier)(-|$)/.test(name))) return true
    }
    return false
  }
  const isDisabled = (el) => !!el.closest('button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled="true"], fieldset:disabled')

  /** 글자가 놓인 실제 바탕: 조상의 반투명 바탕을 차례로 겹친다(옅은 줄무늬 그라디언트 한 겹도 읽는다) */
  function effectiveBackground(el) {
    const layers = []
    let opaque = false
    for (let node = el; node && !opaque; node = node.parentElement) {
      const style = getComputedStyle(node)
      // 줄무늬는 같은 색 둘짜리 linear-gradient다: 첫 색 하나만 한 겹으로 읽는다
      const gradient = /^linear-gradient\(.*?(rgba?\([^)]*\)|color\([^)]*\))/.exec(style.backgroundImage)
      if (gradient) {
        const first = parseColor(gradient[1])
        if (first && first.a > 0) layers.push(first)
      }
      const bg = parseColor(style.backgroundColor)
      if (bg && bg.a > 0) {
        layers.push(bg)
        if (bg.a >= 0.995) opaque = true
      }
    }
    let result = opaque ? layers.pop() : pageBackground
    while (layers.length) result = over(layers.pop(), result)
    return result
  }

  /** SVG 글자 밑에 깔린 도형(나중에 그려질수록 위)의 채움을 겹친다. 도형의 상자 안에 글자 한가운데가 들면 깔린 것으로 본다 */
  function svgBackground(text) {
    const svg = text.ownerSVGElement
    let result = effectiveBackground(svg)
    if (!svg) return result
    const box = rectOf(text)
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const shapes = [...svg.querySelectorAll('rect, circle, ellipse, path, polygon')]
    for (const shape of shapes) {
      if (shape === text || (shape.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_PRECEDING)) continue
      const rect = rectOf(shape)
      if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue
      const style = getComputedStyle(shape)
      const fill = parseColor(style.fill)
      if (!fill || style.fill === 'none' || fill.a <= 0) continue
      result = over({ ...fill, a: fill.a * Number(style.fillOpacity) * Number(style.opacity) }, result)
    }
    return result
  }

  // ---------- 보이는 글자 모으기 ----------
  const texts = []
  const seenEl = new Set()
  const addText = (el, via) => {
    if (seenEl.has(el)) return
    seenEl.add(el)
    const box = rectOf(el)
    if (box.width < 2 || box.height < 2 || !visible(el)) return
    const style = getComputedStyle(el)
    const svg = isSvg(el)
    let size = parseFloat(style.fontSize)
    if (svg && typeof el.getScreenCTM === 'function') {
      const ctm = el.getScreenCTM()
      if (ctm) size *= Math.hypot(ctm.a, ctm.b)
    }
    const fgText = svg ? style.fill : style.color
    const own = via === 'text' ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('') : el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent || '' : el.value || ''
    texts.push({ el, via, svg, size, weight: Number(style.fontWeight) || 400, fg: parseColor(fgText), text: own.replace(/\s+/g, ' ').trim() })
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim()) continue
    const el = node.parentElement
    if (el && !el.closest('script, style, noscript, template, option, [hidden]')) addText(el, 'text')
  }
  // 입력 칸 안의 값(글자 마디가 아니라서 따로 모은다)
  for (const input of doc.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select')) {
    if (input.tagName === 'SELECT' || (input.value || '').length > 0) addText(input, 'value')
  }

  // ---------- 글자 크기와 흐린 글자 ----------
  const minFontOffenders = []
  let minFontPx = Infinity
  const smallDim = []
  let smallDimDisabled = 0
  const smallColor = []
  const contrastFailList = []
  let contrastDisabled = 0
  let contrastMin = Infinity
  const weightCounts = {}
  const heavy = []
  const offLadder = []
  for (const entry of texts) {
    const { el, svg, size, weight, fg } = entry
    if (size < minFontPx) minFontPx = size
    if (size < FONT_FLOOR - 0.05 && minFontOffenders.length < LIST_MAX) minFontOffenders.push({ at: shortPath(el), size: round(size, 2), text: entry.text.slice(0, 24), svg })
    weightCounts[weight] = (weightCounts[weight] || 0) + 1
    if (![400, 600, 700, 800].includes(weight) && offLadder.length < LIST_MAX) offLadder.push({ at: shortPath(el), weight, text: entry.text.slice(0, 24) })
    if (weight >= 800) heavy.push({ at: shortPath(el), text: entry.text.slice(0, 24), size: round(size, 1) })
    if (!fg) continue
    const disabled = isDisabled(el)
    // 12.5px 이하인데 --text-3인 글자
    if (size <= FONT_FLOOR + 0.01 && sameColor(fg, colors.text3)) {
      if (disabled) smallDimDisabled++
      else smallDim.push({ at: shortPath(el), size: round(size, 2), text: entry.text.slice(0, 24) })
    }
    // 13.5px 미만의 뜻 색 글자가 태그·칩 밖에 있고 옆에 아이콘도 없는 것
    if (!svg && size < 13.5 && colors.meaning.some((c) => sameColor(fg, c)) && !inTagOrChip(el) && !hasIconBeside(el)) {
      smallColor.push({ at: shortPath(el), size: round(size, 2), text: entry.text.slice(0, 24) })
    }
    // 글자색과 실제 바탕의 대비
    const bg = svg ? svgBackground(el) : effectiveBackground(el)
    const alpha = fg.a * cumulativeOpacity(el)
    const shown = over({ ...fg, a: alpha }, { ...bg, a: 1 })
    const ratio = contrast(shown, { ...bg, a: 1 })
    if (ratio < contrastMin) contrastMin = ratio
    if (ratio < 4.5) {
      if (disabled) contrastDisabled++
      else contrastFailList.push({ at: shortPath(el), ratio: round(ratio, 2), fg: hex(shown), bg: hex(bg), size: round(size, 1), text: entry.text.slice(0, 24), svg })
    }
  }
  // 입력 칸 안내 글(placeholder)은 따로 센다
  let smallDimPlaceholder = 0
  for (const input of doc.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (!visible(input) || input.value) continue
    const style = getComputedStyle(input, '::placeholder')
    if (parseFloat(getComputedStyle(input).fontSize) <= FONT_FLOOR + 0.01 && sameColor(parseColor(style.color), colors.text3)) smallDimPlaceholder++
  }

  // ---------- 문서 넘침 ----------
  const overflowX = Math.max(0, Math.max(root.scrollWidth, doc.body.scrollWidth) - root.clientWidth)
  const main = doc.querySelector('main, .main')
  const mainOverflowX = main ? Math.max(0, main.scrollWidth - main.clientWidth) : 0

  // ---------- 표: 온전히 보이는 줄, 들어갈 줄, 고정 칸 ----------
  // 주 표는 선수 표(.ptable)다. 대시보드의 순위표 같은 작은 표는 세지 않는다
  const mainTable = [...doc.querySelectorAll('table.ptable')].find(visible) ?? null
  const scroller = mainTable ? mainTable.closest('.table-scroll') || mainTable.parentElement : null
  let table = { found: false }
  let tableRows = null
  let tableRowCapacity = null
  let stickyCols = null
  let tabStops = null
  if (scroller) {
    const head = scroller.querySelector('thead')
    const area = rectOf(scroller)
    const headBottom = head ? rectOf(head).bottom : area.top
    // 보이는 아래쪽 끝: 스크롤 칸의 안쪽(가로 스크롤 막대 위)과 화면, 그 사이 스크롤 조상의 안쪽 가운데 가장 위
    let bottom = Math.min(area.top + scroller.clientTop + scroller.clientHeight, window.innerHeight)
    for (let node = scroller.parentElement; node && node !== doc.body; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowY !== 'visible') {
        const box = rectOf(node)
        bottom = Math.min(bottom, box.top + node.clientTop + node.clientHeight)
      }
    }
    const rows = [...scroller.querySelectorAll('tbody tr.row')]
    const rowHeight = rows.length ? rectOf(rows[0]).height : parseFloat(rootStyle.getPropertyValue('--row-h')) || 36
    tableRows = rows.filter((row) => {
      const box = rectOf(row)
      return box.top >= headBottom - 0.5 && box.bottom <= bottom + 0.5
    }).length
    tableRowCapacity = Math.max(0, Math.floor((bottom - headBottom + 0.5) / rowHeight))
    // 고정 칸: 오른쪽으로 600px 민 뒤에도 제자리인 머리 칸(밀 곳이 없으면 null)
    const heads = [...scroller.querySelectorAll('thead tr:last-child th')]
    const before = heads.map((cell) => rectOf(cell).left)
    const savedLeft = scroller.scrollLeft
    scroller.scrollLeft = 600
    const moved = scroller.scrollLeft - savedLeft
    const after = heads.map((cell) => rectOf(cell).left)
    scroller.scrollLeft = savedLeft
    stickyCols = moved > 0 ? heads.filter((_, i) => Math.abs(after[i] - before[i]) < 0.5).length : null
    tabStops = [...scroller.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]')].filter(
      (el) => !el.disabled && el.tabIndex >= 0 && visible(el)
    ).length
    table = { found: true, rowHeight: round(rowHeight, 1), renderedRows: rows.length, headBottom: round(headBottom), viewBottom: round(bottom), scrolledBy: round(moved), columns: heads.length }
  }

  // ---------- 사이드바: 제 안에서 스크롤하지 않는지와 남는 높이 ----------
  const side = doc.querySelector('aside.sidebar, .sidebar, aside')
  let sidebarFits = null
  if (side && visible(side)) {
    const clientHeight = side.clientHeight
    const scrolls = side.scrollHeight > clientHeight + 1
    // 남는 높이: 칸을 내용만큼으로 줄였을 때의 높이와 지금 높이의 차(되돌린다)
    const saved = { alignSelf: side.style.alignSelf, height: side.style.height, minHeight: side.style.minHeight, overflow: side.style.overflowY }
    side.style.alignSelf = 'start'
    side.style.height = 'min-content'
    side.style.minHeight = '0'
    side.style.overflowY = 'visible'
    const natural = side.getBoundingClientRect().height
    side.style.alignSelf = saved.alignSelf
    side.style.height = saved.height
    side.style.minHeight = saved.minHeight
    side.style.overflowY = saved.overflow
    sidebarFits = { scrolls, free: round(side.offsetHeight - natural), height: side.offsetHeight, contentHeight: round(natural) }
  }

  // ---------- 남은 title 속성 ----------
  const titleCount = { total: 0, sidebar: 0, main: 0, drawer: 0, other: 0, svgTitles: 0 }
  const titleSamples = []
  for (const el of doc.querySelectorAll('[title]')) {
    if (!visible(el)) continue
    titleCount.total++
    const region = el.closest('aside.sidebar, .sidebar') ? 'sidebar' : el.closest('.drawer, [role="dialog"], dialog') ? 'drawer' : el.closest('main, .main') ? 'main' : 'other'
    titleCount[region]++
    if (titleSamples.length < LIST_MAX) titleSamples.push({ at: shortPath(el), title: String(el.getAttribute('title')).slice(0, 30) })
  }
  for (const title of doc.querySelectorAll('svg > title')) if (visible(title.parentElement)) titleCount.svgTitles++

  // ---------- 움직임 ----------
  const running = typeof doc.getAnimations === 'function' ? doc.getAnimations().filter((a) => a.playState === 'running') : []
  const animations = { running: running.length, names: running.slice(0, 5).map((a) => a.animationName || a.transitionProperty || a.constructor.name) }

  // ---------- 글꼴 ----------
  const faces = [...doc.fonts].filter((face) => /pretendard/i.test(face.family)).map((face) => ({ family: face.family, status: face.status }))
  const fonts = {
    faces,
    pretendardLoaded: faces.some((face) => face.status === 'loaded'),
    pretendardError: faces.some((face) => face.status === 'error'),
    bodyFamily: getComputedStyle(doc.body).fontFamily.slice(0, 60)
  }

  // ---------- 지문: 보이는 요소마다 경로, 상자, 글자 앞 40자, 계산된 스타일 ----------
  const pathCache = new WeakMap()
  const pathOf = (el) => {
    if (el === root) return ''
    let known = pathCache.get(el)
    if (known === undefined) {
      const parent = el.parentElement
      const above = parent ? pathOf(parent) : ''
      known = `${above ? above + '>' : ''}${label(el)}:${parent ? Array.prototype.indexOf.call(parent.children, el) + 1 : 1}`
      pathCache.set(el, known)
    }
    return known
  }
  const borderOf = (style, side) => {
    const width = parseFloat(style[`border${side}Width`])
    return width > 0 && style[`border${side}Style`] !== 'none' ? `${width}px ${style[`border${side}Style`]} ${style[`border${side}Color`]}` : ''
  }
  const styleOf = (style, el) => {
    // 그림 도형(글자가 아닌 SVG 요소)은 글자 스타일이 없으니 채움과 선만 적는다
    if (isSvg(el) && !['text', 'tspan'].includes(el.tagName.toLowerCase())) {
      return [`fill=${style.fill}`, `stroke=${style.stroke}`, ...(style.opacity !== '1' ? [`op=${style.opacity}`] : [])].join(';')
    }
    const out = [`c=${style.color}`, `bg=${style.backgroundColor}`, `fs=${style.fontSize}`, `fw=${style.fontWeight}`, `lh=${style.lineHeight}`]
    const borders = ['Top', 'Right', 'Bottom', 'Left'].map((side) => borderOf(style, side))
    if (borders.some(Boolean)) out.push(`bd=${borders.join('|')}`)
    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) out.push(`ol=${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`)
    if (style.opacity !== '1') out.push(`op=${style.opacity}`)
    if (style.boxShadow !== 'none') out.push(`sh=${style.boxShadow}`)
    if (style.zIndex !== 'auto') out.push(`z=${style.zIndex}`)
    if (style.fontVariantNumeric !== 'normal') out.push(`nv=${style.fontVariantNumeric}`)
    if (style.whiteSpace !== 'normal') out.push(`ws=${style.whiteSpace}`)
    if (style.backgroundImage !== 'none') out.push(`bi=${style.backgroundImage.slice(0, 80)}`)
    if (isSvg(el)) out.push(`fill=${style.fill}`)
    return out.join(';')
  }
  const ownText = (el) =>
    [...el.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.nodeValue)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
  let fingerprint = null
  if (!options.noFingerprint) {
    fingerprint = []
    const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'BR', 'OPTION', 'COL', 'COLGROUP'])
    for (const el of doc.body.querySelectorAll('*')) {
      if (skip.has(el.tagName) || (isSvg(el) && el.tagName.toLowerCase() === 'title')) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.display === 'contents' || style.visibility === 'hidden') continue
      const box = rectOf(el)
      if (box.width === 0 && box.height === 0) continue
      const where = pathOf(el)
      fingerprint.push([where, `${round(box.left)},${round(box.top)},${round(box.width)},${round(box.height)}`, ownText(el), styleOf(style, el)].join('\t'))
      for (const pseudo of ['::before', '::after']) {
        const inner = getComputedStyle(el, pseudo)
        if (inner.content === 'none' || inner.content === 'normal' || inner.display === 'none') continue
        fingerprint.push([where + pseudo, `${inner.width},${inner.height}`, inner.content.slice(0, 40), styleOf(inner, el)].join('\t'))
      }
    }
  }

  const list = (items) => items.slice(0, LIST_MAX)
  return {
    version: 1,
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio },
    theme: root.dataset.theme || 'blue',
    density: root.dataset.density || 'compact',
    fonts,
    textCount: texts.length,
    minFontPx: texts.length ? round(minFontPx, 2) : null,
    minFontOffenders,
    smallDimText: smallDim.length,
    smallDimTextList: list(smallDim),
    smallDimExcluded: { disabled: smallDimDisabled, placeholder: smallDimPlaceholder },
    smallColorNoIcon: smallColor.length,
    smallColorNoIconList: list(smallColor),
    contrastFails: contrastFailList.length,
    contrastFailList: list(contrastFailList),
    contrastMin: texts.length ? round(contrastMin, 2) : null,
    contrastDisabledFails: contrastDisabled,
    weights: { counts: weightCounts, offLadder: list(offLadder), heavyCount: heavy.length, heavy: list(heavy) },
    overflowX,
    mainOverflowX,
    tableRows,
    tableRowCapacity,
    table,
    stickyCols,
    sidebarFits,
    titleCount,
    titleSamples,
    tabStops,
    animations,
    fingerprint
  }
})()
