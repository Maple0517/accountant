// Accountant Recent Transactions Widget for Scriptable
// Paste this file into the iOS Scriptable app, then set API_KEY below.

const API_URL = "https://accountant-rose.vercel.app/api/widget/recent-transactions"
const API_KEY = "PASTE_YOUR_API_KEY_HERE"
const APP_URL = "https://accountant-rose.vercel.app/transactions"
const MAX_TRANSACTIONS = 7
const REQUEST_TIMEOUT_SECONDS = 8
const CACHE_FILE_NAME = "accountant-recent-transactions-widget-cache.json"
const CONTENT_WIDTH = 336
const LIST_WIDTH = CONTENT_WIDTH
const ROW_HEIGHT = 39
const LEFT_WIDTH = 146
const PILL_WIDTH = 72
const AMOUNT_WIDTH = 78
const DOT_WIDTH = 9

const COLORS = {
  bg: new Color("#030304"),
  panel: new Color("#070708"),
  divider: new Color("#24262d"),
  text: Color.white(),
  muted: new Color("#878c96"),
  faint: new Color("#5f6570"),
  pillText: Color.white(),
  income: new Color("#34d399"),
  expense: new Color("#f9fafb"),
  pending: new Color("#3b82f6"),
  danger: new Color("#f87171"),
}

const widget = new ListWidget()
widget.backgroundColor = COLORS.bg
widget.url = APP_URL
widget.setPadding(12, 9, 10, 9)

try {
  const payload = await loadTransactions()
  renderWidget(widget, payload)
} catch (error) {
  renderError(widget, error)
}

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentLarge()
}

Script.complete()

async function loadTransactions() {
  const url = `${API_URL}?limit=${encodeURIComponent(MAX_TRANSACTIONS)}`
  const request = new Request(url)
  request.timeoutInterval = REQUEST_TIMEOUT_SECONDS
  request.headers = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: "application/json",
  }

  try {
    const response = await request.loadJSON()
    if (response && response.error) {
      throw new Error(response.error)
    }

    writeCachedPayload(response)
    return response
  } catch (error) {
    const cached = readCachedPayload()
    if (cached) {
      cached.cached = true
      cached.cacheError = String(error.message || error)
      return cached
    }

    throw error
  }
}

function renderWidget(widget, payload) {
  const header = widget.addStack()
  header.layoutHorizontally()
  header.centerAlignContent()
  header.size = new Size(CONTENT_WIDTH, 16)

  const title = header.addText("Recent Transactions")
  title.font = Font.semiboldSystemFont(13)
  title.textColor = COLORS.text
  title.lineLimit = 1

  header.addSpacer()

  const updatedPrefix = payload.cached ? "Cached" : "Fetched"
  const updated = header.addText(`${updatedPrefix} ${formatUpdated(payload.updatedAt)}`)
  updated.font = Font.systemFont(10)
  updated.textColor = COLORS.muted
  updated.lineLimit = 1

  widget.addSpacer(8)

  const transactions = Array.isArray(payload.transactions)
    ? payload.transactions.slice(0, MAX_TRANSACTIONS)
    : []

  if (transactions.length === 0) {
    widget.addSpacer(24)
    const empty = widget.addText("No transactions")
    empty.font = Font.mediumSystemFont(15)
    empty.textColor = COLORS.muted
    empty.centerAlignText()
    widget.addSpacer()
    return
  }

  transactions.forEach((tx, index) => {
    addTransactionRow(widget, tx)
    if (index < transactions.length - 1) {
      const divider = widget.addStack()
      divider.size = new Size(LIST_WIDTH, 0.5)
      divider.backgroundColor = COLORS.divider
    }
  })

  widget.addSpacer()

  const footerLabel = payload.cached
    ? `Last fetch failed: ${truncate(payload.cacheError || "timeout", 24)}`
    : payload.lastSyncedAt
    ? `Synced ${formatRelativeTime(payload.lastSyncedAt)}`
    : `Fetched ${formatRelativeTime(payload.updatedAt)}`
  const footer = widget.addText(footerLabel)
  footer.font = Font.systemFont(9)
  footer.textColor = COLORS.faint
  footer.lineLimit = 1
}

function addTransactionRow(widget, tx) {
  const row = widget.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  row.backgroundColor = COLORS.panel
  row.size = new Size(LIST_WIDTH, ROW_HEIGHT)
  row.setPadding(4, 0, 4, 0)

  const left = row.addStack()
  left.layoutVertically()
  left.size = new Size(LEFT_WIDTH, 31)

  const merchant = left.addText(truncate(tx.merchant || "Unknown merchant", 18))
  merchant.font = Font.semiboldSystemFont(14)
  merchant.textColor = COLORS.text
  merchant.lineLimit = 1
  merchant.minimumScaleFactor = 0.85

  left.addSpacer(1)

  const subtitle = left.addText(truncate(tx.subtitle || tx.dateLabel || "", 22))
  subtitle.font = Font.systemFont(10)
  subtitle.textColor = COLORS.muted
  subtitle.lineLimit = 1
  subtitle.minimumScaleFactor = 0.85

  row.addSpacer(6)

  const pill = row.addStack()
  pill.layoutHorizontally()
  pill.centerAlignContent()
  pill.backgroundColor = pillColor(tx.category && tx.category.color)
  pill.cornerRadius = 8
  pill.size = new Size(PILL_WIDTH, 18)
  pill.setPadding(2, 4, 2, 4)

  const pillLabel = categoryLabel(tx.category)
  const pillText = pill.addText(truncate(pillLabel, 10))
  pillText.font = Font.semiboldSystemFont(8)
  pillText.textColor = COLORS.pillText
  pillText.lineLimit = 1
  pillText.minimumScaleFactor = 0.8
  pillText.centerAlignText()

  row.addSpacer()

  const amountStack = row.addStack()
  amountStack.layoutHorizontally()
  amountStack.size = new Size(AMOUNT_WIDTH, 16)

  const amount = amountStack.addText(formatAmount(tx))
  amount.font = Font.semiboldSystemFont(14)
  amount.textColor = tx.isIncome ? COLORS.income : COLORS.expense
  amount.lineLimit = 1
  amount.rightAlignText()
  amount.minimumScaleFactor = 0.7
  amountStack.addSpacer()

  row.addSpacer(3)

  const dotSlot = row.addStack()
  dotSlot.size = new Size(DOT_WIDTH, 10)
  dotSlot.layoutHorizontally()
  if (tx.pending) {
    const dot = dotSlot.addText("●")
    dot.font = Font.systemFont(7)
    dot.textColor = COLORS.pending
  } else {
    dotSlot.addSpacer()
  }
}

function renderError(widget, error) {
  widget.addSpacer(34)

  const title = widget.addText("Unable to load transactions")
  title.font = Font.semiboldSystemFont(16)
  title.textColor = COLORS.text
  title.centerAlignText()

  widget.addSpacer(6)

  const message = widget.addText(truncate(String(error.message || error), 42))
  message.font = Font.systemFont(11)
  message.textColor = COLORS.danger
  message.centerAlignText()

  widget.addSpacer()
}

function categoryLabel(category) {
  if (!category) return "Uncategorized"
  const icon = category.icon ? `${category.icon} ` : ""
  return `${icon}${category.label || category.name || "Uncategorized"}`
}

function formatAmount(tx) {
  const amount = Math.abs(Number(tx.amount || 0))
  const symbol = currencySymbol(tx.currency)
  const formatted = `${symbol}${amount.toFixed(2)}`
  return tx.isIncome ? `+${formatted}` : formatted
}

function currencySymbol(currency) {
  if (currency === "CNY" || currency === "CNH") return "¥"
  if (currency === "EUR") return "€"
  if (currency === "GBP") return "£"
  return "$"
}

function pillColor(color) {
  if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
    return new Color(color, 0.78)
  }

  return new Color("#2d3138", 0.78)
}

function formatUpdated(value) {
  return formatRelativeTime(value)
}

function formatRelativeTime(value) {
  const date = value ? new Date(value) : new Date()
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))

  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.floor(hours / 24)}d ago`
}

function truncate(value, max) {
  const text = String(value || "")
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

function cachePath() {
  const fm = FileManager.local()
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE_NAME)
}

function readCachedPayload() {
  try {
    const fm = FileManager.local()
    const path = cachePath()
    if (!fm.fileExists(path)) return null
    return JSON.parse(fm.readString(path))
  } catch {
    return null
  }
}

function writeCachedPayload(payload) {
  try {
    if (!payload || payload.error) return
    const fm = FileManager.local()
    fm.writeString(cachePath(), JSON.stringify(payload))
  } catch {
    // Cache is best-effort. Rendering fresh data matters more.
  }
}
