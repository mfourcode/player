import "./style.css";

const bucket = "https://pocedu.s3.us-east-1.amazonaws.com";
const app = document.querySelector("#app");
app.innerHTML = `
  <main class="layout">
    <section class="viewer" id="viewer" aria-label="Reprodutor"><p class="empty">Carregando mídias…</p></section>
    <aside class="sidebar"><h1>Mídias <span id="count">0</span></h1><div id="list" class="media-list"></div></aside>
  </main>
  <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
`;
window.__onproPlayerReady = true;

const viewer = document.querySelector("#viewer");
const list = document.querySelector("#list");
const notice = document.querySelector("#notice");
viewer.classList.add("cursor-hidden");
const media = [];
let selected = -1;
let advanceTimer;
let noticeTimer;
let syncPromise;
const escapeHTML = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

const db = new Promise((resolve, reject) => {
  const request = indexedDB.open("frame-media", 1);
  request.onupgradeneeded = () =>
    request.result.createObjectStore("media", { keyPath: "name" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function records(action, value) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("media", "readwrite");
    const store = transaction.objectStore("media");
    const request = action === "all" ? store.getAll() : store[action](value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function downloadBlob(url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastUpdate = 0;
    xhr.open("GET", url);
    xhr.responseType = "blob";
    xhr.timeout = 180000;
    xhr.onprogress = (event) => {
      if (Date.now() - lastUpdate < 700 && event.loaded !== event.total) return;
      lastUpdate = Date.now();
      onProgress(event.loaded, event.lengthComputable ? event.total : 0);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new Error(`Download HTTP ${xhr.status}`));
    };
    xhr.onerror = () =>
      reject(new Error(`Download rede/CORS, status ${xhr.status}`));
    xhr.ontimeout = () => reject(new Error("Download excedeu 180 segundos"));
    xhr.onabort = () => reject(new Error("Download cancelado"));
    try {
      xhr.send();
    } catch (error) {
      reject(error);
    }
  });
}

function notify(message, timeout = 4000) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  if (timeout)
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, timeout);
}

let fullscreenIntent = false;

function fullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.webkitCurrentFullScreenElement
  );
}

function requestViewerFullscreen() {
  const request =
    viewer.requestFullscreen ||
    viewer.webkitRequestFullscreen ||
    viewer.webkitRequestFullScreen;
  const video = viewer.querySelector("video");
  const requestVideoFullscreen = () => {
    if (!video?.webkitEnterFullscreen) return false;
    try {
      video.webkitEnterFullscreen();
      return true;
    } catch {}
    return false;
  };
  const unavailable = () =>
    notify("Tela cheia não é suportada por este navegador.");

  if (!request) return requestVideoFullscreen() || unavailable();
  try {
    const result = request.call(viewer);
    result?.catch(() => {
      if (!requestVideoFullscreen()) unavailable();
    });
  } catch {
    if (!requestVideoFullscreen()) unavailable();
  }
}

function updateFullscreen() {
  const active = fullscreenElement();
  if (active === viewer) fullscreenIntent = true;
  else if (active && viewer.contains(active)) {
    fullscreenIntent = true;
    requestViewerFullscreen();
  } else fullscreenIntent = false;
}

function addFullscreenButton() {
  const button = document.createElement("button");
  button.className = "fullscreen-toggle";
  button.type = "button";
  button.textContent = "⛶";
  button.setAttribute("aria-label", "Tela cheia para a playlist");
  button.addEventListener("focus", revealFullscreenButton);
  button.addEventListener("click", () => {
    if (fullscreenElement() === viewer) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    } else requestViewerFullscreen();
  });
  viewer.append(button);
}

let controlsTimer;
function revealFullscreenButton() {
  viewer.classList.remove("cursor-hidden");
  viewer.classList.add("controls-visible");
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    viewer.classList.remove("controls-visible");
    viewer.classList.add("cursor-hidden");
  }, 1800);
}

function show(index) {
  clearTimeout(advanceTimer);
  advanceTimer = null;
  selected = index;
  const item = media[index];
  if (!item) return;
  viewer.innerHTML = item.type.startsWith("video/")
    ? `<video class="media-enter" src="${item.localUrl}" autoplay muted playsinline aria-label="${escapeHTML(item.name)}"></video>`
    : `<img class="media-enter" src="${item.localUrl}" alt="${escapeHTML(item.name)}">`;
  addFullscreenButton();
  if (fullscreenIntent && fullscreenElement() !== viewer)
    requestViewerFullscreen();
  list
    .querySelectorAll(".media-item")
    .forEach((row, i) => row.classList.toggle("active", i === index));
  const video = viewer.querySelector("video");
  if (video) {
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.addEventListener("ended", () => {
      if (selected !== index) return;
      show((selected + 1) % media.length);
      render();
    });
    video.play().catch(() => {
      if (selected !== index) return;
      const button = document.createElement("button");
      button.className = "play-prompt";
      button.textContent = "Toque para reproduzir";
      button.addEventListener("click", () => {
        video.muted = true;
        video
          .play()
          .then(() => button.remove())
          .catch(() => {});
      });
      viewer.append(button);
    });
  } else {
    advanceTimer = setTimeout(() => {
      show((selected + 1) % media.length);
      render();
    }, 10000);
  }
}

function render() {
  document.querySelector("#count").textContent = media.length;
  list.innerHTML = media.length
    ? media
        .map(
          (item, i) =>
            `<div class="media-item${i === selected ? " active" : ""}" data-index="${i}" draggable="true"><button class="select-item" type="button"><span class="drag-handle" aria-hidden="true">⠿</span><span class="item-info"><strong>${escapeHTML(item.name)}</strong><small>${item.type.startsWith("video/") ? "VÍDEO" : "IMAGEM"}</small></span></button><button class="delete-item" type="button" aria-label="Excluir ${escapeHTML(item.name)}" title="Excluir">×</button></div>`,
        )
        .join("")
    : '<p class="empty-list">Nenhuma mídia salva</p>';
}

async function loadCache() {
  notify("Lendo playlist local…", 0);
  const saved = (await records("all"))
    .filter((item) => !item.removed)
    .sort((a, b) => a.order - b.order);
  media.forEach((item) => URL.revokeObjectURL(item.localUrl));
  media.splice(
    0,
    media.length,
    ...saved.map((item) => ({
      ...item,
      localUrl: URL.createObjectURL(item.blob),
    })),
  );
  selected = media.length
    ? Math.min(Math.max(selected, 0), media.length - 1)
    : -1;
  render();
  if (selected >= 0) show(selected);
  else {
    clearTimeout(advanceTimer);
    viewer.innerHTML = '<p class="empty">Nenhuma mídia disponível</p>';
  }
}

async function syncBucket() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    notify("Listando bucket…", 0);
    const existing = new Map(
      (await records("all")).map((item) => [item.name, item]),
    );
    const remote = [];
    let token;
    do {
      const query = new URLSearchParams({ "list-type": "2" });
      if (token) query.set("continuation-token", token);
      const response = await fetch(`${bucket}/?${query}`);
      if (!response.ok) throw new Error(`Bucket respondeu ${response.status}`);
      const xml = new DOMParser().parseFromString(
        await response.text(),
        "application/xml",
      );
      if (xml.querySelector("parsererror"))
        throw new Error("Resposta XML inválida");
      const contents = [...xml.getElementsByTagName("Contents")];
      for (const entry of contents) {
        const name = entry.getElementsByTagName("Key")[0]?.textContent;
        if (!name || !/\.(mp4|webm|ogg|mov|png|jpe?g|gif|webp)$/i.test(name))
          continue;
        remote.push({
          name,
          url: `${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`,
          etag: entry.getElementsByTagName("ETag")[0]?.textContent,
          type: /\.(mp4|webm|ogg|mov)$/i.test(name) ? "video/mp4" : "image/*",
        });
      }
      token =
        xml.getElementsByTagName("IsTruncated")[0]?.textContent === "true"
          ? xml.getElementsByTagName("NextContinuationToken")[0]?.textContent
          : null;
    } while (token);

    const remoteNames = new Set(remote.map((item) => item.name));
    let nextOrder =
      Math.max(-1, ...[...existing.values()].map((item) => item.order)) + 1;
    let downloaded = 0;
    for (const item of remote) {
      const old = existing.get(item.name);
      if (old?.removed) continue;
      if (old?.blob && old.etag === item.etag) continue;
      const number = ++downloaded;
      const blob = await downloadBlob(item.url, (loaded, total) => {
        const progress = total
          ? ` ${(loaded / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB`
          : ` ${(loaded / 1048576).toFixed(1)} MB`;
        notify(`Baixando ${number}/${remote.length}:${progress}`, 0);
      });
      notify(`Salvando ${number}/${remote.length} offline…`, 0);
      await records("put", {
        ...item,
        blob,
        order: old?.order ?? nextOrder++,
      });
    }
    for (const item of existing.values()) {
      if (!remoteNames.has(item.name)) await records("delete", item.name);
    }
    notify("Preparando reprodução…", 0);
    // ponytail: don't await persist(); older TV browsers can leave it pending, so cached media may still be evicted.
    try {
      navigator.storage?.persist?.().catch(() => {});
    } catch {}
    const selectedName = media[selected]?.name;
    await loadCache();
    const nextSelected = media.findIndex((item) => item.name === selectedName);
    if (nextSelected >= 0) show(nextSelected);
    notify("Sincronização concluída");
  })().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

list.addEventListener("click", async (event) => {
  const row = event.target.closest("[data-index]");
  if (!row) return;
  const index = Number(row.dataset.index);
  if (!event.target.closest(".delete-item")) {
    show(index);
    render();
    return;
  }
  const [removed] = media.splice(index, 1);
  await records("put", {
    name: removed.name,
    order: removed.order,
    removed: true,
  });
  if (!media.length) {
    clearTimeout(advanceTimer);
    selected = -1;
    viewer.innerHTML = '<p class="empty">Nenhuma mídia disponível</p>';
  } else if (index === selected) show(Math.min(index, media.length - 1));
  else if (index < selected) selected--;
  render();
});

let draggedIndex;
list.addEventListener("dragstart", (event) => {
  const row = event.target.closest("[data-index]");
  if (row) draggedIndex = Number(row.dataset.index);
});
list.addEventListener("dragover", (event) => {
  if (event.target.closest("[data-index]")) event.preventDefault();
});
list.addEventListener("drop", async (event) => {
  event.preventDefault();
  const row = event.target.closest("[data-index]");
  if (!row || draggedIndex === undefined) return;
  const selectedName = media[selected]?.name;
  const [item] = media.splice(draggedIndex, 1);
  media.splice(Number(row.dataset.index), 0, item);
  selected = media.findIndex((entry) => entry.name === selectedName);
  draggedIndex = undefined;
  await Promise.all(
    media.map((entry, order) =>
      records("put", { ...entry, order, localUrl: undefined }),
    ),
  );
  show(selected);
  render();
});

window.addEventListener("offline", () =>
  notify("Sem internet — usando mídias salvas"),
);
window.addEventListener("online", () => {
  notify("Conexão restabelecida — sincronizando");
  syncBucket().catch((error) => {
    console.error("Falha na sincronização:", error);
    notify("Sincronização falhou — mantendo mídias salvas");
  });
});
document.addEventListener("fullscreenchange", updateFullscreen);
document.addEventListener("webkitfullscreenchange", updateFullscreen);
viewer.addEventListener("mousemove", revealFullscreenButton);

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(console.error);

if (navigator.onLine) {
  syncBucket().catch(async (error) => {
    console.error("Falha ao carregar bucket:", error);
    try {
      await loadCache();
      notify(`Sincronização falhou: ${error.name}: ${error.message}`, 0);
    } catch (cacheError) {
      notify(`Cache falhou: ${cacheError.name}: ${cacheError.message}`, 0);
    }
  });
} else {
  loadCache()
    .then(() => notify("Sem internet — usando mídias salvas"))
    .catch((error) =>
      notify(`Cache falhou: ${error.name}: ${error.message}`, 0),
    );
}
