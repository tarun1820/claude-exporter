# Claude Exporter

A Chrome extension that lets you export your Claude.ai conversations and artifacts in various formats, bridge a conversation to a different LLM, and browse/search your full conversation history.

## Features

- 📥 **Export Individual Conversations** - Export any conversation directly from Claude.ai
- 📚 **Bulk Export** - Export all or filtered conversations as a ZIP file
- 🔍 **Browse & Search** - View all your conversations in a searchable table
- 🔀 **Sort Conversations** - Sort by name, date, project, model, and more
- 🌳 **Branch-Aware Export** - Correctly handles conversation branches
- 📝 **Multiple Formats** - JSON (full data), Markdown, or Plain Text
- 📦 **Artifact Export** - Extract artifacts (code, documents, etc.) as separate files
- 🎯 **Flexible Export Options** - Choose to include conversations, artifacts inline, or artifacts as separate files
- 🗂️ **ZIP Archives** - Bulk exports create organized ZIP files with conversations and artifacts
- 🏷️ **Metadata Options** - Include or exclude timestamps, models, and other metadata
- 🤖 **Complete Model Information** - Preserves and displays model information for all conversations
- 🔮 **Smart Model Inference** - Automatically infers the correct model for conversations that used the default model at the time
- 🌉 **AI Conversation Bridge** - Distill a conversation into objectives, decisions, pending work, preferences, and code/files, then hand it off to a different LLM (ChatGPT, Gemini, another Claude chat) as a ready-to-paste prompt or JSON package — instead of dumping the raw transcript
- 🔒 **Secure** - All data processing happens in your browser and is never sent anywhere (the Bridge's optional AI-enhanced mode is opt-in and BYOK — see below)
- ☀️ **Light/Dark Mode** - Toggle between color schemes

---
### Installation

See [docs/INSTALL.md](docs/INSTALL.md) for installation instructions (Chrome Web Store, manual, and from source).

---
### Usage

#### Export Current Conversation
1. Navigate to any conversation on claude.ai
2. Click the extension icon
3. Choose your export format and metadata preferences
4. Click "Export Current Conversation"

#### Bridge a Conversation to Another AI
1. Navigate to any conversation on claude.ai
2. Click the extension icon, then **"Bridge to Another AI"** (or use the **Bridge** row action from the Browse page)
3. A new tab opens with the distilled context — objectives, decisions, pending work, preferences, and code/files — grouped by transfer mode (Coding / Research / Writing / Brainstorming)
4. Edit any section if needed, then **Copy Markdown Prompt** (paste straight into ChatGPT/Gemini/another Claude chat) or download as Markdown/JSON
5. Optional: pick a provider (Anthropic, OpenAI, or Google Gemini) and add your own API key for it in Options to enable **AI-enhanced extraction**, which refines the heuristic pass with a real model call. The key is stored only on this device, sent only to that provider's own API, and only used when you explicitly toggle it on
6. From the Browse page, use **Bridge Filtered** to merge every currently-filtered conversation (e.g. a project search) into one combined bridge package

#### Browse All Conversations
1. Click the extension icon
2. Click "Browse All Conversations" (green button)
3. In the browse page, you can:
   - Search conversations by name
   - Filter by model
   - Sort by date or name
   - Export individual conversations
   - Bridge individual or filtered conversations to another AI
   - Export all filtered conversations as ZIP

#### Bulk Export
1. In the browse page, select your format and filters
2. Click "Export All"
3. A progress dialog will show the export status
4. Once complete, a ZIP file will download containing all conversations

---
### Export Formats

#### JSON
- Complete data including all branches and metadata
- Best for data preservation and programmatic use
- Includes all message versions and conversation branches

#### Markdown
- Human-readable format with formatting
- Shows only the current conversation branch
- Includes optional metadata (timestamps, model info)
- Great for documentation or sharing

#### Plain Text
- Simple format following Claude's prompt style
- Uses "User:" and "Claude:" prefixes
- Shows only the current conversation branch
- Ideal for copying into other LLMs or text editors

#### AI Conversation Bridge (Markdown prompt / JSON package)
- Distilled handoff context instead of the raw transcript: objectives, decisions, pending work, preferences, and code/files
- Markdown output is a ready-to-paste prompt for a different LLM; JSON output is a structured, versioned package (`_meta.bridgeVersion`) for archival or programmatic use
- Works fully offline by default (rule-based extraction); optionally refined via your own API key for Anthropic, OpenAI, or Google Gemini

---
### Troubleshooting

#### "Organization ID not configured"
- Follow the setup steps in [docs/INSTALL.md](docs/INSTALL.md#configuration)
- Make sure you're copying the complete UUID from the URL

#### "Not authenticated" error
- Make sure you're logged into Claude.ai
- Try refreshing the Claude.ai page

#### Export fails for some conversations
- Some very old conversations might have different data structures
- Check the browser console for specific error messages
- The ZIP export includes a summary file listing any failed exports

#### Content Security Policy errors
- Make sure you're using the latest version of the extension
- Try reloading the extension from chrome://extensions/

**For more troubleshooting**, see [docs/INSTALL.md](docs/INSTALL.md#troubleshooting)

---
### Known Limitations

- Rate limiting: The extension processes conversations in small batches to avoid overwhelming the API
- Using a VPN may return a 403 error when trying to connect to the Claude API
- Plaintext and markdown formats only export the currently selected branch in conversations with multiple branches
- Large bulk exports may take several minutes
- Some special content types (like artifacts) may not export perfectly
- API does not preserve per-message model data
  - `conversation.model` from the API is the *current* model only — when chats get bounced (deprecation, guardrails kicking to Sonnet 4, etc.) the original model is lost
- The Bridge's rule-based extraction uses English-language regex heuristics — non-English conversations or unusual phrasing may extract less accurately without the AI-enhanced pass

---
### Privacy & Security

- **Local Processing**: All data processing happens in your browser
- **No External Servers**: The extension doesn't send data anywhere, except the AI Conversation Bridge's optional AI-enhanced mode, which sends conversation context to your chosen provider's API (Anthropic, OpenAI, or Google Gemini) using your own API key — only when you explicitly enable it
- **Your Authentication**: Uses your existing Claude.ai session
- **Open Source**: You can review all code before installation

---
### Contributing

Feel free to submit issues or pull requests if you find bugs or have suggestions for improvements!

---
### Acknowledgments

- **Original Project**: Forked from [socketteer/Claude-Conversation-Exporter](https://github.com/socketteer/Claude-Conversation-Exporter)
- **Built by**: Prompt & Pray
- **Code Development**: Written in collaboration with Claude Code (Sonnet 4.5 and Opus 4.5, 4.6, 4.7)
- **ZIP Library**: Uses [JSZip](https://stuk.github.io/jszip/) for creating ZIP archives

---

**Note**: This extension is not officially affiliated with Anthropic or Claude.ai. It's a community tool that uses the web interface's API endpoints.
