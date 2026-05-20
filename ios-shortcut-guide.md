# Accountant App - iOS Shortcut Setup Guide

This guide explains how to set up the Apple Shortcut on your iPhone to scan receipts and automatically sync them to your Accountant app via Gemini Vision API.

## Prerequisites
1. You have a deployed version of the Accountant App (e.g. on Vercel).
2. You have created an account and retrieved your **API Key** (User ID) from the Settings page.

## Creating the Shortcut

Open the **Shortcuts** app on your iPhone and create a new Shortcut.

### Step 1: Take Photo
1. Add the **Take Photo** action.
2. Ensure it takes 1 photo with the Back camera.

### Step 2: Get File Size (Optional but recommended)
You can optionally compress the image if it's too large to save bandwidth.
- Add **Resize Image** to resize the photo to a max width of 1024.

### Step 3: Get API Endpoint URL
1. Add a **Text** action.
2. Enter your app's endpoint URL: `https://your-app-domain.com/api/receipt`

### Step 4: Get Contents of URL
1. Add the **Get Contents of URL** action.
2. Set the URL to the Text from Step 3.
3. Click "Show More" and configure as follows:
   - **Method**: `POST`
   - **Headers**: Leave empty
   - **Request Body**: `Form`
4. Add the following new fields to the Request Body:
   - Type: `File`, Key: `image`, Value: `[Resized Image or Photo]`
   - Type: `Text`, Key: `api_key`, Value: `[Paste your API Key from Settings]`
   - Type: `Text`, Key: `currency`, Value: `USD` (or `CNY` based on preference)

### Step 5: Show Result
1. Add the **Show Result** action.
2. Set it to show the `Contents of URL`. This will display the parsed receipt data (JSON) so you know it succeeded!

## Usage
Add the Shortcut to your Home Screen. Now, whenever you have a receipt:
1. Tap the Shortcut.
2. Snap a photo of the receipt.
3. The Shortcut securely sends it to your `/api/receipt` endpoint.
4. Gemini Vision parses it, stores the receipt, creates the transaction in Supabase, and logs it!
