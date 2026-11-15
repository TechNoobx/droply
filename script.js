
// ====================================
// DROPLY - SECURE CLOUD SHARING
// HTML + CSS + JAVASCRIPT
// ====================================

// 1. SUPABASE CONNECTION
const SUPABASE_URL = "https://truixuyaonbflgryvdix.supabase.co";
const SUPABASE_KEY = "sb_publishable_zN5DQMd7W0esesvinB74ug_TMGffX6N";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

const BUCKET = "droply-files";

let currentCode = "";
let spaceChannel = null;
let saveTimer = null;
let selectedFiles = [];

function showLoading(message = "Please wait...") {
    document.getElementById("loadingMessage").textContent = message;
    document.getElementById("loadingScreen").classList.remove("hidden");
}

function hideLoading() {
    document.getElementById("loadingScreen").classList.add("hidden");
}

async function withLoading(message, operation) {
    showLoading(message);

    try {
        return await operation();
    } catch (error) {
        console.error(error);
        alert(error.message || "Something went wrong!");
        throw error;
    } finally {
        hideLoading();
    }
}

// HTML ELEMENTS
const home = document.getElementById("home");
const workspace = document.getElementById("workspace");
const textContent = document.getElementById("textContent");
const fileList = document.getElementById("fileList");
const fileInput = document.getElementById("fileInput");
const saveStatus = document.getElementById("saveStatus");
const uploadProgress = document.getElementById("uploadProgress");
const uploadProgressText = document.getElementById("uploadProgressText");


const fileDropArea = document.getElementById("fileDropArea");

// Select files from computer
fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
        uploadFiles();
    }
});

// Prevent browser from opening dropped files
["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
    fileDropArea.addEventListener(eventName, event => {
        event.preventDefault();
        event.stopPropagation();
    });
});

// Highlight the area when dragging files over it
["dragenter", "dragover"].forEach(eventName => {
    fileDropArea.addEventListener(eventName, () => {
        fileDropArea.classList.add("drag-over");
    });
});

// Remove highlight
["dragleave", "drop"].forEach(eventName => {
    fileDropArea.addEventListener(eventName, () => {
        fileDropArea.classList.remove("drag-over");
    });
});

// Upload dropped files
fileDropArea.addEventListener("drop", event => {
    const droppedFiles = event.dataTransfer.files;

    if (!droppedFiles.length) return;

    const transfer = new DataTransfer();

    Array.from(droppedFiles).forEach(file => {
        transfer.items.add(file);
    });

    fileInput.files = transfer.files;

    uploadFiles();
});

// ====================================
// 2. ANONYMOUS SIGN-IN
// ====================================

async function ensureSignedIn() {
    let { data: { session }, error } =
        await supabaseClient.auth.getSession();

    if (error) throw error;

    if (!session) {
        const result =
            await supabaseClient.auth.signInAnonymously();

        if (result.error) throw result.error;

        session = result.data.session;
    }

    if (!session) {
        throw new Error("Could not create your visitor session.");
    }

    await supabaseClient.realtime.setAuth(session.access_token);

    return session;
}


// ====================================
// 3. CALL SECURE EDGE FUNCTION
// ====================================

async function callSpaceFunction(body) {
    const { data, error } =
        await supabaseClient.functions.invoke(
            "droply-space",
            { body }
        );

    if (error) {
        let details = {};

        try {
            if (error.context) {
                details = await error.context.json();
            }
        } catch (_) {}

        const newError = new Error(
            details.error || error.message
        );

        newError.status = error.context?.status;

        throw newError;
    }

    return data;
}


// ====================================
// 4. CREATE OR OPEN A SPACE
// ====================================

async function openSpace() {
    showLoading("Opening your space...");

    try {
        const code = document
            .getElementById("spaceCode")
            .value.trim();

        console.log("Space code being sent:", JSON.stringify(code));
        console.log("Space code length:", code.length);

        if (!/^[A-Za-z0-9_-]{4,40}$/.test(code)) {
            alert("Enter a valid code (4-40 characters).");
            return;
        }

        await ensureSignedIn();

        // First try joining an existing space
        try {
            await callSpaceFunction({
                action: "join",
                code: code
            });

        } catch (error) {

            // Existing protected space
            if (
                error.status === 401 &&
                error.message.toLowerCase().includes("password")
            ) {
                const password = prompt(
                    "This space is password protected. Enter its password:"
                );

                if (password === null) return;

                await callSpaceFunction({
                    action: "join",
                    code: code,
                    password: password
                });
            }

            // Space does not exist
            else if (error.status === 404) {
                const create = confirm(
                    "This space does not exist. Would you like to create it?"
                );

                if (!create) return;

                const password = prompt(
                    "Set a password (minimum 8 characters). Leave blank for no password:"
                );

                if (password === null) return;

                if (password && password.length < 8) {
                    alert("Password must contain at least 8 characters.");
                    return;
                }

                await callSpaceFunction({
                    action: "create",
                    code: code,
                    ...(password ? { password: password } : {})
                });
            } else {
                throw error;
            }
        }

        // Access granted
        currentCode = code;

        clearFiles();

        home.classList.add("hidden");
        workspace.classList.remove("hidden");

        document.getElementById("currentCode").textContent = code;

        history.replaceState({}, "", window.location.pathname);

        await loadText();
        await loadFiles();

        // Check whether this visitor owns the space
        const ownerStatus = await callSpaceFunction({
            action: "owner-status",
            code: currentCode
        });

        document.getElementById("ownerControls").classList.toggle(
            "hidden",
            !ownerStatus.isOwner
        );

        subscribeToSpace();

    } catch (error) {
        console.error("Space error:", error);
        alert("Could not open space: " + error.message);

    } finally {
        hideLoading();
    }
}



// ====================================
// 5. LOAD TEXT
// ====================================

async function loadText() {
    const { data, error } = await supabaseClient
        .from("spaces")
        .select("content")
        .eq("code", currentCode)
        .single();

    if (error) {
        console.error(error);
        throw new Error("Could not load space text.");
    }

    textContent.value = data.content || "";
}


// ====================================
// 6. SAVE TEXT
// ====================================


async function saveText() {
    if (!currentCode) return;

    saveStatus.textContent = "Saving...";

    showLoading("Saving changes...");

    try {
        const { error } = await supabaseClient
            .from("spaces")
            .update({
                content: textContent.value,
                updated_at: new Date().toISOString()
            })
            .eq("code", currentCode);

        if (error) {
            console.error(error);
            saveStatus.textContent = "Save failed!";
            return;
        }

        saveStatus.textContent = "Saved to cloud!";

    } catch (error) {
        console.error(error);
        saveStatus.textContent = "Save failed!";

    } finally {
        hideLoading();
    }
}



// ====================================
// 7. AUTOMATIC TEXT SAVING
// ====================================

function handleTextInput() {
    clearTimeout(saveTimer);

    saveStatus.textContent = "Typing...";

    saveTimer = setTimeout(() => {
        saveText();
    }, 800);
}


// ====================================
// 8. REAL-TIME TEXT UPDATES
// ====================================

function subscribeToSpace() {
    if (spaceChannel) {
        supabaseClient.removeChannel(spaceChannel);
        spaceChannel = null;
    }

    spaceChannel = supabaseClient
        .channel("space-" + currentCode)
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "spaces",
                filter: `code=eq.${currentCode}`
            },
            (payload) => {
                if (document.activeElement !== textContent) {
                    textContent.value = payload.new.content || "";
                }
            }
        )
        .subscribe();
}


// ====================================
// 9. UPLOAD FILES
// ====================================
async function uploadTusFile(file, filePath) {
    const { data: { session } } =
        await supabaseClient.auth.getSession();

    if (!session) {
        throw new Error("Please sign in again.");
    }

    return new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
            endpoint:
                "https://truixuyaonbflgryvdix.storage.supabase.co/storage/v1/upload/resumable",

            retryDelays: [0, 3000, 5000, 10000, 20000],

            headers: {
                authorization: `Bearer ${session.access_token}`,
                apikey: SUPABASE_KEY,
                "x-upsert": "false"
            },

            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            chunkSize: 6 * 1024 * 1024,

            metadata: {
                bucketName: BUCKET,
                objectName: filePath,
                contentType: file.type || "application/octet-stream",
                cacheControl: "3600"
            },

            onProgress(bytesUploaded, bytesTotal) {
                const percent = Math.round(
                    (bytesUploaded / bytesTotal) * 100
                );

                uploadProgress.value = percent;
                uploadProgressText.textContent =
                    `Uploading ${file.name}: ${percent}%`;
            },

            onError(error) {
                reject(error);
            },

            onSuccess() {
                resolve();
            }
        });

        upload.start();
    });
}


async function uploadFilesOriginal() {

    if (!currentCode) {
        alert("Open a space first.");
        return;
    }

    const files = Array.from(fileInput.files || []);

    if (!files.length) return;

    const MAX_FILE_SIZE = 10 * 1024 * 1024;

    const validFiles = files.filter(file => {
        if (file.size > MAX_FILE_SIZE) {
            alert(`${file.name} is larger than 10 MB.`);
            return false;
        }
        return true;
    });

    if (!validFiles.length) return;

    let completed = 0;
    let failed = 0;

    for (const file of validFiles) {
        try {
            uploadProgress.value = 0;

            const safeName = file.name.replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
            );

            const filePath =
                `${currentCode}/${crypto.randomUUID()}-${safeName}`;

            await uploadTusFile(file, filePath);

            const { error: dbError } = await supabaseClient
                .from("files")
                .insert({
                    code: currentCode,
                    name: file.name,
                    file_path: filePath,
                    mime_type: file.type,
                    file_size: file.size
                });

            if (dbError) {
                await supabaseClient.storage
                    .from(BUCKET)
                    .remove([filePath]);

                throw dbError;
            }

            completed++;

        } catch (error) {
            console.error("Upload failed:", file.name, error);
            failed++;
        }
    }

    fileInput.value = "";

    await loadFiles();

    uploadProgressText.textContent =
        `${completed} uploaded, ${failed} failed.`;

    saveStatus.textContent = failed
        ? "Some files could not be uploaded."
        : "All files uploaded successfully!";
}
// Upload function with loading screen
async function uploadFiles() {
    await withLoading("Uploading files...", async () => {
        await uploadFilesOriginal();
    });
}

async function deleteFileOriginal(file){
    const confirmed = confirm(
        `Are you sure you want to delete "${file.name}"?`
    );

    if (!confirmed) return;

    try {
        saveStatus.textContent = "Deleting file...";

        // Remove file from Supabase Storage
        const { error: storageError } = await supabaseClient
            .storage
            .from(BUCKET)
            .remove([file.file_path]);

        if (storageError) throw storageError;

        // Remove file information from database
        const { error: dbError } = await supabaseClient
            .from("files")
            .delete()
            .eq("id", file.id)
            .eq("code", currentCode);

        if (dbError) throw dbError;

        await loadFiles();

        saveStatus.textContent = "File deleted successfully!";

    } catch (error) {
        console.error("Delete failed:", error);
        saveStatus.textContent = "Delete failed!";
        alert("Could not delete file: " + error.message);
    }
}
async function deleteFile(file) {
    await withLoading("Deleting file...", async () => {
        await deleteFileOriginal(file);
    });
}


async function downloadFile(fileURL, fileName) {
    await withLoading("Downloading file...", async () => {
        const response = await fetch(fileURL);

        if (!response.ok) {
            throw new Error("Download failed. Please try again.");
        }

        const blob = await response.blob();
        const downloadURL = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = downloadURL;
        link.download = fileName;

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(downloadURL), 1000);
    });
}




// ====================================
// 10. LOAD PRIVATE FILES
// ====================================

async function loadFiles() {
    clearFiles();

    if (!currentCode) return;

    const { data, error } = await supabaseClient
        .from("files")
        .select("*")
        .eq("code", currentCode)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        alert("Could not load files: " + error.message);
        return;
    }

    // Create signed URLs in parallel
    const filesWithUrls = await Promise.all(
        data.map(async (file) => {
            const { data: signedData, error: signedError } =
                await supabaseClient
                    .storage
                    .from(BUCKET)
                    .createSignedUrl(file.file_path, 3600);

            if (signedError) {
                console.error(
                    "Could not create file link:",
                    file.name,
                    signedError
                );
                return null;
            }

            return {
                ...file,
                fileURL: signedData.signedUrl
            };
        })
    );

    filesWithUrls.forEach(file => {
        if (!file) return;

        const item = document.createElement("div");
item.className = "file-item";
item.dataset.fileName = file.name.toLowerCase();

        const details = document.createElement("div");

        const name = document.createElement("p");
        name.textContent = file.name;

        const size = document.createElement("small");
        size.textContent =
            (file.file_size / 1024).toFixed(1) + " KB";

        details.append(name, size);

        if (
            file.mime_type &&
            file.mime_type.startsWith("image/")
        ) {
            const image = document.createElement("img");

            image.src = file.fileURL;
            image.alt = file.name;
            image.loading = "lazy";
            image.decoding = "async";
            image.className = "file-preview";

            details.appendChild(image);
        }

        const link = document.createElement("a");

        link.href = file.fileURL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open";

        const downloadButton = document.createElement("a");

downloadButton.href = "#";
downloadButton.onclick = (event) => {
    event.preventDefault();
    downloadFile(file.fileURL, file.name);
};
downloadButton.textContent = "Download";
downloadButton.className = "download-button";

        const deleteButton = document.createElement("button");

deleteButton.type = "button";
deleteButton.textContent = "Delete";
deleteButton.className = "delete-button";

deleteButton.addEventListener("click", () => {
    deleteFile(file);
});

item.append(details, link, downloadButton, deleteButton);

fileList.appendChild(item);
    });
}


// ====================================
// 11. CLEAR FILES
// ====================================

function clearFiles() {
    selectedFiles.forEach(url => {
        URL.revokeObjectURL(url);
    });

    selectedFiles = [];

    fileList.innerHTML = "";
}


// ====================================
// 12. COPY SHARING LINK
// ====================================

async function copyLink() {
    const link = window.location.href;

    try {
        await navigator.clipboard.writeText(link);
        alert("Droply link copied!");

    } catch (error) {
        prompt("Copy your Droply link:", link);
    }
}


// ====================================
// 13. RETURN HOME
// ====================================

function goHome() {
    document.getElementById("ownerControls").classList.add("hidden");
    clearTimeout(saveTimer);

    if (spaceChannel) {
        supabaseClient.removeChannel(spaceChannel);
        spaceChannel = null;
    }

    clearFiles();

    currentCode = "";
    textContent.value = "";
    fileInput.value = "";

    workspace.classList.add("hidden");
    home.classList.remove("hidden");

    const url = new URL(window.location.href);
    url.searchParams.delete("code");

    history.pushState({}, "", url);
}


// ====================================
// 14. AUTOMATICALLY OPEN SHARED LINK
// ====================================

window.addEventListener("DOMContentLoaded", async () => {
    try {
        await ensureSignedIn();

        const params = new URLSearchParams(
            window.location.search
        );

        const code = params.get("code");

        if (code) {
            document.getElementById("spaceCode").value = code;
            await openSpace();
        }

    } catch (error) {
        console.error("Startup error:", error);
        alert("Could not connect to Droply: " + error.message);
    }
});
function searchFiles() {
    const searchValue = document
        .getElementById("fileSearch")
        .value.toLowerCase()
        .trim();

    const items = document.querySelectorAll(".file-item");

    items.forEach(item => {
        const fileName = item.dataset.fileName || "";

        item.style.display = fileName.includes(searchValue)
            ? "flex"
            : "none";
    });
}

async function changeSpacePassword() {
    const password = prompt(
        "Enter your new password (minimum 8 characters):"
    );

    if (password === null) return;

    if (password.length < 8 || password.length > 128) {
        alert("Password must be between 8 and 128 characters.");
        return;
    }

    const confirmPassword = prompt("Confirm your new password:");

    if (confirmPassword !== password) {
        alert("Passwords do not match!");
        return;
    }

    try {
        showLoading("Updating password...");

try {
    await callSpaceFunction({
        action: "change-password",
        code: currentCode,
        password: newPassword
    });

    alert("Password updated successfully!");

} catch (error) {
    console.error(error);
    alert("Failed to update password.");

} finally {
    hideLoading();
}

        alert("Space password changed successfully!");

    } catch (error) {
        alert("Could not change password: " + error.message);
    }
}


async function deleteAllFilesOriginal() {
    const confirmed = confirm(
        "Are you sure? This will permanently delete all files in this space."
    );

    if (!confirmed) return;

    try {
        await callSpaceFunction({
            action: "delete-files",
            code: currentCode
        });

        await loadFiles();

        alert("All files deleted successfully!");

    } catch (error) {
        alert("Could not delete files: " + error.message);
    }
}
async function deleteAllFiles() {
    await withLoading("Deleting all files...", async () => {
        await deleteAllFilesOriginal();
    });
}

async function deleteEntireSpaceOriginal() {
    const confirmed = confirm(
        "WARNING: This permanently deletes the entire space, including text and files. Continue?"
    );

    if (!confirmed) return;

    const confirmationCode = prompt(
        `Type ${currentCode} to confirm deletion:`
    );

    if (confirmationCode !== currentCode) {
        alert("Space code did not match. Deletion cancelled.");
        return;
    }

    try {
        await callSpaceFunction({
            action: "delete-space",
            code: currentCode
        });

        alert("Space deleted successfully!");

        goHome();

    } catch (error) {
        alert("Could not delete space: " + error.message);
    }
}
async function deleteEntireSpace() {
    await withLoading("Deleting entire space...", async () => {
        await deleteEntireSpaceOriginal();
    });
}



document.getElementById("spaceCode").addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        openSpace();
    }
});