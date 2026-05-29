// Accountant Recent Transactions Widget for Scriptable
// Paste this file into the iOS Scriptable app, then set API_KEY below.

const API_URL = "https://accountant-rose.vercel.app/api/widget/recent-transactions"
const API_KEY = "PASTE_YOUR_API_KEY_HERE"
const APP_URL = "https://accountant-rose.vercel.app/transactions"
const MAX_TRANSACTIONS = 7

const COLORS = {
  bg: new Color("#050506"),
  row: new Color("#0f1014"),
  text: Color.white(),
  muted: new Color("#9ca3af"),
  pillText: Color.white(),
  income: new Color("#34d399"),
  expense: new Color("#f9fafb"),
  pending: new Color("#3b82f6"),
  danger: new Color("#f87171"),
}

const widget = new ListWidget()
widget.backgroundColor = COLORS.bg
widget.url = APP_URL
widget.setPadding(14, 14, 12, 14)

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
  request.headers = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: "application/json",
  }

  const response = await request.loadJSON()
  if (response && response.error) {
    throw new Error(response.error)
  }

  return response
}

function renderWidget(widget, payload) {
  const header = widget.addStack()
  header.layoutHorizontally()
  header.centerAlignContent()

  const title = header.addText("Recent Transactions")
  title.font = Font.semiboldSystemFont(14)
  title.textColor = COLORS.text
  title.lineLimit = 1

  header.addSpacer()

  const updated = header.addText(formatUpdated(payload.updatedAt))
  updated.font = Font.systemFont(10)
  updated.textColor = COLORS.muted
  updated.lineLimit = 1

  widget.addSpacer(10)

  const transactions = Array.isArray(payload.transactions)
    ? payload.transactions.slice(0, MAX_TRANSACTIONS)
    : []

  if (transactions.length === 0) {
    widget.addSpacer(28)
    const empty = widget.addText("No transactions")
    empty.font = Font.mediumSystemFont(15)
    empty.textColor = COLORS.muted
    empty.centerAlignText()
    widget.addSpacer()
    return
  }

  for (const tx of transactions) {
    addTransactionRow(widget, tx)
    widget.addSpacer(7)
  }

  widget.addSpacer()

  const footer = widget.addText(`Updated ${formatRelativeTime(payload.updatedAt)}`)
  footer.font = Font.systemFont(10)
  footer.textColor = COLORS.muted
  footer.lineLimit = 1
}

function addTransactionRow(widget, tx) {
  const row = widget.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  row.backgroundColor = COLORS.row
  row.cornerRadius = 10
  row.setPadding(7, 8, 7, 8)

  const left = row.addStack()
  left.layoutVertically()
  left.size = new Size(126, 38)

  const merchant = left.addText(truncate(tx.merchant || "Unknown merchant", 18))
  merchant.font = Font.semiboldSystemFont(13)
  merchant.textColor = COLORS.text
  merchant.lineLimit = 1

  left.addSpacer(3)

  const subtitle = left.addText(truncate(tx.subtitle || tx.dateLabel || "", 22))
  subtitle.font = Font.systemFont(10)
  subtitle.textColor = COLORS.muted
  subtitle.lineLimit = 1

  row.addSpacer(6)

  const pill = row.addStack()
  pill.layoutHorizontally()
  pill.centerAlignContent()
  pill.backgroundColor = pillColor(tx.category && tx.category.color)
  pill.cornerRadius = 8
  pill.setPadding(3, 6, 3, 6)

  const pillLabel = categoryLabel(tx.category)
  const pillText = pill.addText(truncate(pillLabel, 10))
  pillText.font = Font.mediumSystemFont(9)
  pillText.textColor = COLORS.pillText
  pillText.lineLimit = 1

  row.addSpacer(6)

  const amount = row.addText(formatAmount(tx))
  amount.font = Font.semiboldSystemFont(12)
  amount.textColor = tx.isIncome ? COLORS.income : COLORS.expense
  amount.lineLimit = 1
  amount.rightAlignText()
  amount.minimumScaleFactor = 0.75

  if (tx.pending) {
    row.addSpacer(4)
    const dot = row.addText("●")
    dot.font = Font.systemFont(8)
    dot.textColor = COLORS.pending
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
    return new Color(color)
  }

  return new Color("#374151")
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
