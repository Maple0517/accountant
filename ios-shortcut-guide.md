# Accountant App - iOS Shortcut Capture Guide

This guide sets up an Apple Shortcut that sends a receipt photo, payment screenshot, or banking transaction screenshot to Accountant. Gemini Vision extracts the transaction and the app saves it automatically.

## Prerequisites
1. You have a deployed Accountant App URL, for example `https://your-app-domain.com`.
2. You have created an account in the web app.
3. In the web app, open **Settings -> iOS Shortcut Capture** and click **Generate Key**. Copy the `ak_...` key immediately; it is only shown once.

## What The App Does
When the Shortcut posts an image to `/api/receipt`, the app will:
1. Authenticate the request with your `ak_...` API key.
2. Use Gemini Vision to identify the merchant/counterparty, amount, currency, date, payment method, and whether it is an expense, income, or transfer.
3. Create or reuse a manual account named **iOS Capture**.
4. Insert a transaction into the app with `source = receipt` and useful tags like `payment_screenshot` or `expense`.

This workflow does not require Plaid.

## Recommended Shortcut: Share Screenshot Or Photo
This is the most reliable iOS flow because it works with screenshots from any app.

1. Open **Shortcuts** and create a new Shortcut named `Capture Transaction`.
2. Open the Shortcut details and enable **Show in Share Sheet**.
3. Set accepted input types to **Images**.
4. Add **Resize Image** and resize the Shortcut Input to a max width of `1280`.
5. Add a **Text** action with your Capture Endpoint:
   `https://your-app-domain.com/api/receipt`
6. Add **Get Contents of URL**:
   - URL: the Text action from step 5
   - Method: `POST`
   - Request Body: `Form`
7. Add these form fields:
   - Type: `File`, Key: `image`, Value: the resized image
   - Type: `Text`, Key: `api_key`, Value: your `ak_...` key
   - Type: `Text`, Key: `currency`, Value: `USD` or `CNY`
   - Type: `Text`, Key: `notes`, Value: optional
8. Add **Show Result** and show the response from **Get Contents of URL**.

Usage:
1. Take a normal iPhone screenshot of a receipt, Apple Pay screen, bank transaction, WeChat/Alipay payment, or card charge.
2. Open the screenshot, tap Share, and run `Capture Transaction`.
3. The transaction should appear in Accountant under the **iOS Capture** account.

## Optional Shortcut: Take Photo Receipt
Use this when you want a home-screen button for paper receipts.

1. Add **Take Photo**.
2. Add **Resize Image** to max width `1280`.
3. Use the same **Get Contents of URL** setup above.

## Optional Shortcut: One-Tap Screenshot
Some iOS versions expose a **Take Screenshot** action in Shortcuts. If it is available on your phone, use it as the first action, then feed that image into the same Resize Image and Get Contents of URL steps.

If that action is unavailable, use the Share Sheet workflow above. It is still only a few taps and is more reliable across apps.

## API Response
A successful response looks like:

```json
{
  "success": true,
  "receipt": {
    "capture_type": "payment_screenshot",
    "transaction_type": "expense",
    "store_name": "Starbucks",
    "description": "Coffee purchase",
    "date": "2026-05-20",
    "total": 6.45,
    "currency": "USD",
    "payment_method": "Apple Pay"
  },
  "confidence": 0.92,
  "transaction_id": "..."
}
```

## Managing API Keys
- API keys are stored as hashes, so the app cannot show an existing key again.
- If a key is lost, generate a new one in Settings and update the Shortcut.
- If a phone or Shortcut is no longer trusted, revoke its key in Settings.
