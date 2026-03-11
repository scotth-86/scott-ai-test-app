// === Configuration ===
const SUPABASE_URL = "https://frcvrbiedtvljyfouzng.supabase.co";
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate`;
const STORAGE_URL = `${SUPABASE_URL}/storage/v1`;

// === DOM Elements ===
const humanInput = document.getElementById("humanInput");
const promptDropdown = document.getElementById("promptDropdown");
const freeformPrompt = document.getElementById("freeformPrompt");
const generateBtn = document.getElementById("generateBtn");
const aiResponse = document.getElementById("aiResponse");
const useResponseBtn = document.getElementById("useResponseBtn");
const loginBtn = document.getElementById("loginBtn");
const authControls = document.getElementById("authControls");
const toggleFilePanelBtn = document.getElementById("toggleFilePanelBtn");
const filePanel = document.getElementById("filePanel");

// File management elements
const attachFileBtn = document.getElementById("attachFileBtn");
const attachedFileChip = document.getElementById("attachedFileChip");
const attachedFileName = document.getElementById("attachedFileName");
const detachFileBtn = document.getElementById("detachFileBtn");
const uploadZone = document.getElementById("uploadZone");
const filePickerBtn = document.getElementById("filePickerBtn");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const fileListEmpty = document.getElementById("fileListEmpty");

// Preview modal
const previewModal = document.getElementById("previewModal");
const previewTitle = document.getElementById("previewTitle");
const previewBody = document.getElementById("previewBody");
const closePreviewBtn = document.getElementById("closePreviewBtn");

// Login modal
const loginModal = document.getElementById("loginModal");
const closeLoginBtn = document.getElementById("closeLoginBtn");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const submitLoginBtn = document.getElementById("submitLoginBtn");

// Admin panel
const adminPanel = document.getElementById("adminPanel");
const adminRows = document.getElementById("adminRows");
const addRowBtn = document.getElementById("addRowBtn");
const newLabel = document.getElementById("newLabel");
const newContent = document.getElementById("newContent");
const newSortOrder = document.getElementById("newSortOrder");

// Cancel button
const cancelBtn = document.getElementById("cancelBtn");

// === State ===
let isGenerating = false;
let abortController = null;
let attachedFile = null; // { storage_path, filename, mime_type }
let authSession = null;  // { access_token, user }
let adminCategory = "dropdown_prompt";

// === Toast Notification System ===
function showToast(message, type = "info") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

// === Initialize ===
document.addEventListener("DOMContentLoaded", () => {
  restoreSession();
  loadPrompts();
  loadFiles();
  setupEventListeners();
});

// =============================================
// === AUTH
// =============================================

function restoreSession() {
  try {
    const stored = localStorage.getItem("scott_ai_session");
    if (stored) {
      const session = JSON.parse(stored);
      // Check if token is still likely valid (rough check)
      if (session.access_token && session.expires_at > Date.now() / 1000) {
        authSession = session;
        updateAuthUI();
        return;
      }
      // Try refresh
      if (session.refresh_token) {
        refreshToken(session.refresh_token);
        return;
      }
    }
  } catch (e) {
    console.warn("Session restore failed:", e);
  }
  localStorage.removeItem("scott_ai_session");
}

async function signIn(email, password) {
  loginError.classList.add("hidden");
  submitLoginBtn.disabled = true;
  submitLoginBtn.textContent = "Signing in...";

  try {
    const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: getAnonKey(),
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error_description || data.msg || "Invalid credentials");
    }

    authSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || (Date.now() / 1000 + data.expires_in),
      user: data.user,
    };

    localStorage.setItem("scott_ai_session", JSON.stringify(authSession));
    updateAuthUI();
    closeLoginModal();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove("hidden");
  } finally {
    submitLoginBtn.disabled = false;
    submitLoginBtn.textContent = "Sign In";
  }
}

async function refreshToken(token) {
  try {
    const res = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: getAnonKey(),
      },
      body: JSON.stringify({ refresh_token: token }),
    });

    if (!res.ok) throw new Error("Refresh failed");

    const data = await res.json();
    authSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || (Date.now() / 1000 + data.expires_in),
      user: data.user,
    };
    localStorage.setItem("scott_ai_session", JSON.stringify(authSession));
    updateAuthUI();
  } catch (e) {
    console.warn("Token refresh failed:", e);
    signOut();
  }
}

function signOut() {
  authSession = null;
  localStorage.removeItem("scott_ai_session");
  updateAuthUI();
}

function updateAuthUI() {
  if (authSession) {
    const email = authSession.user?.email || "Logged in";
    authControls.innerHTML = `
      <span class="user-email">${email}</span>
      <button id="logoutBtn" class="btn btn-subtle">Logout</button>
    `;
    document.getElementById("logoutBtn").addEventListener("click", signOut);
    adminPanel.classList.remove("hidden");
    loadAdminRows();
  } else {
    authControls.innerHTML = `<button id="loginBtn" class="btn btn-subtle">Login</button>`;
    document.getElementById("loginBtn").addEventListener("click", openLoginModal);
    adminPanel.classList.add("hidden");
  }
}

function openLoginModal() {
  loginEmail.value = "";
  loginPassword.value = "";
  loginError.classList.add("hidden");
  loginModal.classList.remove("hidden");
  loginEmail.focus();
}

function closeLoginModal() {
  loginModal.classList.add("hidden");
}

function getAuthHeaders() {
  if (!authSession) return {};
  return {
    Authorization: `Bearer ${authSession.access_token}`,
  };
}

// === Load Dropdown Prompts from Supabase ===
async function loadPrompts() {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/prompt_data?category=eq.dropdown_prompt&is_active=eq.true&order=sort_order`,
      {
        headers: {
          apikey: getAnonKey(),
          Authorization: `Bearer ${getAnonKey()}`,
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const prompts = await response.json();
    promptDropdown.innerHTML = "";

    if (prompts.length === 0) {
      promptDropdown.innerHTML = '<option value="" disabled selected>No prompts available</option>';
      return;
    }

    prompts.forEach((prompt) => {
      const option = document.createElement("option");
      let promptKey;
      if (prompt.content === "SCOTT_AI_TRIGGER") {
        promptKey = "scott_ai";
      } else if (prompt.label === "Edit this") {
        promptKey = "edit_this";
      } else if (prompt.label === "Fill in gaps") {
        promptKey = "fill_in_gaps";
      } else {
        promptKey = prompt.label;
      }
      option.value = promptKey;
      option.textContent = prompt.label;
      promptDropdown.appendChild(option);
    });

    promptDropdown.selectedIndex = 0;
    generateBtn.disabled = false;
  } catch (err) {
    console.error("Failed to load prompts:", err);
    promptDropdown.innerHTML = '<option value="" disabled selected>Error loading prompts</option>';
  }
}

// === Event Listeners ===
function setupEventListeners() {
  generateBtn.addEventListener("click", handleGenerate);
  useResponseBtn.addEventListener("click", handleUseResponse);

  toggleFilePanelBtn.addEventListener("click", () => {
    filePanel.classList.toggle("hidden");
    toggleFilePanelBtn.classList.toggle("open");
  });

  humanInput.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!generateBtn.disabled && !isGenerating) {
        handleGenerate();
      }
    }
  });

  // Login button (initial)
  loginBtn.addEventListener("click", openLoginModal);

  // Login modal
  closeLoginBtn.addEventListener("click", closeLoginModal);
  loginModal.addEventListener("click", (e) => {
    if (e.target === loginModal) closeLoginModal();
  });
  submitLoginBtn.addEventListener("click", () => {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) {
      loginError.textContent = "Please enter email and password.";
      loginError.classList.remove("hidden");
      return;
    }
    signIn(email, password);
  });
  loginPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitLoginBtn.click();
  });

  // Attach file button â opens file panel if closed, scrolls to it
  attachFileBtn.addEventListener("click", () => {
    if (filePanel.classList.contains("hidden")) {
      filePanel.classList.remove("hidden");
      toggleFilePanelBtn.classList.add("open");
    }
    filePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Detach file
  detachFileBtn.addEventListener("click", () => {
    detachFile();
  });

  // Cancel generation
  cancelBtn.addEventListener("click", () => {
    if (abortController) {
      abortController.abort();
    }
  });

  // File upload â drag & drop
  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("drag-over");
  });

  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("drag-over");
  });

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  // File upload â picker
  filePickerBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
      fileInput.value = ""; // reset for re-upload of same file
    }
  });

  // Preview modal close
  closePreviewBtn.addEventListener("click", closePreview);
  previewModal.addEventListener("click", (e) => {
    if (e.target === previewModal) closePreview();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!previewModal.classList.contains("hidden")) closePreview();
      if (!loginModal.classList.contains("hidden")) closeLoginModal();
    }
  });

  // Admin tabs
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      adminCategory = tab.dataset.cat;
      loadAdminRows();
    });
  });

  // Add row button
  addRowBtn.addEventListener("click", handleAddRow);
}

// === Generate Handler ===
async function handleGenerate() {
  const input = humanInput.value.trim();
  const promptKey = promptDropdown.value;
  const freeform = freeformPrompt.value.trim();

  if (!input && !freeform) {
    humanInput.focus();
    humanInput.style.borderColor = "var(--danger)";
    setTimeout(() => (humanInput.style.borderColor = ""), 1500);
    return;
  }

  if (!promptKey) {
    promptDropdown.focus();
    return;
  }

  isGenerating = true;
  generateBtn.disabled = true;
  generateBtn.classList.add("generating");
  generateBtn.innerHTML = '<span class="spinner"></span> Generating...';
  cancelBtn.classList.remove("hidden");
  aiResponse.textContent = "";
  aiResponse.classList.add("streaming");
  useResponseBtn.classList.add("hidden");

  abortController = new AbortController();

  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        human_input: input,
        prompt_key: promptKey,
        freeform_prompt: freeform || null,
        file_path: attachedFile ? attachedFile.storage_path : null,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
              aiResponse.textContent += parsed.delta.text;
              aiResponse.scrollTop = aiResponse.scrollHeight;
            }
            if (parsed.type === "error") {
              throw new Error(parsed.error?.message || "Stream error");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      aiResponse.textContent += "\n\n[Generation cancelled]";
      showToast("Generation cancelled.", "info");
    } else {
      console.error("Generation error:", err);
      aiResponse.innerHTML = `<span class="error-text">Error: ${escapeHtml(err.message)}</span>`;
      showToast("Generation failed. Check your connection and try again.", "error");
    }
  } finally {
    isGenerating = false;
    generateBtn.disabled = false;
    generateBtn.classList.remove("generating");
    generateBtn.textContent = "Generate";
    cancelBtn.classList.add("hidden");
    aiResponse.classList.remove("streaming");
    abortController = null;

    if (aiResponse.textContent.trim()) {
      useResponseBtn.classList.remove("hidden");
    }
  }
}

// === Use AI Response Handler ===
function handleUseResponse() {
  const responseText = aiResponse.textContent.trim();
  if (!responseText) return;

  humanInput.value = responseText;
  freeformPrompt.value = "";
  aiResponse.textContent = "";
  useResponseBtn.classList.add("hidden");
  humanInput.focus();
}

// =============================================
// === FILE MANAGEMENT
// =============================================

// === Upload File ===
async function uploadFile(file) {
  // Validate size
  if (file.size > 10 * 1024 * 1024) {
    showToast("File too large. Maximum size is 10MB.", "error");
    return;
  }

  const timestamp = Date.now();
  const storagePath = `${timestamp}_${file.name}`;

  uploadZone.classList.add("uploading");

  try {
    // Upload to Supabase Storage
    const uploadRes = await fetch(`${STORAGE_URL}/object/uploads/${storagePath}`, {
      method: "POST",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${getAnonKey()}`,
      },
      body: file,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json();
      throw new Error(err.message || `Upload failed: ${uploadRes.status}`);
    }

    // Insert metadata row
    const metaRes = await fetch(`${SUPABASE_URL}/rest/v1/file_metadata`, {
      method: "POST",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${getAnonKey()}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        storage_path: storagePath,
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      }),
    });

    if (!metaRes.ok) throw new Error("Failed to save file metadata");

    // Refresh file list
    await loadFiles();
  } catch (err) {
    console.error("Upload error:", err);
    showToast(`Upload failed: ${err.message}`, "error");
  } finally {
    uploadZone.classList.remove("uploading");
  }
}

// === Load File List ===
async function loadFiles() {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/file_metadata?order=uploaded_at.desc`,
      {
        headers: {
          apikey: getAnonKey(),
          Authorization: `Bearer ${getAnonKey()}`,
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const files = await response.json();

    // Clear existing rows (keep the empty message)
    fileList.querySelectorAll(".file-row").forEach((el) => el.remove());

    if (files.length === 0) {
      fileListEmpty.classList.remove("hidden");
      return;
    }

    fileListEmpty.classList.add("hidden");

    files.forEach((file) => {
      const row = document.createElement("div");
      row.className = "file-row";
      row.dataset.id = file.id;

      const icon = getFileIcon(file.mime_type);
      const size = formatFileSize(file.size_bytes);
      const date = new Date(file.uploaded_at).toLocaleDateString();
      const isAttached = attachedFile && attachedFile.storage_path === file.storage_path;

      row.innerHTML = `
        <span class="file-icon">${icon}</span>
        <div class="file-info">
          <div class="file-name" title="${file.filename}">${file.filename}</div>
          <div class="file-meta">${size} &middot; ${date}</div>
        </div>
        <div class="file-actions">
          <button class="btn-preview" title="Preview">Preview</button>
          <button class="btn-attach ${isAttached ? "btn-attach-active" : ""}" title="${isAttached ? "Attached" : "Attach to prompt"}">${isAttached ? "Attached" : "Attach"}</button>
          <button class="btn-delete" title="Delete">Delete</button>
        </div>
      `;

      // Wire buttons
      row.querySelector(".btn-preview").addEventListener("click", () => openPreview(file));
      row.querySelector(".btn-attach").addEventListener("click", () => attachFile(file));
      row.querySelector(".btn-delete").addEventListener("click", () => deleteFile(file));

      fileList.appendChild(row);
    });
  } catch (err) {
    console.error("Failed to load files:", err);
  }
}

// === Attach File ===
function attachFile(file) {
  attachedFile = {
    storage_path: file.storage_path,
    filename: file.filename,
    mime_type: file.mime_type,
  };

  attachedFileName.textContent = file.filename;
  attachedFileChip.classList.remove("hidden");

  // Update all attach buttons
  fileList.querySelectorAll(".btn-attach").forEach((btn) => {
    const row = btn.closest(".file-row");
    const rowFile = row.querySelector(".file-name").textContent;
    if (rowFile === file.filename) {
      btn.textContent = "Attached";
      btn.classList.add("btn-attach-active");
    } else {
      btn.textContent = "Attach";
      btn.classList.remove("btn-attach-active");
    }
  });
}

// === Detach File ===
function detachFile() {
  attachedFile = null;
  attachedFileChip.classList.add("hidden");
  attachedFileName.textContent = "";

  // Reset all attach buttons
  fileList.querySelectorAll(".btn-attach").forEach((btn) => {
    btn.textContent = "Attach";
    btn.classList.remove("btn-attach-active");
  });
}

// === Delete File ===
async function deleteFile(file) {
  if (!confirm(`Delete "${file.filename}"?`)) return;

  try {
    // Delete from storage
    await fetch(`${STORAGE_URL}/object/uploads/${file.storage_path}`, {
      method: "DELETE",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${getAnonKey()}`,
      },
    });

    // Delete metadata row
    await fetch(`${SUPABASE_URL}/rest/v1/file_metadata?id=eq.${file.id}`, {
      method: "DELETE",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${getAnonKey()}`,
      },
    });

    // If this was the attached file, detach it
    if (attachedFile && attachedFile.storage_path === file.storage_path) {
      detachFile();
    }

    await loadFiles();
  } catch (err) {
    console.error("Delete error:", err);
    showToast(`Delete failed: ${err.message}`, "error");
  }
}

// === Preview File ===
function openPreview(file) {
  previewTitle.textContent = file.filename;
  previewBody.innerHTML = "";

  const publicUrl = `${STORAGE_URL}/object/public/uploads/${file.storage_path}`;

  if (file.mime_type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = publicUrl;
    img.alt = file.filename;
    previewBody.appendChild(img);
  } else if (file.mime_type === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = publicUrl;
    previewBody.appendChild(iframe);
  } else if (file.mime_type === "text/plain" || file.mime_type === "text/markdown") {
    // Fetch text content
    fetch(publicUrl)
      .then((res) => res.text())
      .then((text) => {
        const pre = document.createElement("pre");
        pre.textContent = text;
        previewBody.appendChild(pre);
      })
      .catch(() => {
        previewBody.innerHTML = '<p class="placeholder-text">Could not load file content.</p>';
      });
  } else if (file.mime_type.includes("wordprocessingml")) {
    previewBody.innerHTML = '<p class="placeholder-text">Word document preview: text will be extracted when attached to an AI prompt.</p>';
  } else {
    previewBody.innerHTML = '<p class="placeholder-text">Preview not available for this file type.</p>';
  }

  previewModal.classList.remove("hidden");
}

function closePreview() {
  previewModal.classList.add("hidden");
  previewBody.innerHTML = "";
}

// =============================================
// === ADMIN PANEL
// =============================================

async function loadAdminRows() {
  if (!authSession) return;

  adminRows.innerHTML = '<p class="placeholder-text">Loading...</p>';

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/prompt_data?category=eq.${adminCategory}&order=sort_order,label`,
      {
        headers: {
          apikey: getAnonKey(),
          Authorization: `Bearer ${authSession.access_token}`,
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rows = await response.json();
    adminRows.innerHTML = "";

    if (rows.length === 0) {
      adminRows.innerHTML = '<p class="placeholder-text">No rows in this category.</p>';
      return;
    }

    rows.forEach((row) => {
      const el = document.createElement("div");
      el.className = "admin-row";
      el.dataset.id = row.id;

      const truncatedContent = row.content.length > 150 ? row.content.substring(0, 150) + "..." : row.content;

      el.innerHTML = `
        <div class="admin-row-header">
          <span class="admin-row-label">${escapeHtml(row.label)}</span>
          <div class="admin-row-meta">
            <span class="admin-row-order">#${row.sort_order}</span>
            <button class="admin-row-toggle ${row.is_active ? "active" : "inactive"}"
              title="${row.is_active ? "Active â click to deactivate" : "Inactive â click to activate"}">
              ${row.is_active ? "Active" : "Off"}
            </button>
          </div>
        </div>
        <div class="admin-row-content" title="Click to expand">${escapeHtml(truncatedContent)}</div>
        <div class="admin-row-actions">
          <button class="btn-admin-edit">Edit</button>
          <button class="btn-admin-delete">Delete</button>
        </div>
      `;

      // Toggle active
      el.querySelector(".admin-row-toggle").addEventListener("click", () => {
        toggleRowActive(row.id, !row.is_active);
      });

      // Expand content on click
      el.querySelector(".admin-row-content").addEventListener("click", (e) => {
        const contentEl = e.target;
        if (contentEl.classList.contains("expanded")) {
          contentEl.classList.remove("expanded");
          contentEl.textContent = truncatedContent;
        } else {
          contentEl.classList.add("expanded");
          contentEl.textContent = row.content;
        }
      });

      // Edit
      el.querySelector(".btn-admin-edit").addEventListener("click", () => openEditModal(row));

      // Delete
      el.querySelector(".btn-admin-delete").addEventListener("click", () => deleteRow(row));

      adminRows.appendChild(el);
    });
  } catch (err) {
    console.error("Failed to load admin rows:", err);
    adminRows.innerHTML = '<p class="placeholder-text">Error loading data.</p>';
  }
}

async function handleAddRow() {
  const label = newLabel.value.trim();
  const content = newContent.value.trim();
  const sortOrder = parseInt(newSortOrder.value) || 10;

  if (!label || !content) {
    showToast("Please fill in both Label and Content.", "error");
    return;
  }

  if (!authSession) {
    showToast("Please log in to add rows.", "error");
    return;
  }

  addRowBtn.disabled = true;
  addRowBtn.textContent = "Adding...";

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/prompt_data`, {
      method: "POST",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${authSession.access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        category: adminCategory,
        label: label,
        content: content,
        sort_order: sortOrder,
        is_active: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    newLabel.value = "";
    newContent.value = "";
    newSortOrder.value = "10";

    await loadAdminRows();
    showToast("Row added successfully.", "success");

    // If we added a dropdown_prompt, refresh the dropdown
    if (adminCategory === "dropdown_prompt") {
      await loadPrompts();
    }
  } catch (err) {
    console.error("Add row error:", err);
    showToast(`Failed to add row: ${err.message}`, "error");
  } finally {
    addRowBtn.disabled = false;
    addRowBtn.textContent = "+ Add Row";
  }
}

async function toggleRowActive(id, newState) {
  if (!authSession) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/prompt_data?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${authSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_active: newState }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    await loadAdminRows();

    // Refresh dropdown if it's a dropdown_prompt
    if (adminCategory === "dropdown_prompt") {
      await loadPrompts();
    }
  } catch (err) {
    console.error("Toggle error:", err);
    showToast(`Failed to update: ${err.message}`, "error");
  }
}

function openEditModal(row) {
  // Create edit modal dynamically
  const overlay = document.createElement("div");
  overlay.className = "edit-modal-overlay";
  overlay.innerHTML = `
    <div class="edit-modal">
      <label>Label</label>
      <input type="text" id="editLabel" value="${escapeAttr(row.label)}">
      <label>Content</label>
      <textarea id="editContent" rows="6">${escapeHtml(row.content)}</textarea>
      <label>Sort Order</label>
      <input type="number" id="editSortOrder" value="${row.sort_order}">
      <div class="edit-modal-actions">
        <button class="btn btn-small" id="cancelEditBtn">Cancel</button>
        <button class="btn btn-small btn-accent" id="saveEditBtn">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on click outside
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById("cancelEditBtn").addEventListener("click", () => overlay.remove());

  document.getElementById("saveEditBtn").addEventListener("click", async () => {
    const newLabelVal = document.getElementById("editLabel").value.trim();
    const newContentVal = document.getElementById("editContent").value.trim();
    const newSortVal = parseInt(document.getElementById("editSortOrder").value) || row.sort_order;

    if (!newLabelVal || !newContentVal) {
      showToast("Label and Content are required.", "error");
      return;
    }

    try {
      const saveBtn = document.getElementById("saveEditBtn");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      const res = await fetch(`${SUPABASE_URL}/rest/v1/prompt_data?id=eq.${row.id}`, {
        method: "PATCH",
        headers: {
          apikey: getAnonKey(),
          Authorization: `Bearer ${authSession.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: newLabelVal,
          content: newContentVal,
          sort_order: newSortVal,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      overlay.remove();
      await loadAdminRows();

      // Refresh dropdown if editing dropdown_prompt
      if (adminCategory === "dropdown_prompt") {
        await loadPrompts();
      }
    } catch (err) {
      console.error("Edit error:", err);
      showToast(`Failed to save: ${err.message}`, "error");
    }
  });
}

async function deleteRow(row) {
  if (!confirm(`Delete "${row.label}"? This cannot be undone.`)) return;
  if (!authSession) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/prompt_data?id=eq.${row.id}`, {
      method: "DELETE",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${authSession.access_token}`,
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    await loadAdminRows();

    if (adminCategory === "dropdown_prompt") {
      await loadPrompts();
    }
  } catch (err) {
    console.error("Delete error:", err);
    showToast(`Failed to delete: ${err.message}`, "error");
  }
}

// =============================================
// === UTILITY
// =============================================

function getFileIcon(mimeType) {
  if (mimeType.startsWith("image/")) return "\u{1F5BC}";
  if (mimeType === "application/pdf") return "\u{1F4C4}";
  if (mimeType === "text/plain" || mimeType === "text/markdown") return "\u{1F4DD}";
  if (mimeType.includes("wordprocessingml")) return "\u{1F4C3}";
  return "\u{1F4CE}";
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getAnonKey() {
  return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyY3ZyYmllZHR2bGp5Zm91em5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMTA1OTUsImV4cCI6MjA4ODc4NjU5NX0.xUfluERtM4cleD1zmDnMavjh32HxXcAtLRWtQiSs3mY";
}

