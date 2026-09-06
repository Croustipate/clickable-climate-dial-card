class ClimatisationMoletteCard extends HTMLElement {
  static getStubConfig(hass) {
    const entity = hass && Object.keys(hass.states).find((e) => e.startsWith('climate.'));
    return { entity: entity || 'climate.your_thermostat' };
  }

  setConfig(config) {
    if (!config || !config.entity || !config.entity.startsWith('climate.')) {
      throw new Error('You need to define a "climate." entity');
    }
    this._config = config;
    this._funcIndex = 0;
    this._dragging = false;
    this._lastCallTs = 0;
    this._pendingValue = null;
    this._throttleTimer = null;
    this._revertTimer = null;
    this._lastActiveMode = null;
    this._iconHoldTimer = null; this._iconLongPressed = false;
    if (!this._built) this._build();
  }

  set hass(hass) {
    this._hass = hass;
    // remember the last non-off hvac mode so tapping the icon while off knows
    // what to switch back to, regardless of which function tab is on screen
    const st = hass.states[this._config.entity];
    if (st && st.state && st.state !== 'off') this._lastActiveMode = st.state;
    if (!this._dragging) this._updateValueFromHass();
    this._render();
  }

  getCardSize() { return 5; }

  disconnectedCallback() {
    if (this._revertTimer) { clearTimeout(this._revertTimer); this._revertTimer = null; }
    if (this._throttleTimer) { clearTimeout(this._throttleTimer); this._throttleTimer = null; }
    if (this._iconHoldTimer) { clearTimeout(this._iconHoldTimer); this._iconHoldTimer = null; }
  }

  get _functions() {
    return [
      {
        key: 'temp',
        label: 'Température',
        icon: 'mdi:thermometer',
        unit: '°C',
        min: 16,
        max: 30,
        step: 0.5,
        decimals: 1,
        colorFrom: '#ffd54f',
        colorTo: '#ff6f00',
        getValue: (hass) => {
          const st = hass.states[this._config.entity];
          const v = st && st.attributes && st.attributes.temperature;
          return typeof v === 'number' ? v : parseFloat(v) || 21;
        },
        setValue: (hass, v) => hass.callService('climate', 'set_temperature', {
          entity_id: this._config.entity, temperature: v
        })
      },
      {
        key: 'vitesse',
        label: 'Vitesse',
        icon: 'mdi:fan',
        unit: '',
        min: 1,
        max: 5,
        step: 1,
        decimals: 0,
        colorFrom: '#69f0ae',
        colorTo: '#ff3d00',
        getValue: (hass) => {
          const st = hass.states[this._config.entity];
          const fm = st && st.attributes && st.attributes.fan_mode;
          const n = parseInt(fm, 10);
          return isNaN(n) ? 1 : n;
        },
        setValue: (hass, v) => hass.callService('climate', 'set_fan_mode', {
          entity_id: this._config.entity, fan_mode: String(Math.round(v))
        })
      },
      {
        key: 'mode',
        label: 'Mode',
        icon: 'mdi:tune-variant',
        unit: '',
        min: 0,
        max: 5,
        step: 1,
        decimals: 0,
        modes: ['off', 'dry', 'fan_only', 'cool', 'heat', 'heat_cool'],
        modeLabels: ['Off', 'Sec', 'Vent.', 'Froid', 'Chaud', 'Auto'],
        modeIcons: ['mdi:power', 'mdi:water-percent', 'mdi:weather-windy', 'mdi:snowflake', 'mdi:fire', 'mdi:autorenew'],
        colorFrom: '#40c4ff',
        colorTo: '#ff5252',
        getValue: (hass) => {
          const st = hass.states[this._config.entity];
          const m = st && st.state;
          const idx = ['off', 'dry', 'fan_only', 'cool', 'heat', 'heat_cool'].indexOf(m);
          return idx < 0 ? 0 : idx;
        },
        setValue: (hass, v) => hass.callService('climate', 'set_hvac_mode', {
          entity_id: this._config.entity,
          hvac_mode: ['off', 'dry', 'fan_only', 'cool', 'heat', 'heat_cool'][Math.round(v)]
        })
      }
    ];
  }

  _updateValueFromHass() {
    if (!this._hass) return;
    const fn = this._functions[this._funcIndex];
    if (!fn) return;
    const v = fn.getValue(this._hass);
    if (typeof v === 'number' && !isNaN(v)) {
      this._value = v;
    }
  }

  _build() {
    this._built = true;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display:block; }
        .card {
          background: var(--ha-card-background, var(--card-background-color, radial-gradient(circle, #3a3a3a, #1c1c1c)));
          border-radius: var(--ha-card-border-radius, 18px);
          padding: 18px 12px 20px;
          box-shadow: 0 8px 24px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05);
          display: flex;
          flex-direction: column;
          align-items: center;
          user-select: none;
          -webkit-user-select: none;
        }
        svg { touch-action: none; display:block; max-width: 100%; height: auto; }
        .center-value {
          font-size: 44px;
          font-weight: 700;
          fill: var(--primary-text-color, #fff);
          font-family: Roboto, Arial, sans-serif;
          text-shadow: 0 2px 6px rgba(0,0,0,.6);
        }
        .center-unit {
          font-size: 16px;
          fill: var(--secondary-text-color, #aaa);
          font-family: Roboto, Arial, sans-serif;
        }
        .center-label {
          font-size: 15px;
          font-weight: 600;
          fill: #eee;
          font-family: Roboto, Arial, sans-serif;
          letter-spacing: .3px;
        }
        .zone-label {
          font-size: 11px;
          font-family: Roboto, Arial, sans-serif;
          font-weight: 600;
        }
        .tick { stroke: var(--divider-color, #555); stroke-width: 2; }
        .dots { display:flex; gap:7px; margin-top:10px; }
        .dot {
          width:7px; height:7px; border-radius:50%;
          background: var(--divider-color, #555);
          transition: background .2s, transform .2s;
        }
        .dot.active {
          background: var(--primary-text-color, #fff);
          transform: scale(1.3);
        }
        /* glossy sphere badge, same recipe as the Intensité / kVA icons */
        .icon-badge {
          position: relative;
          overflow: hidden;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
          background: radial-gradient(circle at 32% 28%, #3a3a3a 0%, #0a0a0a 72%);
          box-shadow: inset 0 1px 1px rgba(255,255,255,.35), inset 0 -3px 5px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.35), 0 3px 8px rgba(0,0,0,.5);
          transition: box-shadow .25s ease;
        }
        .icon-badge::before {
          content: "";
          position: absolute;
          top: 6%;
          left: 14%;
          width: 72%;
          height: 40%;
          background: linear-gradient(180deg, rgba(255,255,255,.4), rgba(255,255,255,0));
          border-radius: 50%;
          pointer-events: none;
        }
        .icon-badge ha-icon {
          --mdc-icon-size: 24px;
          transition: color .25s ease, filter .25s ease;
          transform-origin: center;
        }
        @keyframes iconSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes iconPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.14); }
        }
        .icon-badge ha-icon.anim-spin {
          animation-name: iconSpin;
          animation-duration: 1.6s;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .icon-badge ha-icon.anim-pulse {
          animation: iconPulse 1.7s ease-in-out infinite;
        }
        /* invites a tap when the clim is off: a soft neutral ring pulsing outward,
           distinct from the colored glow used for active modes */
        .icon-badge.tap-on {
          cursor: pointer;
          animation: badgeInvite 2s ease-in-out infinite;
        }
        @keyframes badgeInvite {
          0%, 100% { box-shadow: inset 0 1px 1px rgba(255,255,255,.35), inset 0 -3px 5px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.35), 0 3px 8px rgba(0,0,0,.5), 0 0 0 0 rgba(255,255,255,.22); }
          50% { box-shadow: inset 0 1px 1px rgba(255,255,255,.35), inset 0 -3px 5px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.35), 0 3px 8px rgba(0,0,0,.5), 0 0 0 7px rgba(255,255,255,.08); }
        }
      </style>
      <div class="card">
        <div class="icon-badge" id="iconBadge"><ha-icon id="iconEl"></ha-icon></div>
        <svg id="dial" width="300" height="300" viewBox="0 0 300 300"></svg>
        <div class="dots" id="dots">
          <div class="dot"></div><div class="dot"></div><div class="dot"></div>
        </div>
      </div>
    `;
    this._svg = root.getElementById('dial');
    this._dotsEl = root.getElementById('dots');
    this._iconBadge = root.getElementById('iconBadge');
    this._iconEl = root.getElementById('iconEl');
    this._attachPointerHandlers();
    this._iconBadge.addEventListener('click', (evt) => { evt.preventDefault(); evt.stopPropagation(); if (this._iconLongPressed) { this._iconLongPressed = false; return; } this._onIconBadgeTap(); }); this._iconBadge.addEventListener('pointerdown', (evt) => { this._iconLongPressed = false; if (this._iconHoldTimer) clearTimeout(this._iconHoldTimer); this._iconHoldTimer = setTimeout(() => { this._iconLongPressed = true; this._iconHoldTimer = null; this._onIconBadgeHold(); }, 550); }); const cancelIconHold = () => { if (this._iconHoldTimer) { clearTimeout(this._iconHoldTimer); this._iconHoldTimer = null; } }; this._iconBadge.addEventListener('pointerup', cancelIconHold); this._iconBadge.addEventListener('pointerleave', cancelIconHold); this._iconBadge.addEventListener('pointercancel', cancelIconHold);
  }

  // tapping the icon while showing Température and the clim is off turns it back
  // on: the main screen's icon becomes a quick "power on" shortcut instead of
  // doing nothing. This integration treats "off" as a real power state: calling
  // set_hvac_mode alone while off does NOT switch the unit on (verified live,
  // the state stayed "off"), only climate.turn_on does, and the device then
  // resumes whatever hvac mode it was last running in on its own.
  _onIconBadgeTap() {
    if (!this._hass) return;
    const fn = this._functions[this._funcIndex];
    if (!fn || fn.key !== 'temp') return;
    const st = this._hass.states[this._config.entity];
    const curMode = st && st.state;
    if (curMode && curMode !== 'off') return; // already on, icon tap is a no-op
    this._hass.callService('climate', 'turn_on', {
      entity_id: this._config.entity
    });
    if (this._revertTimer) { clearTimeout(this._revertTimer); this._revertTimer = null; }
  }

  _onIconBadgeHold() { if (!this._hass) return; this._hass.callService('climate', 'turn_off', { entity_id: this._config.entity }); if (this._revertTimer) { clearTimeout(this._revertTimer); this._revertTimer = null; } }

  // ---- geometry helpers ----
  // clock-degrees: 0 = north(top), increases clockwise
  static _pointFor(cx, cy, r, clockDeg) {
    const rad = (clockDeg * Math.PI) / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  }

  get _arc() {
    // 270 degree sweep, 90 degree gap centered at bottom (180)
    return { start: 225, sweep: 270 };
  }

  _valueToClockDeg(fn, value) {
    const f = Math.max(0, Math.min(1, (value - fn.min) / (fn.max - fn.min)));
    const { start, sweep } = this._arc;
    return (start + f * sweep) % 360;
  }

  _clockDegToFraction(clockDeg) {
    const { start, sweep } = this._arc;
    // normalize so start=0
    let rel = (clockDeg - start + 360) % 360;
    if (rel > sweep) {
      // in the gap: clamp to nearer end
      const dStart = 360 - rel; // wrap back to 0
      const dEnd = rel - sweep;
      rel = dEnd < dStart ? sweep : 0;
    }
    return rel / sweep;
  }

  _render() {
    if (!this._svg || !this._hass) return;
    const fn = this._functions[this._funcIndex];
    if (!fn) return;
    const value = this._value != null ? this._value : fn.getValue(this._hass);
      const cx = 150, cy = 150, rOuter = 112, rZone = 96, rTick = 84, rHandle = 112, rCenter = 66;
    const { start, sweep } = this._arc;
    const valClock = this._valueToClockDeg(fn, value);

    // mode-driven color for the temperature digits/icon: red-orange when
    // heating, blue when cooling; intensity scales with how extreme the set-point is.
    // The ring/handle/label follow the same hue (paler tone -> saturated tone) so the
    // whole dial reads as one coherent color, not just the digits.
    let tempColor = null;
    let effColorFrom = fn.colorFrom;
    let effColorTo = fn.colorTo;
    let isOffMode = false;
    let progOpacity = 0.95;
    let useProgGlow = true;
    if (fn.key === 'temp') {
      const climateSt = this._hass.states[this._config.entity];
      const curMode = climateSt && climateSt.state;
      isOffMode = !curMode || curMode === 'off';
      tempColor = this._tempTextColor(curMode, value, fn.min, fn.max);
      const grad = this._tempModeGradient(curMode);
      effColorFrom = grad.from;
      effColorTo = grad.to;
      if (isOffMode) {
        // clim éteinte : l'anneau ne doit surtout pas ressembler à un mode actif,
        // couleur neutre grise (pas jaune/orange, pas une teinte de mode) + intensité
        // réduite (pas de glow, opacité basse) pour qu'il n'y ait aucune équivoque
        progOpacity = 0.35;
        useProgGlow = false;
      }
    }

    let svg = '';

    // gradient + glow + gloss defs
    svg += `<defs>
      <linearGradient id="prog" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${effColorFrom}"/>
        <stop offset="100%" stop-color="${effColorTo}"/>
      </linearGradient>
      <radialGradient id="centerGrad" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#3a3a3a"/>
        <stop offset="100%" stop-color="#111"/>
      </radialGradient>
      <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="4.5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="softshadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.5"/>
      </filter>
      <linearGradient id="topGloss" gradientUnits="userSpaceOnUse" x1="${cx - 72}" y1="0" x2="${cx + 72}" y2="0">
        <stop offset="0%" stop-color="#fff" stop-opacity="0"/>
        <stop offset="50%" stop-color="#fff" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="centerSheen" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="handleSheen" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="centerClip">
        <circle cx="${cx}" cy="${cy}" r="${rCenter}"/>
      </clipPath>
    </defs>`;

    // background ring (full, faint)
    svg += this._ringPath(cx, cy, rOuter, 0, 360, '#000', 10, 0.35);

    // active-arc background track
    svg += this._ringPath(cx, cy, rOuter, start, sweep, '#000', 10, 0.55);

    // colored zone segments (decorative, thin, behind progress)
    if (fn.modes) {
      const seg = sweep / fn.modes.length;
      fn.modes.forEach((m, i) => {
        const segStart = start + i * seg;
        const hue = i / (fn.modes.length - 1);
        svg += this._ringPath(cx, cy, rZone, segStart, seg * 0.86, this._lerpColor(fn.colorFrom, fn.colorTo, hue), 4, 0.35);
      });
    }

    // progress arc (glossy, glowing) from start to current value, dimmed to a flat,
    // glow-less arc when the clim is off so it can't be mistaken for an active mode
    if (useProgGlow) svg += `<g filter="url(#glow)">`;
    svg += this._ringPath(cx, cy, rOuter, start, (valClock - start + 360) % 360 || 0.001, 'url(#prog)', 10, progOpacity, true);
    if (useProgGlow) svg += `</g>`;

    // static top gloss reflection: mirror-like sheen across the top of the ring,
    // independent of the current value, like light reflecting off glass/chrome
    svg += this._ringPath(cx, cy, rOuter, -32, 64, 'url(#topGloss)', 5, 0.9, true);

    // tick marks
    const tickCount = fn.modes ? fn.modes.length + 1 : 8;
    for (let i = 0; i <= tickCount; i++) {
      const d = start + (sweep * i) / tickCount;
      const p1 = ClimatisationMoletteCard._pointFor(cx, cy, rOuter + 8, d);
      const p2 = ClimatisationMoletteCard._pointFor(cx, cy, rOuter + 14, d);
      svg += `<line class="tick" x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}"/>`;
    }

    // zone/mode labels
    if (fn.modeLabels) {
      const seg = sweep / fn.modeLabels.length;
      fn.modeLabels.forEach((lbl, i) => {
        const d = start + seg * (i + 0.5);
        const p = ClimatisationMoletteCard._pointFor(cx, cy, rOuter + 26, d);
        const color = this._lerpColor(fn.colorFrom, fn.colorTo, i / (fn.modeLabels.length - 1));
        svg += `<text class="zone-label" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="${color}">${lbl}</text>`;
      });
    } else {
      // min/mid/max labels for continuous (temperature): the mid label sits
      // right under the icon badge, made brighter/bigger so it's readable at a glance
      [0, 0.5, 1].forEach((f) => {
        const d = start + sweep * f;
        const isMid = f === 0.5;
        const p = ClimatisationMoletteCard._pointFor(cx, cy, rOuter + (isMid ? 22 : 24), d);
        const val = fn.min + f * (fn.max - fn.min);
        const suffix = fn.unit || '';
        const styleStr = isMid ? 'font-size:16px;font-weight:700;fill:#f0f0f0;' : 'fill:#888;';
        svg += `<text class="zone-label" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" style="${styleStr}">${val.toFixed(fn.decimals)}${suffix}</text>`;
      });
    }

    // draggable handle knob: glossy chrome ball (base + specular highlight)
    const hp = ClimatisationMoletteCard._pointFor(cx, cy, rHandle, valClock);
    svg += `<circle cx="${hp.x.toFixed(1)}" cy="${hp.y.toFixed(1)}" r="11" fill="url(#centerGrad)" stroke="${effColorTo}" stroke-width="3" filter="url(#softshadow)"/>`;
    svg += `<ellipse cx="${(hp.x - 3).toFixed(1)}" cy="${(hp.y - 3.5).toFixed(1)}" rx="5" ry="3.2" fill="url(#handleSheen)" opacity="0.9"/>`;

    // center circle: glossy dark dome
    svg += `<circle cx="${cx}" cy="${cy}" r="${rCenter}" fill="url(#centerGrad)" filter="url(#softshadow)"/>`;
    svg += `<g clip-path="url(#centerClip)"><ellipse cx="${cx}" cy="${(cy - 32).toFixed(1)}" rx="48" ry="26" fill="url(#centerSheen)"/></g>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${rCenter}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>`;

    const displayVal = fn.modeLabels ? fn.modeLabels[Math.round(value)] : value.toFixed(fn.decimals);
    const isTextLabel = !!fn.modeLabels;
    let valueStyle = isTextLabel ? 'font-size:30px;' : '';
    if (tempColor) {
      valueStyle += isOffMode ? `fill:${tempColor};` : `fill:${tempColor};filter:drop-shadow(0 0 6px ${tempColor});`;
    }
    svg += `<text class="center-value" x="${cx}" y="${cy - (isTextLabel ? 6 : 4)}" text-anchor="middle" dominant-baseline="middle" style="${valueStyle}">${displayVal}</text>`;
    if (fn.unit) {
      svg += `<text class="center-unit" x="${cx}" y="${cy + 26}" text-anchor="middle" dominant-baseline="middle">${fn.unit}</text>`;
    }
    svg += `<text class="center-label" x="${cx}" y="${cy + 46}" text-anchor="middle" dominant-baseline="middle" fill="${effColorTo}">${fn.label.toUpperCase()}</text>`;

    this._svg.innerHTML = svg;

    // icon badge: dark glossy sphere, colored + glowing icon (same language as
    // the Intensité / kVA badges elsewhere on the dashboard), animated to feel alive:
    // the fan spins (faster at higher speed), the thermometer breathes hot/cold
    if (this._iconBadge && this._iconEl) {
      let iconName = fn.icon;
      let iconColor = fn.colorTo;
      let anim = null;
      let spinDuration = null;

      if (fn.key === 'temp') {
        iconColor = tempColor || fn.colorTo;
        anim = isOffMode ? null : 'pulse';
      } else if (fn.key === 'vitesse') {
        anim = 'spin';
        spinDuration = Math.max(0.5, 3.1 - value * 0.45).toFixed(2) + 's';
      } else if (fn.modeIcons) {
        iconName = fn.modeIcons[Math.round(value)] || fn.icon;
        iconColor = this._lerpColor(fn.colorFrom, fn.colorTo, Math.round(value) / (fn.modeLabels.length - 1));
        const modeKey = fn.modes[Math.round(value)];
        if (modeKey === 'fan_only') { anim = 'spin'; spinDuration = '1.3s'; }
        else if (modeKey === 'heat' || modeKey === 'cool' || modeKey === 'dry') { anim = 'pulse'; }
      }

      this._iconEl.setAttribute('icon', iconName);
      this._iconEl.style.color = iconColor;
      this._iconEl.style.filter = `drop-shadow(0 0 4px ${iconColor}) drop-shadow(0 1px 1px rgba(0,0,0,.6))`;
      // avoid toggling a class that's already set: that restarts the animation
      // (e.g. the fan snapping back to 0deg) on every re-render while dragging
      if (anim === 'spin') {
        this._iconEl.classList.remove('anim-pulse');
        if (!this._iconEl.classList.contains('anim-spin')) this._iconEl.classList.add('anim-spin');
        if (spinDuration) this._iconEl.style.animationDuration = spinDuration;
      } else if (anim === 'pulse') {
        this._iconEl.classList.remove('anim-spin');
        this._iconEl.style.animationDuration = '';
        if (!this._iconEl.classList.contains('anim-pulse')) this._iconEl.classList.add('anim-pulse');
      } else {
        this._iconEl.classList.remove('anim-spin', 'anim-pulse');
        this._iconEl.style.animationDuration = '';
      }

      // on the main (Température) screen, while the clim is off, invite a tap on
      // the icon to switch it back on
      this._iconBadge.classList.toggle('tap-on', fn.key === 'temp' && isOffMode);
    }

    // dots
    if (this._dotsEl) {
      const dots = this._dotsEl.children;
      for (let i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('active', i === this._funcIndex);
      }
    }
  }

  _lerpColor(a, b, t) {
    const pa = this._hexToRgb(a), pb = this._hexToRgb(b);
    const r = Math.round(pa.r + (pb.r - pa.r) * t);
    const g = Math.round(pa.g + (pb.g - pa.g) * t);
    const bl = Math.round(pa.b + (pb.b - pa.b) * t);
    return `rgb(${r},${g},${bl})`;
  }

  // temperature digits colored by hvac mode, intensity scaled by how extreme
  // the set-point is: heat -> red (hotter = more intense), cool -> blue
  // (colder = more intense), fan_only -> green, dry -> violet
  _tempTextColor(mode, value, min, max) {
    // clim éteinte -> gris neutre fixe, jamais une couleur de mode actif
    if (!mode || mode === 'off') return '#80868c';
    const palette = {
      heat: { r: 255, g: 87, b: 34 },
      cool: { r: 33, g: 150, b: 243 },
      fan_only: { r: 0, g: 214, b: 110 },
      dry: { r: 191, g: 90, b: 242 }
    };
    const hue = palette[mode];
    if (!hue) return '#ffffff';
    const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
    let intensity;
    if (mode === 'cool') intensity = 1 - frac;
    else if (mode === 'heat') intensity = frac;
    else intensity = Math.abs(frac - 0.5) * 2;
    intensity = Math.max(0.12, Math.min(1, intensity));
    const r = Math.round(255 + (hue.r - 255) * intensity);
    const g = Math.round(255 + (hue.g - 255) * intensity);
    const b = Math.round(255 + (hue.b - 255) * intensity);
    return `rgb(${r},${g},${b})`;
  }

  // ring / handle / label gradient for the temperature dial: same hue family as
  // _tempTextColor (pale -> saturated) so the whole molette matches the current
  // hvac mode instead of always showing the old fixed yellow->orange gradient
  _tempModeGradient(mode) {
    // clim éteinte -> gris sombre, quasi confondu avec l'anneau de fond (+ opacité
    // réduite appliquée au tracé) plutôt qu'une couleur qui pourrait passer pour active
    if (!mode || mode === 'off') return { from: '#4a4e52', to: '#5c6268' };
    const palette = {
      heat: { r: 255, g: 87, b: 34 },
      cool: { r: 33, g: 150, b: 243 },
      fan_only: { r: 0, g: 214, b: 110 },
      dry: { r: 191, g: 90, b: 242 }
    };
    const hue = palette[mode];
    if (!hue) return { from: '#ffd54f', to: '#ff6f00' };
    const blend = (t) => {
      const r = Math.round(255 + (hue.r - 255) * t);
      const g = Math.round(255 + (hue.g - 255) * t);
      const b = Math.round(255 + (hue.b - 255) * t);
      return `rgb(${r},${g},${b})`;
    };
    return { from: blend(0.35), to: blend(1) };
  }
  _hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }

  _ringPath(cx, cy, r, startClock, sweepClock, color, width, opacity, roundcap) {
    const steps = Math.max(2, Math.round(Math.abs(sweepClock) / 3));
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const c = startClock + (sweepClock * i) / steps;
      const p = ClimatisationMoletteCard._pointFor(cx, cy, r, c);
      d += (i === 0 ? 'M' : 'L') + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ' ';
    }
    const cap = roundcap ? 'round' : 'butt';
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="${cap}"/>`;
  }

  // ---- auto-revert to temperature after 3s of inactivity ----
  _scheduleRevert() {
    if (this._revertTimer) {
      clearTimeout(this._revertTimer);
      this._revertTimer = null;
    }
    if (this._funcIndex === 0) return; // already on température
    this._revertTimer = setTimeout(() => {
      this._revertTimer = null;
      this._funcIndex = 0;
      this._value = null;
      this._updateValueFromHass();
      this._render();
    }, 5000);
  }

  // ---- pointer / drag handling ----
  _attachPointerHandlers() {
    const svg = this._svg;    let downInfo = null;

    const getLocalPoint = (evt) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = 300 / rect.width;
      const scaleY = 300 / rect.height;
      return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY
      };
    };

    const onDown = (evt) => {
      evt.preventDefault();
      // any interaction cancels a pending auto-revert
      if (this._revertTimer) { clearTimeout(this._revertTimer); this._revertTimer = null; }
      const p = getLocalPoint(evt);
      const cx = 150, cy = 150;
      const dist = Math.hypot(p.x - cx, p.y - cy);
      downInfo = { x: p.x, y: p.y, t: Date.now(), moved: false, insideCenter: dist < 66 };
      try { svg.setPointerCapture(evt.pointerId); } catch (e) {}
    };

    const onMove = (evt) => {
      if (!downInfo) return;
      const p = getLocalPoint(evt);
      const cx = 150, cy = 150;
      const dx = p.x - cx, dy = p.y - cy;
      const moveDist = Math.hypot(p.x - downInfo.x, p.y - downInfo.y);
      if (moveDist > 5) downInfo.moved = true;
      if (!downInfo.moved) return;
      this._dragging = true;
      const clockDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const normDeg = (clockDeg + 360) % 360;
      const frac = this._clockDegToFraction(normDeg);
      const fn = this._functions[this._funcIndex];
      let value = fn.min + frac * (fn.max - fn.min);
      value = Math.round(value / fn.step) * fn.step;
      value = Math.max(fn.min, Math.min(fn.max, value));
      if (value !== this._value) {
        this._value = value;
        this._render();
        this._throttledSet(fn, value);
      }
    };

    const onUp = (evt) => {
      if (!downInfo) return;
      const wasTap = !downInfo.moved;
      const insideCenter = downInfo.insideCenter;
      const wasDragging = this._dragging;
      this._dragging = false;
      downInfo = null;
      try { svg.releasePointerCapture(evt.pointerId); } catch (e) {}

      if (wasTap && insideCenter) {
        this._funcIndex = (this._funcIndex + 1) % this._functions.length;
        this._value = null;
        this._updateValueFromHass();
        this._render();
        this._scheduleRevert();
        return;
      }
      if (wasDragging) {
        const fn = this._functions[this._funcIndex];
        if (this._value != null) fn.setValue(this._hass, this._value);
      }
      this._scheduleRevert();
    };

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
  }

  _throttledSet(fn, value) {
    const now = Date.now();
    this._pendingValue = value;
    if (now - this._lastCallTs > 140) {
      this._lastCallTs = now;
      fn.setValue(this._hass, value);
      this._pendingValue = null;
    } else if (!this._throttleTimer) {
      this._throttleTimer = setTimeout(() => {
        this._throttleTimer = null;
        if (this._pendingValue != null) {
          this._lastCallTs = Date.now();
          fn.setValue(this._hass, this._pendingValue);
          this._pendingValue = null;
        }
      }, 150);
    }
  }
}

customElements.define('climatisation-molette-card', ClimatisationMoletteCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'climatisation-molette-card',
  name: 'Climatisation Molette',
  description: 'Molette rotative unique pour température / vitesse / mode'
});
