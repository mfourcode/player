(function () {
  function startLegacy() {
  var root = document.documentElement;
  root.className += " legacy";
  var app = document.getElementById("app");
  app.innerHTML = '<main class="layout"><section class="viewer" id="viewer"><p>Carregando playlist…</p></section></main><div id="notice" class="legacy-notice">Preparando playlist…</div>';

  var bucket = "https://pocedu.s3.us-east-1.amazonaws.com";
  var stateKey = "__playlist_state__";
  var viewer = document.getElementById("viewer");
  viewer.className += " cursor-hidden";
  viewer.style.cursor = "none";
  var notice = document.getElementById("notice");
  var media = [];
  var current = -1;
  var imageTimer = null;
  var activeUrl = null;
  var database = null;
  var objectUrl = window.URL || window.webkitURL;
  var online = navigator.onLine !== false;
  var syncing = false;
  var noticeTimer = null;
  var fullscreenIntent = false;
  var controlsTimer = null;

  function message(text, persistent) {
    if (noticeTimer) window.clearTimeout(noticeTimer);
    notice.textContent = text;
    notice.style.display = "block";
    notice.style.position = "fixed";
    notice.style.left = "12px";
    notice.style.bottom = "12px";
    notice.style.zIndex = "9999";
    notice.style.padding = "10px";
    notice.style.color = "#fff";
    notice.style.backgroundColor = "#222";
    notice.style.font = "16px Arial, sans-serif";
    noticeTimer = null;
    if (!persistent) noticeTimer = window.setTimeout(function () { notice.style.display = "none"; }, 4000);
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement;
  }

  function requestPlayerFullscreen() {
    var request = viewer.requestFullscreen || viewer.webkitRequestFullscreen || viewer.webkitRequestFullScreen;
    var video = viewer.getElementsByTagName("video")[0];
    function requestVideoFullscreen() {
      if (!video || !video.webkitEnterFullscreen) return false;
      try { video.webkitEnterFullscreen(); return true; } catch (error) { return false; }
    }
    function unavailable() { message("Tela cheia não é suportada por este navegador."); }
    if (!request) return requestVideoFullscreen() || unavailable();
    try {
      var result = request.call(viewer);
      if (result && result.catch) result.catch(function () { if (!requestVideoFullscreen()) unavailable(); });
    } catch (error) {
      if (!requestVideoFullscreen()) unavailable();
    }
  }

  function fullscreenChanged() {
    var active = fullscreenElement();
    if (active === viewer) fullscreenIntent = true;
    else if (active && viewer.contains(active)) {
      fullscreenIntent = true;
      requestPlayerFullscreen();
    } else fullscreenIntent = false;
  }

  function addFullscreenButton() {
    var button = document.createElement("button");
    button.className = "fullscreen-toggle";
    button.setAttribute("type", "button");
    button.setAttribute("aria-label", "Tela cheia para a playlist");
    button.innerHTML = "&#x26F6;";
    button.onfocus = revealFullscreenButton;
    button.onclick = function () {
      if (fullscreenElement() === viewer) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
      } else requestPlayerFullscreen();
    };
    viewer.appendChild(button);
  }

  function revealFullscreenButton() {
    viewer.className = viewer.className.replace(/\s*cursor-hidden/g, "");
    viewer.style.cursor = "";
    if (viewer.className.indexOf("controls-visible") < 0) viewer.className += " controls-visible";
    if (controlsTimer) window.clearTimeout(controlsTimer);
    controlsTimer = window.setTimeout(function () {
      viewer.className = viewer.className.replace(/\s*controls-visible/g, "");
      if (viewer.className.indexOf("cursor-hidden") < 0) viewer.className += " cursor-hidden";
      viewer.style.cursor = "none";
    }, 1800);
  }

  function showPlaybackPrompt(video) {
    var button = document.createElement("button");
    button.className = "play-prompt";
    button.setAttribute("type", "button");
    button.innerHTML = "Reproduzir";
    button.onclick = function () {
      video.muted = true;
      var attempt = video.play();
      if (attempt && attempt.then) attempt.then(function () { if (button.parentNode) button.parentNode.removeChild(button); });
    };
    viewer.appendChild(button);
  }

  function dbOpen(done) {
    var idb = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB;
    if (!idb) {
      message("Armazenamento offline indisponível.", true);
      return;
    }
    var request;
    try {
      request = idb.open("frame-media", 1);
    } catch (error) {
      message("Falha ao abrir o armazenamento offline.", true);
      return;
    }
    var settled = false;
    var openTimer = window.setTimeout(function () {
      if (!settled) message("Abertura do armazenamento offline demorou demais.", true);
    }, 10000);
    request.onupgradeneeded = function () {
      if (!request.result.objectStoreNames.length) {
        request.result.createObjectStore("media", { keyPath: "name" });
      }
    };
    request.onsuccess = function () {
      settled = true;
      window.clearTimeout(openTimer);
      database = request.result;
      done();
    };
    request.onerror = function () {
      settled = true;
      window.clearTimeout(openTimer);
      message("Falha ao abrir o armazenamento offline.", true);
    };
    request.onblocked = function () { message("Armazenamento offline ocupado por outra janela.", true); };
  }

  function getRecord(name, done) {
    var request = database.transaction(["media"], "readonly").objectStore("media").get(name);
    request.onsuccess = function () { done(request.result); };
    request.onerror = function () { done(null); };
  }

  function saveRecord(record, done) {
    var transaction = database.transaction(["media"], "readwrite");
    var request = transaction.objectStore("media").put(record);
    var error = null;
    var settled = false;
    function finish(failure) {
      if (settled) return;
      settled = true;
      done(failure);
    }
    request.onerror = function (event) {
      error = request.error || (event.target && event.target.error);
    };
    transaction.oncomplete = function () {
      finish(null);
    };
    transaction.onerror = function (event) {
      error = request.error || transaction.error || (event.target && event.target.error);
    };
    transaction.onabort = function (event) {
      error = error || transaction.error || (event.target && event.target.error);
      finish(error || new Error("Transação IndexedDB abortada"));
    };
  }

  function getRecords(done) {
    var result = [];
    var request = database.transaction(["media"], "readonly").objectStore("media").openCursor();
    request.onsuccess = function () {
      var cursor = request.result;
      if (!cursor) return done(result);
      var row = cursor.value;
      result.push({ name: row.name, etag: row.etag, type: row.type, order: row.order, removed: row.removed, hasBlob: !!row.blob, keys: row.keys });
      cursor.continue();
    };
    request.onerror = function () { done(result); };
  }

  function clearMediaCache(done) {
    var transaction = database.transaction(["media"], "readwrite");
    var store = transaction.objectStore("media");
    var request = store.openCursor();
    var settled = false;
    request.onsuccess = function () {
      var cursor = request.result;
      if (!cursor) return;
      if (cursor.value.name !== stateKey && cursor.value.blob) {
        delete cursor.value.blob;
        cursor.update(cursor.value);
      }
      cursor.continue();
    };
    transaction.oncomplete = function () { settled = true; done(); };
    transaction.onerror = transaction.onabort = function () {
      if (settled) return;
      settled = true;
      done(transaction.error || new Error("Não foi possível limpar o cache offline"));
    };
  }

  function parseEntry(node) {
    var key = node.getElementsByTagName("Key")[0];
    if (!key) return null;
    var name = key.textContent;
    if (!/\.(mp4|webm|ogg|mov|png|jpe?g|gif|webp)$/i.test(name)) return null;
    var etag = node.getElementsByTagName("ETag")[0];
    var segments = name.split("/");
    var i;
    for (i = 0; i < segments.length; i++) segments[i] = encodeURIComponent(segments[i]);
    var video = /\.(mp4|webm|ogg|mov)$/i.test(name);
    var type = /\.webm$/i.test(name) ? "video/webm" : (/\.ogg$/i.test(name) ? "video/ogg" : (/\.mov$/i.test(name) ? "video/quicktime" : (video ? "video/mp4" : "image/*")));
    return { name: name, url: bucket + "/" + segments.join("/"), etag: etag ? etag.textContent : "", type: type };
  }

  function listBucket(token, all, done) {
    var xhr = new XMLHttpRequest();
    var url = bucket + "/?list-type=2" + (token ? "&continuation-token=" + encodeURIComponent(token) : "");
    try { xhr.open("GET", url, true); }
    catch (error) { return done(error); }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 300) return done(new Error("HTTP " + xhr.status + " " + xhr.statusText));
      var xml = new DOMParser().parseFromString(xhr.responseText, "application/xml");
      if (xml.getElementsByTagName("parsererror").length) return done(new Error("Resposta XML inválida"));
      var entries = xml.getElementsByTagName("Contents");
      var i;
      for (i = 0; i < entries.length; i++) {
        var item = parseEntry(entries[i]);
        if (item) all.push(item);
      }
      var truncated = xml.getElementsByTagName("IsTruncated")[0];
      var next = xml.getElementsByTagName("NextContinuationToken")[0];
      if (truncated && truncated.textContent === "true" && next) return listBucket(next.textContent, all, done);
      done(null, all);
    };
    xhr.onerror = function () { done(new Error("XHR status " + xhr.status + " (rede/CORS)")); };
    try { xhr.send(); } catch (error) { done(error); }
  }

  function download(item, done) {
    var xhr = new XMLHttpRequest();
    try {
      xhr.open("GET", item.url, true);
      xhr.responseType = "blob";
      if (xhr.responseType !== "blob") return done(new Error("XHR não suporta responseType=blob"));
    } catch (error) {
      return done(error);
    }
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) {
        return done(new Error("HTTP " + xhr.status + " " + xhr.statusText));
      }
      var blob = xhr.response;
      if (!blob || typeof blob.size !== "number") return done(new Error("XHR não retornou Blob"));
      var responseType = xhr.getResponseHeader("Content-Type");
      try {
        if (responseType && blob.type !== responseType) blob = new Blob([blob], { type: responseType });
      } catch (error) {
        return done(error);
      }
      item.blob = blob;
      done(null, item);
    };
    xhr.onerror = function () {
      done(new Error("XHR status " + xhr.status + " (rede/CORS)"));
    };
    try { xhr.send(); } catch (error) { done(error); }
  }

  function sync(items, done) {
    var index = 0;
    var nextOrder = 0;
    clearMediaCache(function (clearError) {
      if (clearError) return done(clearError);
      getRecords(function (saved) {
        var byName = {};
        var i;
        for (i = 0; i < saved.length; i++) {
          byName[saved[i].name] = saved[i];
          if (saved[i].order >= nextOrder) nextOrder = saved[i].order + 1;
        }
        function next() {
          if (index >= items.length) return removeMissing(items, done);
          var item = items[index++];
          var old = byName[item.name];
          if (old && old.removed) {
            return next();
          }
          message("Baixando playlist " + index + "/" + items.length, true);
          download(item, function (error, downloaded) {
            if (error) return done(error);
            downloaded.order = old ? old.order : nextOrder++;
            message("Salvando offline " + index + "/" + items.length, true);
            saveRecord(downloaded, function (saveError) {
              if (saveError) return done(saveError);
              next();
            });
          });
        }
        next();
      });
    });
  }

  function removeMissing(items, done) {
    var valid = {};
    var i;
    for (i = 0; i < items.length; i++) valid[items[i].name] = true;
    getRecords(function (saved) {
      var index = 0;
      function next() {
        if (index >= saved.length) return done();
        var row = saved[index++];
        if (row.name === stateKey) return next();
        if (valid[row.name]) return next();
        var request = database.transaction(["media"], "readwrite").objectStore("media").delete(row.name);
        request.onsuccess = next;
        request.onerror = next;
      }
      next();
    });
  }

  function play(index) {
    if (imageTimer) window.clearTimeout(imageTimer);
    imageTimer = null;
    if (activeUrl) objectUrl.revokeObjectURL(activeUrl);
    activeUrl = null;
    if (!media.length) {
      message("A playlist está vazia.");
      return;
    }
    while (viewer.firstChild) viewer.removeChild(viewer.firstChild);
    current = index;
    var item = media[current];
    getRecord(item.name, function (record) {
      if (!record || !record.blob) {
        message("Mídia ainda não salva para uso offline.");
        return;
      }
      var src;
      try { src = objectUrl.createObjectURL(record.blob); activeUrl = src; }
      catch (error) { message("Este navegador não consegue reproduzir a mídia salva."); return; }
      if (item.type.indexOf("video/") === 0) {
        var video = document.createElement("video");
        video.setAttribute("autoplay", "autoplay");
        video.setAttribute("muted", "muted");
        video.setAttribute("playsinline", "playsinline");
        video.muted = true;
        video.src = src;
        video.onended = function () { if (current === index) play((current + 1) % media.length); };
        video.onerror = function () {
          message("A TV não consegue decodificar este vídeo.");
        };
        video.onwebkitbeginfullscreen = function () { fullscreenIntent = true; requestPlayerFullscreen(); };
        viewer.appendChild(video);
        try {
          var attempt = video.play();
          if (attempt && attempt.catch) attempt.catch(function () { showPlaybackPrompt(video); });
        } catch (error) {
          showPlaybackPrompt(video);
        }
      } else {
        var image = document.createElement("img");
        image.alt = item.name;
        image.src = src;
        viewer.appendChild(image);
        imageTimer = window.setTimeout(function () { play((current + 1) % media.length); }, 10000);
      }
      addFullscreenButton();
      if (fullscreenIntent && fullscreenElement() !== viewer) requestPlayerFullscreen();
    });
  }

  function loadSaved(done) {
    getRecords(function (saved) {
      media = [];
      var i, state = null, allowed = {};
      for (i = 0; i < saved.length; i++) if (saved[i].name === stateKey) state = saved[i];
      if (state && state.keys) for (i = 0; i < state.keys.length; i++) allowed[state.keys[i]] = true;
      for (i = 0; i < saved.length; i++) {
        if (state && saved[i].hasBlob && !saved[i].removed && allowed[saved[i].name]) media.push({ name: saved[i].name, type: saved[i].type, order: saved[i].order });
      }
      media.sort(function (a, b) { return a.order - b.order; });
      if (done) done();
      if (media.length) play(0);
      else message("Conecte a TV para sincronizar a playlist.");
    });
  }

  function synchronize() {
    if (syncing || !online) return;
    syncing = true;
    message("Sincronizando playlist…", true);
    listBucket(null, [], function (error, items) {
      if (error) {
        syncing = false;
        return loadSaved(function () { message("Falha ao consultar a playlist online.", true); });
      }
      sync(items, function (syncError) {
        syncing = false;
        if (syncError) {
          return loadSaved(function () { message("Falha ao sincronizar a playlist.", true); });
        }
        getRecords(function (saved) {
          var ordered = [], keys = [], i;
          for (i = 0; i < saved.length; i++) {
            if (saved[i].name !== stateKey && saved[i].hasBlob && !saved[i].removed) ordered.push(saved[i]);
          }
          ordered.sort(function (a, b) { return a.order - b.order; });
          for (i = 0; i < ordered.length; i++) keys.push(ordered[i].name);
          saveRecord({ name: stateKey, keys: keys }, function (stateError) {
            if (stateError) return loadSaved(function () { message("Não foi possível salvar a playlist offline."); });
            loadSaved(function () { message("Playlist sincronizada."); });
          });
        });
      });
    });
  }

  function connectionChanged() {
    var nowOnline = navigator.onLine !== false;
    if (nowOnline === online) return;
    online = nowOnline;
    if (online) {
      message("Conexão restabelecida. Sincronizando playlist…");
      synchronize();
    } else {
      message("Sem internet. Continuando com mídias salvas.");
    }
  }

  function listen(eventName, handler) {
    if (window.addEventListener) window.addEventListener(eventName, handler, false);
    else if (window.attachEvent) window.attachEvent("on" + eventName, handler);
  }

  listen("online", connectionChanged);
  listen("offline", connectionChanged);
  viewer.onmousemove = revealFullscreenButton;
  if (document.addEventListener) {
    document.addEventListener("fullscreenchange", fullscreenChanged, false);
    document.addEventListener("webkitfullscreenchange", fullscreenChanged, false);
  }
  // ponytail: 5s polling fallback for TVs without online/offline events; status may lag by 5s.
  window.setInterval(connectionChanged, 5000);

  dbOpen(function () {
    if (online) synchronize();
    else loadSaved(function () { message("Sem internet. Usando playlist salva."); });
  });
  }

  if ("noModule" in document.createElement("script")) {
    window.setTimeout(function () {
      if (!window.__onproPlayerReady) startLegacy();
    }, 5000);
  } else {
    startLegacy();
  }
})();
