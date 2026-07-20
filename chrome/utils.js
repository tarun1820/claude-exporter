// Shared utility functions for Claude Exporter

// Helper function to reconstruct the current branch from the message tree
function getCurrentBranch(data) {
  if (!data.chat_messages || !data.current_leaf_message_uuid) {
    return [];
  }
  
  // Create a map of UUID to message for quick lookup
  const messageMap = new Map();
  data.chat_messages.forEach(msg => {
    messageMap.set(msg.uuid, msg);
  });
  
  // Trace back from the current leaf to the root
  const branch = [];
  let currentUuid = data.current_leaf_message_uuid;
  
  while (currentUuid && messageMap.has(currentUuid)) {
    const message = messageMap.get(currentUuid);
    branch.unshift(message); // Add to beginning to maintain order
    currentUuid = message.parent_message_uuid;
    
    // Stop if we hit the root (parent UUID that doesn't exist in our messages)
    if (!messageMap.has(currentUuid)) {
      break;
    }
  }
  
  return branch;
}

// Convert to markdown format
function convertToMarkdown(data, includeMetadata, conversationId = null, includeArtifacts = true, includeThinking = true) {
  console.log('🔧 convertToMarkdown - conversationId:', conversationId, 'includeArtifacts:', includeArtifacts, 'includeThinking:', includeThinking);
  let markdown = `# ${data.name || 'Untitled Conversation'}\n\n`;

  if (includeMetadata) {
    markdown += `**Created:** ${new Date(data.created_at).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(data.updated_at).toLocaleString()}\n`;
    markdown += `**Exported:** ${new Date().toLocaleString()}\n`;
    markdown += `**Model:** ${data.model}\n`;
    if (conversationId) {
      markdown += `**Link:** [https://claude.ai/chat/${conversationId}](https://claude.ai/chat/${conversationId})\n`;
    }
    if (data.truncated !== undefined) {
      markdown += `**Truncated:** ${data.truncated}\n`;
    }
    markdown += `\n---\n\n`;
  }

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  for (const message of branchMessages) {
    const sender = message.sender === 'human' ? '## User' : '## Claude';
    markdown += `${sender}\n`;

    if (includeMetadata && message.created_at) {
      markdown += `**${new Date(message.created_at).toISOString()}**\n`;
    }
    markdown += `\n`;

    // Extract artifacts from the entire message (handles both old and new formats)
    const messageArtifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];
    if (messageArtifacts.length > 0) {
      console.log('📦 Found', messageArtifacts.length, 'artifact(s) in message:', messageArtifacts.map(a => a.title));
    }

    // Render message text (excluding tool_use and artifact tags)
    if (message.content) {
      for (const content of message.content) {
        // Handle thinking blocks (extended thinking)
        if (content.type === 'thinking' && content.thinking && includeThinking) {
          markdown += `### Thinking\n\`\`\`\`\n${content.thinking}\n\`\`\`\`\n\n`;
        }
        // Handle regular text content (skip tool_use, we handle artifacts separately)
        else if (content.type === 'text' && content.text) {
          // Remove old-format artifact tags from text
          let textWithoutArtifacts = content.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
          if (textWithoutArtifacts) {
            markdown += `${textWithoutArtifacts}\n\n`;
          }
        }
      }
    } else if (message.text) {
      // Handle old format - remove artifact tags from text
      let textWithoutArtifacts = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
      if (textWithoutArtifacts) {
        markdown += `${textWithoutArtifacts}\n\n`;
      }
    }

    // Handle attachments (file uploads and pasted content)
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.file_name) {
          // File attachment — show file metadata + extracted content if present
          let header = `### Attachment: ${attachment.file_name}`;
          const meta = [];
          if (attachment.file_size) {
            meta.push(`${(attachment.file_size / 1024).toFixed(1)} KB`);
          }
          if (attachment.file_type) {
            meta.push(attachment.file_type);
          }
          if (meta.length > 0) {
            header += ` _(${meta.join(', ')})_`;
          }
          markdown += `${header}\n`;
          if (attachment.extracted_content) {
            markdown += `\`\`\`\`\n${attachment.extracted_content}\n\`\`\`\`\n\n`;
          } else {
            markdown += `\n`;
          }
        } else if (attachment.extracted_content) {
          // Pasted content (no file_name) — legacy label
          markdown += `### Pasted\n\`\`\`\`\n${attachment.extracted_content}\n\`\`\`\`\n\n`;
        }
      }
    }

    // Render all artifacts found in the message
    for (const artifact of messageArtifacts) {
      markdown += `#### 📦 Artifact: ${artifact.title}\n`;
      markdown += `**Type:** ${artifact.type} | **Language:** ${artifact.language}\n\n`;

      if (artifact.type === 'code' || isProgrammingLanguage(artifact.language)) {
        markdown += `\`\`\`${artifact.language}\n${artifact.content}\n\`\`\`\n\n`;
      } else {
        markdown += `${artifact.content}\n\n`;
      }
    }
  }

  return markdown;
}

// Convert to plain text
function convertToText(data, includeMetadata, includeArtifacts = true, includeThinking = true) {
  let text = '';

  // Add metadata header if requested
  if (includeMetadata) {
    text += `${data.name || 'Untitled Conversation'}\n`;
    text += `Created: ${new Date(data.created_at).toLocaleString()}\n`;
    text += `Updated: ${new Date(data.updated_at).toLocaleString()}\n`;
    text += `Model: ${data.model}\n\n`;
    text += '---\n\n';
  }

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  branchMessages.forEach((message) => {
    // Extract artifacts from the entire message (handles both old and new formats)
    const artifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];

    // Get the message text (excluding artifacts)
    let messageText = '';
    let thinkingText = '';
    if (message.content) {
      for (const content of message.content) {
        // Handle thinking blocks
        if (content.type === 'thinking' && content.thinking && includeThinking) {
          const summary = content.summaries && content.summaries.length > 0
            ? content.summaries[content.summaries.length - 1].summary
            : 'Thought process';
          thinkingText += `[Thinking: ${summary}]\n${content.thinking}\n[End Thinking]\n\n`;
        }
        // Only include text content, skip tool_use
        else if (content.type === 'text' && content.text) {
          // Remove old-format artifact tags
          messageText += content.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (message.text) {
      // Handle old format - remove artifact tags
      messageText = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    messageText = messageText.trim();

    // Use full label for all messages
    let senderLabel;
    if (message.sender === 'human') {
      senderLabel = 'User';
    } else {
      senderLabel = 'Claude';
    }

    // Add thinking text if present
    if (thinkingText) {
      text += thinkingText;
    }

    text += `${senderLabel}: ${messageText}\n`;

    // Add artifacts if present
    if (artifacts.length > 0) {
      for (const artifact of artifacts) {
        text += `\n[Artifact: ${artifact.title} (${artifact.language})]\n`;
        text += `${artifact.content}\n`;
        text += `[End Artifact]\n`;
      }
    }

    // Add pasted content if present
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.extracted_content) {
          const size = attachment.file_size ? ` (${attachment.file_size} bytes)` : '';
          text += `\n[Pasted content${size}]\n`;
          text += `${attachment.extracted_content}\n`;
          text += `[End Pasted content]\n`;
        }
      }
    }

    text += `\n`;
  });

  return text.trim();
}

// Download file utility
function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Artifact Extraction Functions
// ============================================================================

// Extract artifacts from message content (supports both old and new formats)
function extractArtifactsFromMessage(message) {
  const artifacts = [];

  // Check if message has content array (new format)
  if (message.content && Array.isArray(message.content)) {
    for (const content of message.content) {
      // NEW FORMAT: tool_use with display_content.
      // Allowlist real file/artifact producers:
      //   - `artifacts` — legacy artifacts tool (still used when
      //     `enabled_artifacts_attachments` is true)
      //   - `create_file` — skills-runner MCP tool that replaced artifacts
      //     when `enabled_artifacts_attachments` is false. Same json_block
      //     display_content shape (language / code / filename).
      // bash, web_search, repl, view, list_directory, etc. are filtered out.
      if (content.type === 'tool_use' &&
          (content.name === 'artifacts' || content.name === 'create_file') &&
          content.display_content) {
        const displayContent = content.display_content;

        // Check for code_block format (newer artifact format)
        if (displayContent.type === 'code_block' && displayContent.code) {
          const language = displayContent.language || 'txt';
          const code = displayContent.code || '';
          const filename = displayContent.filename || 'artifact';

          // Extract title from filename (remove path and extension)
          const title = filename.split('/').pop().replace(/\.[^.]+$/, '');

          artifacts.push({
            title: title || 'Untitled',
            language: language,
            type: isProgrammingLanguage(language) ? 'code' : 'document',
            identifier: null,
            content: code.trim(),
          });
        }
        // Check for json_block format (older artifact format)
        else if (displayContent.type === 'json_block' && displayContent.json_block) {
          try {
            const artifactData = JSON.parse(displayContent.json_block);

            // Only treat as artifact if it has a filename (real artifacts, not tool uses like bash)
            if (artifactData.filename) {
              // Extract artifact details
              const language = artifactData.language || 'txt';
              const code = artifactData.code || '';
              const filename = artifactData.filename;

              // Extract title from filename (remove path and extension)
              const title = filename.split('/').pop().replace(/\.[^.]+$/, '');

              artifacts.push({
                title: title || 'Untitled',
                language: language,
                type: isProgrammingLanguage(language) ? 'code' : 'document',
                identifier: null,
                content: code.trim(),
              });
            }
          } catch (e) {
            // JSON parse failed, skip this artifact
            console.warn('Failed to parse artifact json_block:', e);
          }
        }
      }

      // OLD FORMAT: Check text content for <antArtifact> tags
      if (content.text) {
        const textArtifacts = extractArtifactsFromText(content.text);
        artifacts.push(...textArtifacts);
      }
    }
  }

  // Fallback: Check message.text directly (older format)
  if (message.text) {
    const textArtifacts = extractArtifactsFromText(message.text);
    artifacts.push(...textArtifacts);
  }

  return artifacts;
}

// Extract artifacts from text using regex (OLD FORMAT: <antArtifact> tags)
function extractArtifactsFromText(text) {
  const artifactRegex = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g;
  const artifacts = [];
  let match;

  while ((match = artifactRegex.exec(text)) !== null) {
    const fullTag = match[0];
    const content = match[1];

    // Extract attributes - handle both old and new formats
    const titleMatch = fullTag.match(/title="([^"]*)"/);
    const typeMatch = fullTag.match(/type="([^"]*)"/);
    const languageMatch = fullTag.match(/language="([^"]*)"/);
    const identifierMatch = fullTag.match(/identifier="([^"]*)"/);

    // Determine the artifact type and language
    let artifactType = 'text';
    let language = 'txt';

    if (typeMatch) {
      const type = typeMatch[1];
      // Map type to language/format
      if (type === 'text/html') {
        language = 'html';
        artifactType = 'code';
      } else if (type === 'text/markdown') {
        language = 'markdown';
        artifactType = 'document';
      } else if (type === 'application/vnd.ant.code') {
        language = languageMatch ? languageMatch[1] : 'txt';
        artifactType = 'code';
      } else if (type === 'text/css') {
        language = 'css';
        artifactType = 'code';
      } else if (type === 'application/vnd.ant.mermaid') {
        language = 'mermaid';
        artifactType = 'document';
      } else if (type === 'application/vnd.ant.react') {
        language = 'jsx';
        artifactType = 'code';
      } else if (type === 'image/svg+xml') {
        language = 'svg';
        artifactType = 'code';
      }
    } else if (languageMatch) {
      // Old format - just language attribute
      language = languageMatch[1];
      artifactType = 'code';
    }

    artifacts.push({
      title: titleMatch ? titleMatch[1] : 'Untitled',
      language: language,
      type: artifactType,
      identifier: identifierMatch ? identifierMatch[1] : null,
      content: content.trim(),
    });
  }

  return artifacts;
}

// Legacy function name for backward compatibility
function extractArtifacts(text) {
  return extractArtifactsFromText(text);
}

// Get file extension from language
function getFileExtension(language) {
  const languageToExt = {
    javascript: '.js',
    html: '.html',
    css: '.css',
    python: '.py',
    java: '.java',
    c: '.c',
    cpp: '.cpp',
    'c++': '.cpp',
    ruby: '.rb',
    php: '.php',
    swift: '.swift',
    go: '.go',
    rust: '.rs',
    typescript: '.ts',
    tsx: '.tsx',
    jsx: '.jsx',
    shell: '.sh',
    bash: '.sh',
    sql: '.sql',
    kotlin: '.kt',
    scala: '.scala',
    r: '.r',
    matlab: '.m',
    json: '.json',
    xml: '.xml',
    yaml: '.yaml',
    yml: '.yml',
    markdown: '.md',
    md: '.md',
    text: '.txt',
    txt: '.txt',
    latex: '.tex',
    tex: '.tex',
    bibtex: '.bib',
    bib: '.bib',
    mermaid: '.mmd',
    svg: '.svg',
    csv: '.csv',
    toml: '.toml',
    ini: '.ini',
    perl: '.pl',
    lua: '.lua',
    dart: '.dart',
    elixir: '.ex',
    erlang: '.erl',
    haskell: '.hs',
    clojure: '.clj',
    fsharp: '.fs',
    'f#': '.fs',
    'c#': '.cs',
    csharp: '.cs',
    'objective-c': '.m',
    ocaml: '.ml',
    scheme: '.scm',
    lisp: '.lisp',
    fortran: '.f90',
    assembly: '.asm',
    asm: '.asm',
    scss: '.scss',
    sass: '.sass',
    less: '.less',
    stylus: '.styl',
    dockerfile: '.dockerfile',
    makefile: '.mk',
    gradle: '.gradle',
    groovy: '.groovy',
  };
  return languageToExt[language.toLowerCase()] || '.txt';
}

// Check if a language is a programming language (should be saved in original format only)
function isProgrammingLanguage(language) {
  const programmingLanguages = [
    'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'c++', 'ruby', 'php',
    'swift', 'go', 'rust', 'jsx', 'tsx', 'shell', 'bash', 'sql', 'kotlin', 'scala',
    'r', 'perl', 'lua', 'dart', 'elixir', 'erlang', 'haskell', 'clojure', 'fsharp',
    'f#', 'c#', 'csharp', 'objective-c', 'ocaml', 'scheme', 'lisp', 'fortran',
    'assembly', 'asm', 'groovy', 'html', 'css', 'scss', 'sass', 'less', 'stylus'
  ];
  return programmingLanguages.includes(language.toLowerCase());
}

// Convert artifact content and filename based on selected format
function convertArtifactFormat(content, language, baseFilename, format) {
  // Get original extension
  const originalExtension = getFileExtension(language);

  // Keep code files and non-markdown files in original format
  if (isProgrammingLanguage(language) || originalExtension !== '.md') {
    return {
      filename: `${baseFilename}${originalExtension}`,
      content: content
    };
  }

  // For markdown documents, convert based on selected format
  switch (format) {
    case 'markdown':
    case 'original':
      // Keep as markdown
      return {
        filename: `${baseFilename}.md`,
        content: content
      };

    case 'text':
      // Convert to plain text (remove markdown formatting)
      let plainText = content;

      // Remove code blocks
      plainText = plainText.replace(/```[\s\S]*?```/g, (match) => {
        // Extract just the code content without backticks and language
        return match.replace(/```\w*\n?/, '').replace(/\n?```$/, '');
      });

      // Remove inline code
      plainText = plainText.replace(/`([^`]+)`/g, '$1');

      // Remove bold/italic
      plainText = plainText.replace(/\*\*([^*]+)\*\*/g, '$1');
      plainText = plainText.replace(/\*([^*]+)\*/g, '$1');
      plainText = plainText.replace(/__([^_]+)__/g, '$1');
      plainText = plainText.replace(/_([^_]+)_/g, '$1');

      // Remove headers (replace with just the text)
      plainText = plainText.replace(/^#{1,6}\s+(.+)$/gm, '$1');

      // Remove links but keep text
      plainText = plainText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

      // Remove images
      plainText = plainText.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

      // Remove horizontal rules
      plainText = plainText.replace(/^[-*_]{3,}$/gm, '');

      // Clean up excessive newlines
      plainText = plainText.replace(/\n{3,}/g, '\n\n');

      return {
        filename: `${baseFilename}.txt`,
        content: plainText.trim()
      };

    case 'json':
      // Convert to JSON format
      const jsonData = {
        title: baseFilename,
        language: language,
        content: content,
        format: 'markdown'
      };

      return {
        filename: `${baseFilename}.json`,
        content: JSON.stringify(jsonData, null, 2)
      };

    default:
      // Default to original format
      return {
        filename: `${baseFilename}${originalExtension}`,
        content: content
      };
  }
}

// Extract all artifacts from a conversation into separate files
function extractArtifactFiles(data, artifactFormat = 'original') {
  const artifactFiles = [];
  const usedFilenames = new Set();

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  for (const message of branchMessages) {
    const artifacts = extractArtifactsFromMessage(message);

    for (const artifact of artifacts) {
      // Generate filename from title and language
      let baseFilename = artifact.title || 'artifact';
      // Sanitize filename (remove invalid characters)
      baseFilename = baseFilename.replace(/[<>:"/\\|?*]/g, '_');

      // Convert artifact based on selected format
      const converted = convertArtifactFormat(
        artifact.content,
        artifact.language,
        baseFilename,
        artifactFormat
      );

      let filename = converted.filename;

      // Handle duplicate filenames
      let counter = 1;
      const extensionMatch = filename.match(/(\.[^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1] : '';
      const nameWithoutExt = extension ? filename.slice(0, -extension.length) : filename;

      while (usedFilenames.has(filename)) {
        filename = `${nameWithoutExt}_${counter}${extension}`;
        counter++;
      }

      usedFilenames.add(filename);

      artifactFiles.push({
        filename: filename,
        content: converted.content
      });
    }
  }

  return artifactFiles;
}
// ----- Model utilities -----

// Default model timeline for null models — each entry is when that model became the default
const DEFAULT_MODEL_TIMELINE = [
  { date: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229' },
  { date: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620' },
  { date: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022' },
  { date: new Date('2025-02-24'), model: 'claude-3-7-sonnet-20250219' },
  { date: new Date('2025-05-22'), model: 'claude-sonnet-4-20250514' },
  { date: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929' },
  { date: new Date('2026-02-17'), model: 'claude-sonnet-4-6' }
];

// Returns conversation.model if set; otherwise infers from created_at via the timeline
function inferModel(conversation) {
  if (conversation.model) {
    return conversation.model;
  }
  const conversationDate = new Date(conversation.created_at);
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (conversationDate >= DEFAULT_MODEL_TIMELINE[i].date) {
      return DEFAULT_MODEL_TIMELINE[i].model;
    }
  }
  return DEFAULT_MODEL_TIMELINE[0].model;
}

// Format a model ID like `claude-sonnet-4-5-20250929` into "Claude Sonnet 4.5".
// Schema reference: https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
// Handles three documented shapes for the sonnet/opus/haiku families:
//   - Dateless 4.6+:        claude-{name}-{major}-{minor}            (canonical snapshot)
//   - Dated pre-4.6:        claude-{name}-{major}-{minor}-{YYYYMMDD}
//   - Convenience alias:    claude-{name}-{major}-{minor}            (resolves to most recent dated snapshot)
// Unknown families (anything not in `(sonnet|opus|haiku)`) fall through to raw display.
function formatModelName(model) {
  if (!model || !model.startsWith('claude-')) {
    return model || 'Unknown';
  }

  // New format: claude-{type}-{major}[-{minor}][-{date}]
  const newFormatMatch = model.match(/^claude-(sonnet|opus|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i);
  if (newFormatMatch) {
    const [, modelType, major, minor] = newFormatMatch;
    const modelName = modelType.charAt(0).toUpperCase() + modelType.slice(1);
    const version = minor ? `${major}.${minor}` : major;
    return `Claude ${modelName} ${version}`;
  }

  // Old format: claude-{major}[-{minor}]-{type}-{date}
  const oldFormatMatch = model.match(/^claude-(\d+)(?:-(\d+))?-(sonnet|opus|haiku)-\d{8}$/i);
  if (oldFormatMatch) {
    const [, major, minor, modelType] = oldFormatMatch;
    const modelName = modelType.charAt(0).toUpperCase() + modelType.slice(1);
    const version = minor ? `${major}.${minor}` : major;
    return `Claude ${modelName} ${version}`;
  }

  return model;
}

// Returns CSS badge class name based on the model family
function getModelBadgeClass(model) {
  if (!model) return '';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return '';
}

// ----- Extension data backup / restore -----

// Download all extension storage (local + sync) as a structured JSON file.
// onComplete(success, message) reports the result so each caller can show it
// its own way (options page status line vs. browse-page toast).
function backupExtensionData(onComplete) {
  chrome.storage.local.get(null, (local) => {
    chrome.storage.sync.get(null, (sync) => {
      // Never persist the user's BYOK API keys in a backup file — they're
      // secrets, not app state, and backups are meant to be shareable/archivable.
      const localCopy = { ...(local || {}) };
      delete localCopy.bridgeApiKeyAnthropic;
      delete localCopy.bridgeApiKeyOpenAI;
      delete localCopy.bridgeApiKeyGemini;
      const backup = {
        _meta: {
          app: 'claude-exporter',
          backupVersion: 1,
          extensionVersion: chrome.runtime.getManifest().version,
          createdAt: new Date().toISOString()
        },
        local: localCopy,
        sync: sync || {}
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const hms = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      a.download = `claude-exporter-backup-${ymd}-${hms}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const snapCount = Object.keys(backup.local.modelSnapshots || {}).length;
      const exportCount = Object.keys(backup.local.exportTimestamps || {}).length;
      if (onComplete) onComplete(true, `Backup exported — ${snapCount} model snapshot(s), ${exportCount} export record(s).`);
    });
  });
}

// Conservative merge: for each top-level key in `backup`, if the key is absent
// locally, copy it over; if both sides are plain objects (UUID-keyed records
// like exportTimestamps / modelSnapshots), merge their sub-keys with local
// winning on overlap. Scalar conflicts (org ID, date format, etc.) keep the
// local value untouched.
function mergeStorageData(current, backup) {
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const result = { ...current };
  for (const [key, backupVal] of Object.entries(backup || {})) {
    if (!(key in current)) {
      result[key] = backupVal;
    } else if (isPlainObject(current[key]) && isPlainObject(backupVal)) {
      result[key] = { ...backupVal, ...current[key] };
    }
    // else: scalar conflict — current value is already in result, keep it
  }
  return result;
}

// Show a modal letting the user choose merge vs replace BEFORE the OS file
// picker opens. onConfirm(mode) fires with 'merge' / 'replace' when the user
// commits, or null on Cancel / Esc / overlay click. The caller is responsible
// for opening the file picker after a non-null mode.
function showImportModeModal(onConfirm) {
  if (!document.getElementById('claude-exporter-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'claude-exporter-modal-styles';
    style.textContent = `
      .ce-modal-overlay {
        position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
        display: flex; align-items: center; justify-content: center;
        z-index: 100000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .ce-modal {
        background: var(--bg-body, #ffffff);
        color: var(--text-primary, #2c313a);
        padding: 22px 24px;
        border-radius: 8px;
        max-width: 480px; width: 90%;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
        border: 1px solid var(--border-color, #e2e4e9);
      }
      .ce-modal h2 { margin: 0 0 14px; font-size: 17px; font-weight: 600; }
      .ce-modal-info {
        background: var(--section-bg, var(--bg-card, #f8f9fa));
        padding: 10px 12px;
        border-radius: 5px;
        margin-bottom: 14px;
        font-size: 13px;
        line-height: 1.5;
        border: 1px solid var(--border-color, #e2e4e9);
      }
      .ce-modal-option {
        display: block; padding: 10px 12px; border-radius: 5px;
        margin-bottom: 8px; cursor: pointer;
        border: 1px solid var(--border-color, #e2e4e9);
        background: var(--bg-body, #ffffff);
        font-size: 13px;
      }
      .ce-modal-option:hover { border-color: var(--primary-color, #5d44e8); }
      .ce-modal-option input { margin-right: 6px; vertical-align: middle; }
      .ce-modal-option strong { font-weight: 600; }
      .ce-modal-option-desc {
        display: block; margin: 4px 0 0 22px;
        font-size: 12px;
        color: var(--text-secondary, #666666);
      }
      .ce-modal-actions {
        display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;
      }
      .ce-modal-actions button {
        padding: 8px 16px; border-radius: 5px; border: none;
        cursor: pointer; font-size: 14px;
        display: inline-flex; align-items: center; justify-content: center;
        line-height: 1;
      }
      .ce-modal-cancel {
        background: var(--section-bg, var(--bg-card, #e9ecef));
        color: var(--text-primary, #2c313a);
        border: 1px solid var(--border-color, #e2e4e9) !important;
      }
      .ce-modal-import {
        background: var(--primary-color, #5d44e8);
        color: #ffffff;
      }
      .ce-modal-import:hover { background: var(--primary-hover, #4a35ba); }
    `;
    document.head.appendChild(style);
  }

  // Remove any stale modal before showing a new one
  const stale = document.querySelector('.ce-modal-overlay');
  if (stale) stale.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ce-modal-overlay';
  overlay.innerHTML = `
    <div class="ce-modal" role="dialog" aria-modal="true" aria-labelledby="ce-modal-title">
      <h2 id="ce-modal-title">Import Backup</h2>
      <div class="ce-modal-info">
        Choose how the imported data should be combined with your current data, then pick a backup file.
      </div>
      <label class="ce-modal-option">
        <input type="radio" name="ce-import-mode" value="merge" checked>
        <strong>Merge with current data</strong>
        <span class="ce-modal-option-desc">Adds entries not present locally; keeps your current values when they overlap.</span>
      </label>
      <label class="ce-modal-option">
        <input type="radio" name="ce-import-mode" value="replace">
        <strong>Replace all current data</strong>
        <span class="ce-modal-option-desc">Overwrites everything with this backup's contents.</span>
      </label>
      <div class="ce-modal-actions">
        <button type="button" class="ce-modal-cancel">Cancel</button>
        <button type="button" class="ce-modal-import">Choose File&hellip;</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const cleanup = (mode) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onConfirm(mode);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') cleanup(null);
    else if (e.key === 'Enter') cleanup(overlay.querySelector('input[name="ce-import-mode"]:checked').value);
  };
  document.addEventListener('keydown', onKey);

  overlay.querySelector('.ce-modal-cancel').addEventListener('click', () => cleanup(null));
  overlay.querySelector('.ce-modal-import').addEventListener('click', () => {
    cleanup(overlay.querySelector('input[name="ce-import-mode"]:checked').value);
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });

  // Focus the default radio so keyboard users can act immediately
  const firstRadio = overlay.querySelector('input[name="ce-import-mode"]');
  if (firstRadio) firstRadio.focus();
}

// Import extension storage from a file produced by backupExtensionData.
// Validates the file, then writes to local + sync using the supplied mode
// ('merge' or 'replace'). The mode choice is made BEFORE the file picker
// opens (see showImportModeModal), so this function just executes.
function importBackup(file, mode, onComplete) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let backup;
    try {
      backup = JSON.parse(e.target.result);
    } catch (err) {
      if (onComplete) onComplete(false, 'Import failed: the file is not valid JSON.');
      return;
    }

    if (!backup || typeof backup !== 'object' || !backup._meta ||
        backup._meta.app !== 'claude-exporter' || typeof backup.local !== 'object') {
      if (onComplete) onComplete(false, 'Import failed: this does not look like a Claude Exporter backup file.');
      return;
    }

    const snapCount = Object.keys(backup.local.modelSnapshots || {}).length;
    const exportCount = Object.keys(backup.local.exportTimestamps || {}).length;
    const syncData = (backup.sync && typeof backup.sync === 'object') ? backup.sync : {};

    if (mode === 'replace') {
      chrome.storage.local.set(backup.local, () => {
        chrome.storage.sync.set(syncData, () => {
          if (onComplete) onComplete(true, `Import complete (replace) — ${snapCount} model snapshot(s), ${exportCount} export record(s) restored. Reload any open Claude pages and the browse page to see the changes.`);
        });
      });
    } else {
      // Merge: missing keys added, conflicts keep local
      chrome.storage.local.get(null, (currentLocal) => {
        chrome.storage.sync.get(null, (currentSync) => {
          const mergedLocal = mergeStorageData(currentLocal || {}, backup.local);
          const mergedSync = mergeStorageData(currentSync || {}, syncData);
          chrome.storage.local.set(mergedLocal, () => {
            chrome.storage.sync.set(mergedSync, () => {
              if (onComplete) onComplete(true, `Import complete (merge) — added missing entries from backup, kept your current values on overlap. Reload any open Claude pages and the browse page to see the changes.`);
            });
          });
        });
      });
    }
  };
  reader.readAsText(file);
}

// ----- Error capture & diagnostics -----
// Captures unhandled errors and rejected promises into a ring buffer in
// chrome.storage.local. The user can later download a sanitized diagnostics
// bundle (Options page → Contact & Diagnostics) to attach to a bug report.
// Sanitization runs at capture time: any UUID-looking substring (chat / org /
// project IDs that may appear in fetch URLs or stack traces) is replaced with
// "<id>" so we never persist identifiers.

const CE_UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CE_ERROR_LOG_MAX = 50;

function sanitizeForDiagnostics(value) {
  if (typeof value !== 'string') return value;
  return value.replace(CE_UUID_REGEX, '<id>');
}

function initErrorCapture(context) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  // Re-entry guard: if our own push() throws, don't loop into the listener.
  let suppressed = false;

  const push = (entry) => {
    if (suppressed) return;
    suppressed = true;
    try {
      chrome.storage.local.get(['errorLog'], (result) => {
        try {
          const log = Array.isArray(result.errorLog) ? result.errorLog : [];
          log.push(entry);
          if (log.length > CE_ERROR_LOG_MAX) {
            log.splice(0, log.length - CE_ERROR_LOG_MAX);
          }
          chrome.storage.local.set({ errorLog: log }, () => { suppressed = false; });
        } catch (e) { suppressed = false; }
      });
    } catch (e) { suppressed = false; }
  };

  const target = (typeof globalThis !== 'undefined') ? globalThis : self;

  target.addEventListener('error', (event) => {
    push({
      ts: new Date().toISOString(),
      level: 'error',
      context,
      msg: sanitizeForDiagnostics(String(event.message || '')),
      source: event.filename ? sanitizeForDiagnostics(String(event.filename)) : null,
      line: event.lineno || null,
      col: event.colno || null,
      stack: event.error && event.error.stack ? sanitizeForDiagnostics(String(event.error.stack)) : null
    });
  });

  target.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason && reason.message ? String(reason.message)
              : (reason !== undefined ? String(reason) : '(no reason)');
    push({
      ts: new Date().toISOString(),
      level: 'unhandledrejection',
      context,
      msg: sanitizeForDiagnostics(msg),
      stack: reason && reason.stack ? sanitizeForDiagnostics(String(reason.stack)) : null
    });
  });
}

// Build a sanitized diagnostics bundle and trigger a download. Callers may
// pass an onComplete(success, message) callback for status reporting.
function generateDiagnostics(onComplete) {
  const manifest = chrome.runtime.getManifest();

  chrome.storage.local.get(
    ['errorLog', 'modelSnapshots', 'exportTimestamps', 'dateFormat', 'timeFormat', 'modelDisplay'],
    (local) => {
      chrome.storage.sync.get(['organizationId'], (sync) => {
        const errorLog = Array.isArray(local.errorLog) ? local.errorLog : [];
        const diagnostics = {
          _meta: {
            app: 'claude-exporter',
            diagnosticsVersion: 1,
            generatedAt: new Date().toISOString()
          },
          extension: {
            name: manifest.name,
            version: manifest.version
          },
          environment: {
            userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
            platform: (typeof navigator !== 'undefined' && navigator.platform) || null,
            language: (typeof navigator !== 'undefined' && navigator.language) || null
          },
          preferences: {
            dateFormat: local.dateFormat || 'mdy',
            timeFormat: local.timeFormat || '12h',
            modelDisplay: local.modelDisplay === 'current' ? 'current' : 'original',
            orgIdConfigured: !!(sync && sync.organizationId)
          },
          counts: {
            modelSnapshots: Object.keys(local.modelSnapshots || {}).length,
            exportTimestamps: Object.keys(local.exportTimestamps || {}).length,
            errors: errorLog.length
          },
          errors: errorLog
        };

        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const hms = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

        const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `claude-exporter-diagnostics-${ymd}-${hms}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (onComplete) {
          onComplete(true, `Diagnostics downloaded — ${errorLog.length} error(s) captured, all IDs redacted.`);
        }
      });
    }
  );
}

// ============================================================================
// AI Conversation Bridge
// ============================================================================
// Distills a conversation into a compact handoff package (objectives,
// completed/pending work, decisions, preferences, code/files) so it can be
// pasted into a different LLM and continued from where Claude left off.
// Tier 1 (extractBridgeContext) is rule-based and runs entirely offline.
// Tier 2 (refineBridgeContextWithAI) is an optional BYOK call to Anthropic's
// Messages API that refines the Tier 1 pass — see bridge.js for the toggle.

const CE_BRIDGE_MODES = ['coding', 'research', 'writing', 'brainstorming'];

const CE_GOAL_PATTERNS = [/\bi want to\b/i, /\blet'?s build\b/i, /\bhelp me\b/i, /\bi need\b/i, /\bcan you\b/i, /\bi'?m trying to\b/i];
const CE_DECISION_PATTERNS = [/\bwe decided\b/i, /\bi'?ll use\b/i, /\blet'?s go with\b/i, /\binstead of\b/i, /\bdecided to\b/i, /\bgoing with\b/i];
const CE_PENDING_PATTERNS = [/\bnext steps?\b/i, /\bstill need(s)? to\b/i, /\btodo\b/i, /\bnot yet done\b/i, /\bremaining\b/i, /\btbd\b/i];
const CE_PREFERENCE_PATTERNS = [/\balways\b/i, /\bnever\b/i, /\bplease avoid\b/i, /\bmy preference is\b/i, /\bprefer\b/i, /\bdon'?t\b/i];

// Pull the text (excluding old-format artifact tags) out of a single message.
function ceGetMessageText(message) {
  let text = '';
  if (message.content && Array.isArray(message.content)) {
    for (const content of message.content) {
      if (content.type === 'text' && content.text) {
        text += content.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
      }
    }
  } else if (message.text) {
    text += message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
  }
  return text.trim();
}

// Split text into sentence-ish chunks for heuristic scanning.
function ceSplitSentences(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

function ceMatchesAny(sentence, patterns) {
  return patterns.some(p => p.test(sentence));
}

// Tier 1: rule-based, synchronous, no network. Returns a plain object shaped
// identically to what refineBridgeContextWithAI produces, so rendering code
// never needs to know which tier ran.
function extractBridgeContext(data, mode = 'coding') {
  if (!CE_BRIDGE_MODES.includes(mode)) mode = 'coding';

  const branchMessages = getCurrentBranch(data);
  const objectives = [];
  const decisions = [];
  const pendingWork = [];
  const preferences = [];
  const completedTasks = [];
  const seen = new Set();

  const addUnique = (list, text) => {
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      list.push(text);
    }
  };

  branchMessages.forEach((message, index) => {
    const text = ceGetMessageText(message);
    if (!text) return;
    const isHuman = message.sender === 'human';

    if (isHuman && index === 0) {
      addUnique(objectives, text.length > 400 ? text.slice(0, 400) + '…' : text);
    }

    for (const sentence of ceSplitSentences(text)) {
      if (isHuman && ceMatchesAny(sentence, CE_GOAL_PATTERNS)) addUnique(objectives, sentence);
      if (ceMatchesAny(sentence, CE_DECISION_PATTERNS)) addUnique(decisions, sentence);
      if (ceMatchesAny(sentence, CE_PENDING_PATTERNS)) addUnique(pendingWork, sentence);
      if (isHuman && ceMatchesAny(sentence, CE_PREFERENCE_PATTERNS)) addUnique(preferences, sentence);
    }
  });

  // "Where we left off" — the last assistant message closes out the pending
  // work list so the new LLM knows the actual conversational tail, not just
  // sentences that happened to match a TODO-shaped pattern.
  const lastAssistantMessage = [...branchMessages].reverse().find(m => m.sender !== 'human');
  if (lastAssistantMessage) {
    const tailText = ceGetMessageText(lastAssistantMessage);
    if (tailText) {
      const tail = tailText.length > 600 ? tailText.slice(0, 600) + '…' : tailText;
      addUnique(pendingWork, `[Where we left off] ${tail}`);
    }
  }

  // Completed work: assistant messages that aren't the tail, summarized by
  // first sentence — a lightweight signal of what's already been done.
  branchMessages.forEach((message) => {
    if (message.sender === 'human' || message === lastAssistantMessage) return;
    const text = ceGetMessageText(message);
    if (!text) return;
    const firstSentence = ceSplitSentences(text)[0];
    if (firstSentence) addUnique(completedTasks, firstSentence);
  });

  const files = extractArtifactFiles(data, 'original');
  const codeSnippets = [];
  branchMessages.forEach(message => {
    for (const artifact of extractArtifactsFromMessage(message)) {
      codeSnippets.push({ title: artifact.title, language: artifact.language, content: artifact.content });
    }
  });

  return {
    objectives,
    completedTasks: completedTasks.slice(0, 20),
    pendingWork,
    decisions,
    preferences,
    codeSnippets,
    files,
    mode,
    sourceModel: data.model || 'unknown',
    sourceTitle: data.name || 'Untitled Conversation',
    messageCount: branchMessages.length,
  };
}

// Supported AI providers for Tier 2 refinement, each BYOK — the user's own
// key for whichever provider they pick, never transmitted anywhere but that
// provider's own API host. Default models are a best-effort pick as of this
// writing; providers retire/rename models over time, so these may need a
// quick bump later the same way the original Anthropic default did.
const CE_PROVIDER_DEFAULTS = {
  anthropic: { model: 'claude-haiku-4-5-20251001' },
  openai: { model: 'gpt-4o-mini' },
  gemini: { model: 'gemini-2.0-flash' },
};

// Build the fetch(url, options) pair for one provider's chat/generation
// endpoint. Each provider has its own auth scheme (header vs query param)
// and request shape, but all three take the same systemPrompt/userPrompt.
function ceBuildProviderRequest(provider, apiKey, model, systemPrompt, userPrompt) {
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      },
    };
  }

  if (provider === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        }),
      },
    };
  }

  // Default: Anthropic
  return {
    url: 'https://api.anthropic.com/v1/messages',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    },
  };
}

// Pull the generated text out of each provider's differently-shaped response.
function ceExtractProviderText(provider, result) {
  if (provider === 'openai') {
    return result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
  }
  if (provider === 'gemini') {
    const candidate = result.candidates && result.candidates[0];
    const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
    return part && part.text;
  }
  const textBlock = (result.content || []).find(b => b.type === 'text');
  return textBlock && textBlock.text;
}

// Tier 2: async, network. Sends the Tier-1 pass plus condensed branch text to
// the user's chosen AI provider (Anthropic, OpenAI, or Gemini — BYOK) and
// asks it to return a refined JSON object in the same shape. Must be called
// from an extension page context (not a claude.ai content script — the
// page's CSP would block the cross-origin call).
async function refineBridgeContextWithAI(bridgeContext, rawBranchText, { provider = 'anthropic', apiKey, model } = {}, mode = 'coding') {
  const resolvedModel = model || (CE_PROVIDER_DEFAULTS[provider] || CE_PROVIDER_DEFAULTS.anthropic).model;

  const MAX_BRANCH_CHARS = 12000;
  const condensed = rawBranchText.length > MAX_BRANCH_CHARS
    ? rawBranchText.slice(0, MAX_BRANCH_CHARS) + '\n…(truncated)'
    : rawBranchText;

  const schemaHint = `{
  "objectives": ["..."],
  "completedTasks": ["..."],
  "pendingWork": ["..."],
  "decisions": ["..."],
  "preferences": ["..."],
  "codeSnippets": [{"title": "...", "language": "...", "content": "..."}],
  "files": [{"filename": "...", "content": "..."}]
}`;

  const systemPrompt = `You are extracting a handoff context package from a conversation with an AI assistant, so the conversation can continue in a different LLM. Mode: ${mode}. Respond with ONLY a JSON object matching this shape (omit keys with no content, use empty arrays if nothing applies):\n${schemaHint}`;

  const userPrompt = `Here is a rule-based first pass at the extraction:\n${JSON.stringify({
    objectives: bridgeContext.objectives,
    completedTasks: bridgeContext.completedTasks,
    pendingWork: bridgeContext.pendingWork,
    decisions: bridgeContext.decisions,
    preferences: bridgeContext.preferences,
  }, null, 2)}\n\nHere is the conversation transcript to refine it against:\n${condensed}\n\nReturn the refined JSON object only.`;

  const { url, options } = ceBuildProviderRequest(provider, apiKey, resolvedModel, systemPrompt, userPrompt);
  const response = await fetch(url, options);

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`${provider} API request failed: ${response.status} ${errBody}`.trim());
  }

  const result = await response.json();
  const text = ceExtractProviderText(provider, result);
  if (!text) {
    throw new Error(`${provider} API returned no text content to parse.`);
  }

  let refined;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    refined = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch (e) {
    throw new Error('Failed to parse the AI-refined bridge context as JSON.');
  }

  return {
    objectives: refined.objectives || bridgeContext.objectives,
    completedTasks: refined.completedTasks || bridgeContext.completedTasks,
    pendingWork: refined.pendingWork || bridgeContext.pendingWork,
    decisions: refined.decisions || bridgeContext.decisions,
    preferences: refined.preferences || bridgeContext.preferences,
    codeSnippets: (refined.codeSnippets && refined.codeSnippets.length) ? refined.codeSnippets : bridgeContext.codeSnippets,
    files: bridgeContext.files,
    mode: bridgeContext.mode,
    sourceModel: bridgeContext.sourceModel,
    sourceTitle: bridgeContext.sourceTitle,
    messageCount: bridgeContext.messageCount,
  };
}

// Section ordering per transfer mode — earlier sections are emphasized first
// in the rendered Markdown prompt.
const CE_BRIDGE_MODE_ORDER = {
  coding: ['files', 'codeSnippets', 'objectives', 'decisions', 'pendingWork', 'completedTasks', 'preferences'],
  research: ['objectives', 'decisions', 'completedTasks', 'pendingWork', 'files', 'codeSnippets', 'preferences'],
  writing: ['objectives', 'preferences', 'decisions', 'completedTasks', 'pendingWork', 'files', 'codeSnippets'],
  brainstorming: ['objectives', 'decisions', 'pendingWork', 'completedTasks', 'preferences', 'files', 'codeSnippets'],
};

const CE_BRIDGE_SECTION_TITLES = {
  objectives: 'Objectives',
  completedTasks: 'Completed Work',
  pendingWork: 'Pending Work / Where We Left Off',
  decisions: 'Key Decisions',
  preferences: 'User Preferences',
  codeSnippets: 'Code Snippets',
  files: 'Files',
};

// Render the ready-to-paste Markdown handoff prompt.
function generateBridgeMarkdown(bridgeContext) {
  const order = CE_BRIDGE_MODE_ORDER[bridgeContext.mode] || CE_BRIDGE_MODE_ORDER.coding;
  let md = `# Conversation Handoff: ${bridgeContext.sourceTitle}\n\n`;
  md += `You are continuing a conversation that started with Claude (${bridgeContext.sourceModel}). `;
  md += `Below is the distilled context — objectives, decisions, pending work, and any code/files — so you can pick up exactly where it left off.\n\n`;

  for (const key of order) {
    const value = bridgeContext[key];
    if (!value || value.length === 0) continue;
    md += `## ${CE_BRIDGE_SECTION_TITLES[key]}\n\n`;

    if (key === 'codeSnippets') {
      for (const snippet of value) {
        md += `### ${snippet.title}\n\`\`\`${snippet.language}\n${snippet.content}\n\`\`\`\n\n`;
      }
    } else if (key === 'files') {
      for (const file of value) {
        md += `### ${file.filename}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
      }
    } else {
      for (const item of value) {
        md += `- ${item}\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\nPlease continue this conversation from the "Pending Work / Where We Left Off" section above.\n`;
  return md;
}

// Render the structured JSON handoff package.
function generateBridgeJSON(bridgeContext) {
  return {
    _meta: {
      app: 'claude-exporter',
      bridgeVersion: 1,
      mode: bridgeContext.mode,
      sourceModel: bridgeContext.sourceModel,
      sourceTitle: bridgeContext.sourceTitle,
      createdAt: new Date().toISOString(),
    },
    objectives: bridgeContext.objectives,
    completedTasks: bridgeContext.completedTasks,
    pendingWork: bridgeContext.pendingWork,
    decisions: bridgeContext.decisions,
    preferences: bridgeContext.preferences,
    codeSnippets: bridgeContext.codeSnippets,
    files: bridgeContext.files,
  };
}

// Functions are available globally in the browser context
// In Node (vitest), expose them via module.exports for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getCurrentBranch,
    convertToMarkdown,
    convertToText,
    downloadFile,
    extractArtifactsFromMessage,
    extractArtifactsFromText,
    extractArtifacts,
    getFileExtension,
    isProgrammingLanguage,
    convertArtifactFormat,
    extractArtifactFiles,
    DEFAULT_MODEL_TIMELINE,
    inferModel,
    formatModelName,
    getModelBadgeClass,
    backupExtensionData,
    importBackup,
    mergeStorageData,
    sanitizeForDiagnostics,
    extractBridgeContext,
    refineBridgeContextWithAI,
    generateBridgeMarkdown,
    generateBridgeJSON,
  };
}
