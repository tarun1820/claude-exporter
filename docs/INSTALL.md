# Installation Guide

Complete installation instructions for Claude Exporter on Chrome.

## Install from Browser Store (Recommended)

The simplest way to install Claude Exporter and receive automatic updates:

- **Chrome/Chromium-based browsers:** [Chrome Web Store](https://chromewebstore.google.com/detail/claude-exporter/niicpkfpebcmikhdmmjnlamoljlabkni?hl=en)

After installing, proceed to [Configuration](#configuration).

---

## Install from Releases (.zip)

For users who want to install manually without the Chrome Web Store.

1. Download the `claude-exporter-chrome-vX.X.X.zip` from the [Releases page](https://github.com/agoramachina/claude-exporter/releases)
2. Extract the zip into a safe folder (this will be the permanent location - don't move or delete it!)
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable **Developer mode** (toggle in top right)
5. Click **Load unpacked** and select the extracted `claude-exporter-chrome` folder
6. Done! Proceed to [Configuration](#configuration)

---

## Install from Source

For developers or those who want to build from source:

### Prerequisites
- Google Chrome browser (or Chromium-based browser like Edge, Brave, etc.)
- Git (optional, for cloning)
- A Claude.ai account

### Steps

1. **Clone or Download the Repository**
   ```bash
   git clone https://github.com/agoramachina/claude-exporter.git
   cd claude-exporter
   ```

2. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/`
   - Or click the three dots menu → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top right corner

4. **Load the Extension**
   - Click "Load unpacked"
   - Select the `chrome` folder (inside the repository)
   - The extension icon should appear in your toolbar

5. **Proceed to [Configuration](#configuration)**

---

## Configuration

After installing the extension:

1. Click the extension icon in your browser toolbar
2. You'll see a notice about configuring your Organization ID
3. Click "Click here to set it up" (or right-click the extension icon → Options)
4. In a new tab, go to `https://claude.ai/settings/account`
5. Copy your Organization ID from the URL
   - It looks like: `organization_id=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - Copy only the UUID part (the `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
6. Return to the extension options and paste the Organization ID
7. Click **Save**
8. Click **Test Connection** to verify it works
9. You should see a success message if everything is configured correctly!

### Optional: AI Conversation Bridge API key

The Bridge's rule-based extraction works with no setup. To enable AI-enhanced extraction:

1. Open the extension options page
2. Under **AI Conversation Bridge**, pick your provider (Anthropic, OpenAI, or Google Gemini) and paste the matching API key
3. Click **Save Bridge Settings**

Each key is stored only in this browser (never synced), sent only to that provider's own API, and only used when you explicitly toggle "AI-enhanced extraction" on in the Bridge page. All keys are excluded from backup and diagnostics exports.

---

## Troubleshooting

#### "Organization ID not configured"
- Follow the [Configuration](#configuration) steps above
- Make sure you're copying the complete UUID from the URL
- The format should be: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

#### "Not authenticated" error
- Make sure you're logged into Claude.ai
- Try refreshing the Claude.ai page
- Check that cookies are enabled for claude.ai

#### "downloadFile is not defined" error
If you see this error when trying to export the current conversation:
1. **Refresh the Claude.ai page** (F5 or Ctrl+R)
2. Try the export again
3. This happens when the content script hasn't fully loaded yet

#### Export fails for some conversations
- Some very old conversations might have different data structures
- Check the browser console for specific error messages
- The ZIP export includes a summary file listing any failed exports

#### Extension doesn't appear after loading
- Make sure you selected the `chrome` folder, not a subfolder
- Check that Developer mode is enabled
- Look in the Extensions page for any error messages

#### Content Security Policy errors
- Make sure you're using the latest version of the extension
- Try removing and re-adding the extension from `chrome://extensions/`

#### AI-enhanced Bridge extraction fails
- Confirm the API key is saved in Options (Save Bridge Settings, not just typed in)
- Check the browser console on the Bridge tab for the specific `api.anthropic.com` error (invalid key, rate limit, etc.)
- The rule-based (non-AI) extraction still works even if the AI-enhanced pass fails

---

## Additional Resources

- [Chrome Extension Developer Guide](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Documentation](https://developer.chrome.com/docs/extensions/mv3/intro/)

---

## Getting Help

If you encounter issues:

1. Check the browser console for errors (Right-click on page → Inspect → Console tab)
2. Verify you're using the correct folder (`chrome/`)
3. Make sure Chrome is up to date
4. Check the [Troubleshooting](#troubleshooting) section above
5. Open an issue on GitHub with:
   - Chrome version
   - Error messages from console
   - Steps to reproduce the problem

---

**Note**: This extension is not officially affiliated with Anthropic or Claude.ai. It's a community tool that uses the web interface's API endpoints.
