// Prevent double-injection of content script
if (window.claudeExporterContentScriptLoaded) {
  console.log('Claude Exporter content script already loaded, skipping re-injection');
} else {
  window.claudeExporterContentScriptLoaded = true;

// Capture unhandled errors for diagnostics (sanitized, stored in chrome.storage.local)
if (typeof initErrorCapture === 'function') initErrorCapture('content');

// Note: Organization ID is now stored in extension settings
// Users need to configure it in the extension options page

// Record export timestamp for a conversation
function recordExportTimestamp(conversationId) {
  chrome.storage.local.get(['exportTimestamps'], (result) => {
    const timestamps = result.exportTimestamps || {};
    timestamps[conversationId] = new Date().toISOString();
    chrome.storage.local.set({ exportTimestamps: timestamps });
  });
}

// Record export timestamps for multiple conversations
function recordExportTimestamps(conversationIds) {
  chrome.storage.local.get(['exportTimestamps'], (result) => {
    const timestamps = result.exportTimestamps || {};
    const now = new Date().toISOString();
    for (const id of conversationIds) {
      timestamps[id] = now;
    }
    chrome.storage.local.set({ exportTimestamps: timestamps });
  });
}

// Snapshot each conversation's current model so it survives a model bounce
// (e.g. when a model retires and Claude silently moves old chats onto a new
// one). Only the raw API model is recorded — never an inferred guess.
function recordModelSnapshots(conversations) {
  if (!Array.isArray(conversations)) return;
  chrome.storage.local.get(['modelSnapshots'], (result) => {
    const snapshots = result.modelSnapshots || {};
    const now = new Date().toISOString();
    let changed = false;
    for (const conv of conversations) {
      const model = conv && conv.model;
      const id = conv && conv.uuid;
      if (!model || !id) continue; // skip null-model chats — don't snapshot a guess
      const existing = snapshots[id];
      if (!existing) {
        snapshots[id] = {
          firstSeen: model,
          firstSeenAt: now,
          current: model,
          currentAt: now,
          history: [{ model, at: now }]
        };
        changed = true;
      } else if (existing.current !== model) {
        existing.current = model;
        existing.currentAt = now;
        existing.history = existing.history || [];
        existing.history.push({ model, at: now });
        changed = true;
      }
    }
    if (changed) {
      chrome.storage.local.set({ modelSnapshots: snapshots });
    }
  });
}

// Helper function to format datetime in local time for filenames
function getLocalDateTimeString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

  // Fetch conversation data
  async function fetchConversation(orgId, conversationId) {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`;

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      const error = new Error(`Failed to fetch conversation: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return await response.json();
  }

  // Fetch an uploaded image's binary content. previewUrl is a relative path
  // (e.g. /api/{orgId}/files/{fileUuid}/preview) returned by the conversation
  // API — resolve it against claude.ai and read it as a Blob (JSZip accepts
  // Blobs directly) rather than JSON, since this is the one binary fetch in
  // an otherwise all-JSON codebase.
  async function fetchImageBlob(previewUrl) {
    const response = await fetch(`https://claude.ai${previewUrl}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    return await response.blob();
  }

  // Fetch every chat_conversations page for one org, following pagination via
  // limit/offset. Some accounts only ever see the API's default page (~14
  // items) because the endpoint was previously called with no params at all.
  // Guarded so a wrong param name (this API is undocumented) can't regress
  // below today's single-page behavior or loop forever: stop as soon as a
  // page comes back shorter than the requested limit, or repeats the same
  // leading UUID as the previous page (a sign the params were ignored).
  async function fetchAllConversations(orgId) {
    const limit = 100;
    let offset = 0;
    let all = [];
    let previousFirstUuid = null;

    for (let page = 0; page < 50; page++) {
      const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}`;

      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        }
      });

      if (!response.ok) {
        const error = new Error(`Failed to fetch conversations: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const pageConversations = await response.json();
      if (!Array.isArray(pageConversations) || pageConversations.length === 0) break;

      const firstUuid = pageConversations[0].uuid;
      if (firstUuid && firstUuid === previousFirstUuid) {
        // Same leading conversation as last time — the API ignored our
        // limit/offset params. Stop here rather than looping forever.
        break;
      }
      previousFirstUuid = firstUuid;

      all = all.concat(pageConversations);

      if (pageConversations.length < limit) break; // last page
      offset += limit;
    }

    recordModelSnapshots(all); // capture current models before any bounce
    return all;
  }

  // List every organization this account can chat in. Falls back to every
  // org (not just chat-capable ones) if none report 'chat' capability, same
  // fallback the original single-org detectOrgId used.
  async function fetchChatCapableOrgs() {
    const response = await fetch('https://claude.ai/api/organizations', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch organizations: ${response.status}`);
    }

    const orgs = await response.json();
    if (!Array.isArray(orgs) || orgs.length === 0) {
      throw new Error('No organizations found');
    }

    const chatOrgs = orgs.filter(org => org.capabilities && org.capabilities.includes('chat'));
    return chatOrgs.length > 0 ? chatOrgs : orgs;
  }

  // Fetch conversations across every organization the account belongs to —
  // accounts with more than one org (e.g. a personal account plus a Team
  // workspace) otherwise only ever see whichever org auto-detect happens to
  // pick first. Each conversation is tagged with the org it came from so
  // later per-conversation actions (export, bridge) know which org to use.
  async function fetchAllConversationsAllOrgs() {
    const orgs = await fetchChatCapableOrgs();
    const merged = [];
    const seen = new Set();

    for (const org of orgs) {
      let conversations;
      try {
        conversations = await fetchAllConversations(org.uuid);
      } catch (error) {
        console.warn(`Skipping org ${org.uuid} while listing conversations:`, error.message);
        continue;
      }
      for (const conv of conversations) {
        if (seen.has(conv.uuid)) continue;
        seen.add(conv.uuid);
        conv._orgId = org.uuid;
        merged.push(conv);
      }
    }

    return merged;
  }

  // Fetch a single conversation, trying the preferred org first (the fast
  // path — no extra requests for single-org accounts) and falling back to
  // every other chat-capable org on a 404 (the preferred org simply doesn't
  // have this conversation, most often because the account belongs to more
  // than one org). Returns { data, orgId } so callers can remember whichever
  // org actually worked.
  async function fetchConversationAnyOrg(preferredOrgId, conversationId) {
    if (preferredOrgId) {
      try {
        const data = await fetchConversation(preferredOrgId, conversationId);
        return { data, orgId: preferredOrgId };
      } catch (error) {
        if (error.status !== 404) throw error;
        console.log(`Conversation not found in org ${preferredOrgId}, trying other organizations...`);
      }
    }

    const orgs = await fetchChatCapableOrgs();
    let lastError = null;
    for (const org of orgs) {
      if (org.uuid === preferredOrgId) continue;
      try {
        const data = await fetchConversation(org.uuid, conversationId);
        return { data, orgId: org.uuid };
      } catch (error) {
        lastError = error;
        if (error.status !== 404) throw error;
      }
    }

    throw lastError || new Error('Conversation not found in any organization.');
  }
  // Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Auto-detect organization ID from Claude.ai API
  if (request.action === 'detectOrgId') {
    console.log('Auto-detecting organization ID...');

    fetchChatCapableOrgs()
      .then(orgs => {
        // Picking orgs[0] here is just a starting-point guess for accounts
        // with multiple chat-capable orgs — fetchConversationAnyOrg and
        // fetchAllConversationsAllOrgs are what actually cover every org, so
        // a wrong first guess here no longer causes a 404 or a truncated list.
        const orgId = orgs[0].uuid;
        console.log('Auto-detected organization ID:', orgId, orgs.length > 1 ? `(1 of ${orgs.length} chat-capable orgs)` : '');
        sendResponse({ success: true, orgId });
      })
      .catch(error => {
        console.error('Auto-detect org ID failed:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }

  if (request.action === 'exportConversation') {
    console.log('Export conversation request received:', request);

    let resolvedOrgId = request.orgId;
    fetchConversationAnyOrg(request.orgId, request.conversationId)
      .then(async ({ data, orgId }) => {
        resolvedOrgId = orgId;
        console.log('Conversation data fetched successfully:', data);

        // Validate conversation data structure
        if (!data || !data.chat_messages || !Array.isArray(data.chat_messages)) {
          throw new Error('Invalid conversation data structure. Please refresh the page and try again.');
        }

        // Infer model if null
        data.model = inferModel(data);

        // Uploaded images (message.files, distinct from artifacts/attachments)
        // — always fetched when present, since a conversation file plus
        // image(s) is multi-file and must be ZIPped per project convention,
        // even if no artifact-extraction checkbox was checked.
        const imageFiles = extractImageFiles(data);
        const fetchedImages = imageFiles.length > 0
          ? (await Promise.all(imageFiles.map(async (img) => {
              try {
                return { ...img, blob: await fetchImageBlob(img.previewUrl) };
              } catch (error) {
                console.warn(`Failed to fetch image ${img.filename}:`, error);
                return null;
              }
            }))).filter(Boolean)
          : [];

        // Check if we need to extract artifacts to separate files
        if (request.extractArtifacts || request.flattenArtifacts || fetchedImages.length > 0) {
          // Extract artifacts
          const artifactFiles = extractArtifactFiles(data, request.artifactFormat || 'original');

          if (artifactFiles.length > 0 || fetchedImages.length > 0) {
            // Create a ZIP with artifacts/images (and optionally conversation)
            const zip = new JSZip();

            // Add conversation file only if includeChats is true
            if (request.includeChats !== false) {
              let conversationContent, conversationFilename;
              switch (request.format) {
                case 'markdown':
                  conversationContent = convertToMarkdown(data, request.includeMetadata, request.conversationId, request.includeArtifacts, request.includeThinking);
                  conversationFilename = `${data.name || request.conversationId}.md`;
                  break;
                case 'text':
                  conversationContent = convertToText(data, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                  conversationFilename = `${data.name || request.conversationId}.txt`;
                  break;
                default:
                  conversationContent = JSON.stringify(data, null, 2);
                  conversationFilename = `${data.name || request.conversationId}.json`;
              }

              // Flat export: add to Chats folder
              if (request.flattenArtifacts && !request.extractArtifacts) {
                const chatsFolder = zip.folder('Chats');
                chatsFolder.file(conversationFilename, conversationContent);
              } else {
                // Nested or no artifact extraction: add to root
                zip.file(conversationFilename, conversationContent);
              }
            }

            // Add artifact files
            // Nested: create artifacts subfolder
            if (request.extractArtifacts) {
              const artifactsFolder = request.includeChats !== false ? zip.folder('artifacts') : zip;
              for (const artifact of artifactFiles) {
                artifactsFolder.file(artifact.filename, artifact.content);
              }
            }

            // Flat: add artifacts with conversation name prefix to Artifacts folder
            if (request.flattenArtifacts && !request.extractArtifacts) {
              const artifactsFolder = zip.folder('Artifacts');
              for (const artifact of artifactFiles) {
                const filename = `${data.name || request.conversationId}_${artifact.filename}`;
                artifactsFolder.file(filename, artifact.content);
              }
            }

            // Add uploaded images — flat mode mirrors the flat artifact
            // convention (top-level Images folder, conv-name prefix);
            // everything else (nested, or no extraction flags at all) uses
            // a plain images/ folder alongside artifacts/.
            if (fetchedImages.length > 0) {
              if (request.flattenArtifacts && !request.extractArtifacts) {
                const imagesFolder = zip.folder('Images');
                for (const img of fetchedImages) {
                  imagesFolder.file(`${data.name || request.conversationId}_${img.filename}`, img.blob);
                }
              } else {
                const imagesFolder = request.includeChats !== false ? zip.folder('images') : zip;
                for (const img of fetchedImages) {
                  imagesFolder.file(img.filename, img.blob);
                }
              }
            }

            // Generate and download ZIP
            zip.generateAsync({ type: 'blob' }).then(blob => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${data.name || request.conversationId}.zip`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            });

            console.log(`Downloading ZIP with conversation, ${artifactFiles.length} artifact(s), and ${fetchedImages.length} image(s)`);
            recordExportTimestamp(request.conversationId);
            sendResponse({ success: true, resolvedOrgId });
          } else {
            // No artifacts or images found, just export conversation normally
            let content, filename, type;
            switch (request.format) {
              case 'markdown':
                content = convertToMarkdown(data, request.includeMetadata, request.conversationId, request.includeArtifacts, request.includeThinking);
                filename = `${data.name || request.conversationId}.md`;
                type = 'text/markdown';
                break;
              case 'text':
                content = convertToText(data, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                filename = `${data.name || request.conversationId}.txt`;
                type = 'text/plain';
                break;
              default:
                content = JSON.stringify(data, null, 2);
                filename = `${data.name || request.conversationId}.json`;
                type = 'application/json';
            }
            console.log('No artifacts or images found. Downloading file:', filename);
            downloadFile(content, filename, type);
            recordExportTimestamp(request.conversationId);
            sendResponse({ success: true, resolvedOrgId });
          }
        } else {
          // Normal export without artifact extraction
          if (request.includeChats === false) {
            // If chats are disabled and we're not extracting artifacts, there's nothing to export
            console.log('No content to export (chats disabled, artifacts not extracted)');
            sendResponse({
              success: false,
              error: 'Nothing to export. Enable "Include conversation text" or "Artifacts nested".'
            });
          } else {
            let content, filename, type;
            switch (request.format) {
              case 'markdown':
                content = convertToMarkdown(data, request.includeMetadata, request.conversationId, request.includeArtifacts, request.includeThinking);
                filename = `${data.name || request.conversationId}.md`;
                type = 'text/markdown';
                break;
              case 'text':
                content = convertToText(data, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                filename = `${data.name || request.conversationId}.txt`;
                type = 'text/plain';
                break;
              default:
                content = JSON.stringify(data, null, 2);
                filename = `${data.name || request.conversationId}.json`;
                type = 'application/json';
            }

            console.log('Downloading file:', filename);
            downloadFile(content, filename, type);
            recordExportTimestamp(request.conversationId);
            sendResponse({ success: true, resolvedOrgId });
          }
        }
      })
      .catch(error => {
        console.error('Export conversation error:', error);
        sendResponse({ 
          success: false, 
          error: error.message,
          details: error.stack 
        });
      });
    
    return true;
  }
    
      if (request.action === 'exportAllConversations') {
    console.log('Export all conversations request received:', request);
    
    fetchAllConversationsAllOrgs()
      .then(async conversations => {
        console.log(`Fetched ${conversations.length} conversations`);

        if (request.extractArtifacts || request.flattenArtifacts) {
          // When extracting artifacts (nested or flat), always create a ZIP
          const zip = new JSZip();
          let processed = 0;
          let included = 0;
          let errors = [];

          for (const conv of conversations) {
            try {
              processed++;
              console.log(`Scanning conversation ${processed}/${conversations.length}: ${conv.name || conv.uuid}`);
              const fullConv = await fetchConversation(conv._orgId || request.orgId, conv.uuid);

              // Infer model if null
              fullConv.model = inferModel(fullConv);

              // Extract artifacts first to check if this conversation should be included
              const artifactFiles = extractArtifactFiles(fullConv, request.artifactFormat || 'original');

              // Fetch any uploaded images too (message.files, distinct from artifacts)
              const imageFilesMeta = extractImageFiles(fullConv);
              const fetchedImages = imageFilesMeta.length > 0
                ? (await Promise.all(imageFilesMeta.map(async (img) => {
                    try {
                      return { ...img, blob: await fetchImageBlob(img.previewUrl) };
                    } catch (error) {
                      console.warn(`Failed to fetch image ${img.filename}:`, error);
                      return null;
                    }
                  }))).filter(Boolean)
                : [];

              // If chats are disabled and no artifacts or images, skip this conversation
              if (request.includeChats === false && artifactFiles.length === 0 && fetchedImages.length === 0) {
                console.log(`  Skipping - no artifacts or images found (${processed}/${conversations.length} scanned, ${included} included)`);
                // Add a small delay to avoid overwhelming the API
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
              }

              // Sanitize folder name
              const folderName = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');

              // Generate conversation content
              let conversationContent, conversationFilename;
              if (request.format === 'markdown') {
                conversationContent = convertToMarkdown(fullConv, request.includeMetadata, conv.uuid, request.includeArtifacts, request.includeThinking);
                conversationFilename = `${folderName}.md`;
              } else if (request.format === 'text') {
                conversationContent = convertToText(fullConv, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                conversationFilename = `${folderName}.txt`;
              } else {
                conversationContent = JSON.stringify(fullConv, null, 2);
                conversationFilename = `${folderName}.json`;
              }

              // Flat export: use Chats and Artifacts top-level folders
              if (request.flattenArtifacts && !request.extractArtifacts) {
                // Add chat file to Chats folder if chats are enabled
                if (request.includeChats !== false) {
                  const chatsFolder = zip.folder('Chats');
                  chatsFolder.file(conversationFilename, conversationContent);
                }

                // Add artifacts to Artifacts folder with conversation name prefix
                if (artifactFiles.length > 0) {
                  const artifactsFolder = zip.folder('Artifacts');
                  for (const artifact of artifactFiles) {
                    const artifactFilename = `${folderName}_${artifact.filename}`;
                    artifactsFolder.file(artifactFilename, artifact.content);
                  }
                }

                // Add images to Images folder with conversation name prefix
                if (fetchedImages.length > 0) {
                  const imagesFolder = zip.folder('Images');
                  for (const img of fetchedImages) {
                    imagesFolder.file(`${folderName}_${img.filename}`, img.blob);
                  }
                }
              }
              // Nested export: create per-conversation folders with artifacts subfolder
              else if (request.extractArtifacts) {
                const convFolder = zip.folder(folderName);

                // Add conversation file only if includeChats is true
                if (request.includeChats !== false) {
                  convFolder.file(conversationFilename, conversationContent);
                }

                // Add artifact files in nested artifacts subfolder
                if (artifactFiles.length > 0) {
                  const artifactsFolder = request.includeChats !== false ? convFolder.folder('artifacts') : convFolder;
                  for (const artifact of artifactFiles) {
                    artifactsFolder.file(artifact.filename, artifact.content);
                  }
                }

                // Add images in a nested images subfolder alongside artifacts
                if (fetchedImages.length > 0) {
                  const imagesFolder = request.includeChats !== false ? convFolder.folder('images') : convFolder;
                  for (const img of fetchedImages) {
                    imagesFolder.file(img.filename, img.blob);
                  }
                }
              }
              // Neither nested nor flat artifact extraction requested, but this
              // conversation has images anyway — still include them, per-conversation.
              else if (fetchedImages.length > 0) {
                const convFolder = zip.folder(folderName);
                if (request.includeChats !== false) {
                  convFolder.file(conversationFilename, conversationContent);
                }
                const imagesFolder = request.includeChats !== false ? convFolder.folder('images') : convFolder;
                for (const img of fetchedImages) {
                  imagesFolder.file(img.filename, img.blob);
                }
              }

              included++;
              console.log(`  Added to export (${processed}/${conversations.length} scanned, ${included} included)`);

              // Add a small delay to avoid overwhelming the API
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              console.error(`Failed to export conversation ${conv.uuid}:`, error);
              errors.push(`${conv.name || conv.uuid}: ${error.message}`);
            }
          }

          // Generate and download ZIP
          zip.generateAsync({ type: 'blob' }).then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Format: claude-artifacts-20251031-143045.zip or claude-exports-20251031-143045.zip
            const datetime = getLocalDateTimeString();
            // Use 'claude-artifacts' when ONLY flat artifacts are exported
            const prefix = (request.flattenArtifacts && !request.extractArtifacts && request.includeChats === false) ? 'claude-artifacts' : 'claude-exports';
            a.download = `${prefix}-${datetime}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          });

          // Record export timestamps for all successfully exported conversations
          const exportedIds = conversations.map(c => c.uuid).filter(id => !errors.some(e => e.includes(id)));
          recordExportTimestamps(exportedIds);

          if (errors.length > 0) {
            console.warn('Some conversations failed to export:', errors);
            sendResponse({
              success: true,
              count: included,
              warnings: `Exported ${included}/${conversations.length} conversations. Some failed: ${errors.join('; ')}`
            });
          } else {
            sendResponse({ success: true, count: included });
          }
        } else {
          // For other formats without artifact extraction, create a ZIP
          const zip = new JSZip();
          let count = 0;
          let errors = [];

          for (const conv of conversations) {
            try {
              console.log(`Fetching full conversation ${count + 1}/${conversations.length}: ${conv.uuid}`);
              const fullConv = await fetchConversation(conv._orgId || request.orgId, conv.uuid);

              // Infer model if null
              fullConv.model = inferModel(fullConv);

              let content, filename;
              const safeName = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');

              if (request.format === 'markdown') {
                content = convertToMarkdown(fullConv, request.includeMetadata, conv.uuid, request.includeArtifacts, request.includeThinking);
                filename = `${safeName}.md`;
              } else if (request.format === 'text') {
                content = convertToText(fullConv, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                filename = `${safeName}.txt`;
              } else {
                content = JSON.stringify(fullConv, null, 2);
                filename = `${safeName}.json`;
              }

              zip.file(filename, content);

              // Fetch any uploaded images for this conversation too — placed
              // in a top-level Images folder with the conversation name
              // prefix, matching the flat artifact naming convention, since
              // this bulk path has no per-conversation folders.
              const imageFilesMeta = extractImageFiles(fullConv);
              if (imageFilesMeta.length > 0) {
                const imagesFolder = zip.folder('Images');
                for (const img of imageFilesMeta) {
                  try {
                    const blob = await fetchImageBlob(img.previewUrl);
                    imagesFolder.file(`${safeName}_${img.filename}`, blob);
                  } catch (error) {
                    console.warn(`Failed to fetch image ${img.filename} for ${conv.name || conv.uuid}:`, error);
                  }
                }
              }

              count++;

              // Add a small delay to avoid overwhelming the API
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              console.error(`Failed to export conversation ${conv.uuid}:`, error);
              errors.push(`${conv.name || conv.uuid}: ${error.message}`);
            }
          }

          // Generate and download ZIP
          zip.generateAsync({ type: 'blob' }).then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const datetime = getLocalDateTimeString();
            a.download = `claude-exports-${datetime}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          });

          // Record export timestamps for successfully exported conversations
          const exportedIds = conversations.map(c => c.uuid).filter(id => !errors.some(e => e.includes(id)));
          recordExportTimestamps(exportedIds);

          if (errors.length > 0) {
            console.warn('Some conversations failed to export:', errors);
            sendResponse({
              success: true,
              count,
              warnings: `Exported ${count}/${conversations.length} conversations. Some failed: ${errors.join('; ')}`
            });
          } else {
            sendResponse({ success: true, count });
          }
        }
      })
      .catch(error => {
        console.error('Export all conversations error:', error);
        sendResponse({
          success: false,
          error: error.message,
          details: error.stack
        });
      });

    return true;
  }

  // Handle loadConversations request from browse page
  if (request.action === 'loadConversations') {
    console.log('Load conversations request received from browse page');

    fetchAllConversationsAllOrgs()
      .then(conversations => {
        sendResponse({ success: true, conversations: conversations });
      })
      .catch(error => {
        console.error('Load conversations error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      });

    return true;
  }

  // Handle loadProjects request from browse page — projects are org-scoped,
  // so fetch across every chat-capable org and tag each with its org, same
  // as fetchAllConversationsAllOrgs.
  if (request.action === 'loadProjects') {
    console.log('Load projects request received from browse page');

    fetchChatCapableOrgs()
      .then(async orgs => {
        const merged = [];
        const seen = new Set();
        for (const org of orgs) {
          let projects;
          try {
            const response = await fetch(`https://claude.ai/api/organizations/${org.uuid}/projects`, {
              credentials: 'include',
              headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            projects = await response.json();
          } catch (error) {
            console.warn(`Skipping org ${org.uuid} while listing projects:`, error.message);
            continue;
          }
          for (const project of projects) {
            const projectId = project.uuid || project.id;
            if (seen.has(projectId)) continue;
            seen.add(projectId);
            project._orgId = org.uuid;
            merged.push(project);
          }
        }
        sendResponse({ success: true, projects: merged });
      })
      .catch(error => {
        console.error('Load projects error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      });

    return true;
  }

  // Fetch a single conversation's raw data (used by the Bridge page — no
  // download side effect, just the parsed JSON for context extraction).
  if (request.action === 'fetchConversationData') {
    fetchConversationAnyOrg(request.orgId, request.conversationId)
      .then(({ data, orgId }) => {
        if (!data || !data.chat_messages || !Array.isArray(data.chat_messages)) {
          throw new Error('Invalid conversation data structure. Please refresh the page and try again.');
        }
        data.model = inferModel(data);
        sendResponse({ success: true, data, resolvedOrgId: orgId });
      })
      .catch(error => {
        console.error('Fetch conversation data error:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }
  });

} // End of double-injection guard