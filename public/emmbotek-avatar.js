/**
 * Emmbotek - animowany awatar eMMy AI.
 *
 * Pozy wyizolowane z arkuszy maskotki (40 sztuk) sa zmapowane w avatars/manifest.json
 * na 12 emocji z briefu. Animacja ma dwie warstwy:
 *   1. klatki (podmiana pozy w petli - "prawdziwa" animacja postaci),
 *   2. ruch CSS (bujanie, przechylenie, podskok) dopasowany do emocji.
 *
 * Cykl zycia emocji: emocja -> animacja -> powrot do NEUTRAL (sekcja 16 briefu).
 * Przy prefers-reduced-motion obie warstwy sa wylaczone - zostaje statyczna poza.
 */
(function (global) {
  'use strict';

  var REDUCED = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)');

  function EmmbotekAvatar(options) {
    options = options || {};
    this.root = options.element;
    this.basePath = options.basePath || 'avatars/';
    this.variant = options.variant || 'small/';
    this.manifest = null;
    this.emotion = 'NEUTRAL';
    this.frameIndex = 0;
    this.timer = null;
    this.holdTimer = null;
    this.idleTimer = null;
    this.images = {};
    this.ready = false;
    this.onIdleSleep = options.onIdleSleep || null;
    this.idleAfterMs = options.idleAfterMs || 90000;

    this.layer = global.document.createElement('div');
    this.layer.className = 'emmbotek__stage';
    this.img = global.document.createElement('img');
    this.img.className = 'emmbotek__frame';
    this.img.alt = '';
    this.img.setAttribute('aria-hidden', 'true');
    this.img.decoding = 'async';
    this.layer.appendChild(this.img);
    if (this.root) this.root.appendChild(this.layer);
  }

  EmmbotekAvatar.prototype.reducedMotion = function () {
    return !!(REDUCED && REDUCED.matches);
  };

  EmmbotekAvatar.prototype.load = function (manifestUrl) {
    var self = this;
    return fetch(manifestUrl || this.basePath + 'manifest.json')
      .then(function (response) { return response.json(); })
      .then(function (manifest) {
        self.manifest = manifest;
        self.ready = true;
        self.preload(['NEUTRAL', 'GREETING', 'THINKING']);
        self.set(manifest.defaultEmotion || 'NEUTRAL', { immediate: true });
        return manifest;
      })
      .catch(function () {
        // brak manifestu nie moze wywrocic widgetu - awatar po prostu sie nie pojawi
        self.ready = false;
        if (self.root) self.root.classList.add('emmbotek--unavailable');
      });
  };

  EmmbotekAvatar.prototype.definition = function (emotion) {
    if (!this.manifest) return null;
    return this.manifest.emotions[emotion]
      || this.manifest.extraStates[emotion]
      || this.manifest.emotions[this.manifest.fallbackEmotion || 'NEUTRAL'];
  };

  EmmbotekAvatar.prototype.frameUrl = function (file) {
    return this.basePath + this.variant + file;
  };

  EmmbotekAvatar.prototype.preload = function (emotions) {
    var self = this;
    (emotions || []).forEach(function (emotion) {
      var definition = self.definition(emotion);
      if (!definition) return;
      definition.frames.forEach(function (file) {
        if (self.images[file]) return;
        var image = new global.Image();
        image.src = self.frameUrl(file);
        self.images[file] = image;
      });
    });
  };

  /** Preload wszystkich pozostalych emocji - odpalany po pierwszym otwarciu okna. */
  EmmbotekAvatar.prototype.preloadAll = function () {
    if (!this.manifest) return;
    this.preload(Object.keys(this.manifest.emotions));
  };

  EmmbotekAvatar.prototype.showFrame = function (file) {
    if (!file) return;
    this.img.src = this.frameUrl(file);
  };

  /**
   * Ustawia emocje. Po czasie `hold` awatar wraca do NEUTRAL.
   * @param {string} emotion
   * @param {{immediate?: boolean, hold?: number}} options
   */
  EmmbotekAvatar.prototype.set = function (emotion, options) {
    options = options || {};
    if (!this.ready) return;

    var definition = this.definition(emotion);
    if (!definition) return;

    var resolved = this.manifest.emotions[emotion] ? emotion
      : (this.manifest.extraStates[emotion] ? emotion : (this.manifest.fallbackEmotion || 'NEUTRAL'));

    this.stopTimers();
    this.emotion = resolved;
    this.frameIndex = 0;
    this.preload([resolved]);

    if (this.root) {
      this.root.setAttribute('data-emotion', resolved);
      this.root.setAttribute('data-motion', this.reducedMotion() ? 'still' : (definition.motion || 'bob'));
    }
    this.showFrame(definition.frames[0]);

    if (this.reducedMotion() || definition.frames.length < 2) {
      this.scheduleReturn(definition, options);
      return;
    }

    var self = this;
    var interval = Math.max(180, 1000 / (definition.fps || 1));
    this.timer = global.setInterval(function () {
      self.frameIndex = (self.frameIndex + 1) % definition.frames.length;
      self.showFrame(definition.frames[self.frameIndex]);
    }, interval);

    this.scheduleReturn(definition, options);
  };

  EmmbotekAvatar.prototype.scheduleReturn = function (definition, options) {
    var hold = options.hold != null ? options.hold : definition.hold;
    if (!hold || this.emotion === 'NEUTRAL') { this.armIdle(); return; }
    var self = this;
    this.holdTimer = global.setTimeout(function () { self.set('NEUTRAL'); }, hold);
  };

  /** Po dluzszej bezczynnosci maskotka przysypia (dodatkowy stan spoza 12 emocji). */
  EmmbotekAvatar.prototype.armIdle = function () {
    if (this.reducedMotion() || !this.idleAfterMs) return;
    var self = this;
    global.clearTimeout(this.idleTimer);
    this.idleTimer = global.setTimeout(function () {
      if (self.emotion === 'NEUTRAL') {
        self.set('SLEEPY');
        if (self.onIdleSleep) self.onIdleSleep();
      }
    }, this.idleAfterMs);
  };

  EmmbotekAvatar.prototype.wake = function () {
    global.clearTimeout(this.idleTimer);
    if (this.emotion === 'SLEEPY') this.set('NEUTRAL');
  };

  EmmbotekAvatar.prototype.thinking = function () {
    this.set('THINKING', { hold: 0 });
  };

  EmmbotekAvatar.prototype.stopTimers = function () {
    if (this.timer) { global.clearInterval(this.timer); this.timer = null; }
    if (this.holdTimer) { global.clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.idleTimer) { global.clearTimeout(this.idleTimer); this.idleTimer = null; }
  };

  EmmbotekAvatar.prototype.destroy = function () {
    this.stopTimers();
    if (this.layer && this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
  };

  global.EmmbotekAvatar = EmmbotekAvatar;
}(typeof window !== 'undefined' ? window : this));
